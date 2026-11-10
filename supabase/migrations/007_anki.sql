-- Stage 5: Anki decks. Imported cards, their fact-checks against the student's own sources,
-- suggested new cards, and the functions that apply a decision. Nothing on a card changes until
-- the student accepts a suggestion.

-- ---------------------------------------------------------------------------
-- Decks and cards
-- ---------------------------------------------------------------------------

create table decks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (length(name) between 1 and 120),
  file_name text,
  source_format text not null check (source_format in ('apkg', 'text')),
  storage_path text,
  state text not null default 'importing' check (state in ('importing', 'ready', 'failed')),
  error text,
  card_count int not null default 0 check (card_count >= 0),
  skipped_count int not null default 0 check (skipped_count >= 0),
  -- Cost guard: how many cards may be fact-checked, and how many have been. The student can raise the cap.
  check_cap int not null default 200 check (check_cap between 0 and 2000),
  checks_used int not null default 0 check (checks_used >= 0),
  imported_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index decks_user_idx on decks (user_id, created_at desc);
create trigger decks_updated_at before update on decks for each row execute function set_updated_at();

create table deck_cards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  deck_id uuid not null references decks(id) on delete cascade,
  stone_id uuid references stepping_stones(id) on delete set null,
  front text not null check (length(front) between 1 and 2000),
  back text not null check (length(back) between 1 and 2000),
  -- The card as imported, kept once an accepted suggestion changes it.
  original_front text,
  original_back text,
  tags text[] not null default '{}',
  anki_note_id text,
  anki_guid text,
  origin text not null default 'import' check (origin in ('import', 'suggested')),
  state text not null default 'active' check (state in ('active', 'suspended')),
  sort_order int not null,
  embedding vector(1024),
  checked_at timestamptz,
  edited_at timestamptz,
  created_at timestamptz not null default now()
);
create index deck_cards_deck_idx on deck_cards (deck_id, sort_order);
create index deck_cards_stone_idx on deck_cards (stone_id);
create index deck_cards_user_idx on deck_cards (user_id);

-- ---------------------------------------------------------------------------
-- Fact-checks: one current check per card
-- ---------------------------------------------------------------------------

create table card_checks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  deck_id uuid not null references decks(id) on delete cascade,
  card_id uuid not null unique references deck_cards(id) on delete cascade,
  verdict text not null check (verdict in ('agrees', 'disagrees', 'outdated', 'out_of_scope', 'no_source')),
  explanation text not null check (length(explanation) <= 1000),
  -- { "front": ..., "back": ... } for a corrected card, or { "action": "suspend" } for an out-of-scope one.
  suggestion jsonb,
  -- [{ "kind": "textbook" | "note", "label": ..., "quote": ... }]: what the verdict rests on.
  source_refs jsonb not null default '[]',
  model text not null,
  escalated boolean not null default false,
  decision text not null check (decision in ('none', 'pending', 'accepted', 'dismissed')),
  decided_at timestamptz,
  checked_at timestamptz not null default now(),
  check ((decision = 'pending') = (suggestion is not null) or decision in ('accepted', 'dismissed'))
);
create index card_checks_deck_idx on card_checks (deck_id, decision);
create index card_checks_user_idx on card_checks (user_id);

-- ---------------------------------------------------------------------------
-- Suggested new cards, for stones the deck covers thinly
-- ---------------------------------------------------------------------------

create table card_suggestions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  deck_id uuid not null references decks(id) on delete cascade,
  stone_id uuid not null references stepping_stones(id) on delete cascade,
  front text not null check (length(front) between 1 and 2000),
  back text not null check (length(back) between 1 and 2000),
  source_refs jsonb not null default '[]',
  model text not null,
  decision text not null default 'pending' check (decision in ('pending', 'accepted', 'dismissed')),
  card_id uuid references deck_cards(id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
create index card_suggestions_deck_idx on card_suggestions (deck_id, decision);
create index card_suggestions_stone_idx on card_suggestions (stone_id);
create index card_suggestions_user_idx on card_suggestions (user_id);
create index card_suggestions_card_idx on card_suggestions (card_id);

-- ---------------------------------------------------------------------------
-- Functions
-- ---------------------------------------------------------------------------

-- Files each unfiled card of a deck under its closest stone.
create or replace function link_deck_cards(p_deck_id uuid, min_similarity float default 0.35)
returns int
language plpgsql security invoker set search_path = public as $$
declare n int;
begin
  with best as (
    select c.id as card_id, nearest.id as stone_id
    from deck_cards c
    cross join lateral (
      select s.id, 1 - (s.embedding <=> c.embedding) as similarity
      from stepping_stones s
      where s.user_id = c.user_id and s.embedding is not null
      order by s.embedding <=> c.embedding
      limit 1
    ) nearest
    where c.user_id = auth.uid()
      and c.deck_id = p_deck_id
      and c.stone_id is null
      and c.embedding is not null
      and nearest.similarity >= min_similarity
  )
  update deck_cards c set stone_id = best.stone_id from best where c.id = best.card_id;
  get diagnostics n = row_count;
  return n;
end;
$$;

-- Takes up to p_wanted fact-checks from the deck's cap, all at once so two runs can't both overspend.
create or replace function reserve_deck_checks(p_deck_id uuid, p_wanted int)
returns int
language plpgsql security invoker set search_path = public as $$
declare
  v_cap int;
  v_used int;
  granted int;
begin
  select d.check_cap, d.checks_used into v_cap, v_used
  from decks d where d.id = p_deck_id and d.user_id = auth.uid()
  for update;
  if not found then
    raise exception 'deck not found' using errcode = 'P0002';
  end if;
  granted := least(greatest(p_wanted, 0), greatest(v_cap - v_used, 0));
  if granted > 0 then
    update decks set checks_used = checks_used + granted where id = p_deck_id;
  end if;
  return granted;
end;
$$;

-- Gives back checks that were reserved but not used (a failed batch).
create or replace function release_deck_checks(p_deck_id uuid, p_unused int)
returns void
language sql security invoker set search_path = public as $$
  update decks set checks_used = greatest(checks_used - greatest(p_unused, 0), 0)
  where id = p_deck_id and user_id = auth.uid();
$$;

-- Applies the student's decision on a flagged card. A dismissed check never changes the card.
create or replace function decide_card_check(p_check_id uuid, p_decision text)
returns table (card_id uuid, front text, back text, state text)
language plpgsql security invoker set search_path = public as $$
declare
  c card_checks%rowtype;
begin
  if p_decision not in ('accepted', 'dismissed') then
    raise exception 'decision must be accepted or dismissed' using errcode = '22023';
  end if;
  select * into c from card_checks k where k.id = p_check_id and k.user_id = auth.uid() for update;
  if not found then
    raise exception 'check not found' using errcode = 'P0002';
  end if;
  if c.decision <> 'pending' then
    raise exception 'already decided' using errcode = '55000';
  end if;

  if p_decision = 'accepted' then
    if c.suggestion ? 'action' then
      if c.suggestion->>'action' <> 'suspend' then
        raise exception 'unknown suggestion' using errcode = '22023';
      end if;
      update deck_cards d set state = 'suspended', edited_at = now() where d.id = c.card_id;
    else
      if coalesce(length(c.suggestion->>'front'), 0) = 0 or coalesce(length(c.suggestion->>'back'), 0) = 0 then
        raise exception 'suggestion is empty' using errcode = '22023';
      end if;
      update deck_cards d
      set original_front = coalesce(d.original_front, d.front),
          original_back = coalesce(d.original_back, d.back),
          front = c.suggestion->>'front',
          back = c.suggestion->>'back',
          edited_at = now()
      where d.id = c.card_id;
    end if;
  end if;

  update card_checks k set decision = p_decision, decided_at = now() where k.id = p_check_id;
  return query select d.id, d.front, d.back, d.state from deck_cards d where d.id = c.card_id;
end;
$$;

-- Accepting a suggested card adds it to the deck under its stone; dismissing just records the choice.
create or replace function decide_card_suggestion(p_suggestion_id uuid, p_decision text)
returns uuid
language plpgsql security invoker set search_path = public as $$
declare
  s card_suggestions%rowtype;
  v_card uuid;
begin
  if p_decision not in ('accepted', 'dismissed') then
    raise exception 'decision must be accepted or dismissed' using errcode = '22023';
  end if;
  select * into s from card_suggestions k where k.id = p_suggestion_id and k.user_id = auth.uid() for update;
  if not found then
    raise exception 'suggestion not found' using errcode = 'P0002';
  end if;
  if s.decision <> 'pending' then
    raise exception 'already decided' using errcode = '55000';
  end if;

  if p_decision = 'accepted' then
    insert into deck_cards (user_id, deck_id, stone_id, front, back, origin, sort_order, checked_at)
    values (
      s.user_id, s.deck_id, s.stone_id, s.front, s.back, 'suggested',
      coalesce((select max(d.sort_order) from deck_cards d where d.deck_id = s.deck_id), 0) + 1,
      now()
    )
    returning id into v_card;
    update decks set card_count = card_count + 1 where id = s.deck_id;
  end if;

  update card_suggestions k set decision = p_decision, decided_at = now(), card_id = v_card where k.id = p_suggestion_id;
  return v_card;
end;
$$;

-- ---------------------------------------------------------------------------
-- Row-level security: each student sees only their own rows
-- ---------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array['decks', 'deck_cards', 'card_checks', 'card_suggestions'] loop
    execute format('alter table %I enable row level security', t);
    execute format(
      'create policy "owner access" on %I for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))',
      t
    );
  end loop;
end;
$$;

revoke execute on function link_deck_cards(uuid, float) from public, anon;
revoke execute on function reserve_deck_checks(uuid, int) from public, anon;
revoke execute on function release_deck_checks(uuid, int) from public, anon;
revoke execute on function decide_card_check(uuid, text) from public, anon;
revoke execute on function decide_card_suggestion(uuid, text) from public, anon;
