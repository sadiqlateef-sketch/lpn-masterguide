-- Stage 6: learning games, adaptive practice exams, more NGN item types, drug cards and the mistake notebook.

-- ---------------------------------------------------------------------------
-- Practice items: new NGN types, and questions that belong to a client need instead of a stone
-- (a drug card's questions, the questions that close a game round).
-- ---------------------------------------------------------------------------

alter table practice_items alter column stone_id drop not null;
alter table practice_items add column client_need_id text references nclex_client_needs(id);
alter table practice_items add constraint practice_items_topic_check
  check (stone_id is not null or client_need_id is not null);

alter table practice_items drop constraint if exists practice_items_item_type_check;
alter table practice_items add constraint practice_items_item_type_check
  check (item_type in (
    'twin_mcq', 'sata', 'ngn_mini_bowtie', 'lesson_mcq',
    'ngn_matrix', 'ngn_cloze', 'ngn_highlight', 'ngn_ordered',
    'drug_mcq', 'round_mcq'
  ));

create index practice_attempts_user_item_idx on practice_attempts (user_id, practice_item_id, answered_at desc);

-- ---------------------------------------------------------------------------
-- Game rounds. The payload holds the answer key, so rounds are graded on the server.
-- ---------------------------------------------------------------------------

create table game_rounds (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  game text not null check (game in ('med_match', 'lab_levels', 'triage', 'ppe_order', 'med_math', 'scope', 'isolation')),
  stone_ids uuid[] not null default '{}',
  client_need_id text not null references nclex_client_needs(id),
  payload jsonb not null,
  ending_item_ids uuid[] not null default '{}',
  total int not null check (total between 1 and 50),
  correct int check (correct between 0 and total),
  duration_ms int check (duration_ms between 0 and 86400000),
  created_at timestamptz not null default now(),
  answered_at timestamptz,
  check ((answered_at is null) = (correct is null))
);
create index game_rounds_user_game_idx on game_rounds (user_id, game, answered_at desc);

-- ---------------------------------------------------------------------------
-- Adaptive practice exams
-- ---------------------------------------------------------------------------

create table exam_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null default 'adaptive' check (kind in ('adaptive')),
  min_items int not null check (min_items between 5 and 150),
  max_items int not null check (max_items between min_items and 150),
  time_limit_minutes int not null check (time_limit_minutes between 5 and 300),
  current_item_id uuid references practice_items(id) on delete set null,
  ability_estimate numeric not null default 0,
  standard_error numeric not null default 1,
  stop_reason text check (stop_reason in ('confident_above', 'confident_below', 'max_items', 'time', 'out_of_items', 'ended')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  check ((finished_at is null) = (stop_reason is null))
);
create index exam_sessions_user_idx on exam_sessions (user_id, started_at desc);

create table exam_answers (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid not null references exam_sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  practice_item_id uuid references practice_items(id) on delete set null,
  attempt_id uuid references practice_attempts(id) on delete set null,
  position int not null check (position >= 1),
  client_need_id text references nclex_client_needs(id),
  is_correct boolean not null,
  score numeric not null check (score between 0 and 1),
  difficulty numeric not null,
  ability_after numeric not null,
  answered_at timestamptz not null default now(),
  unique (exam_id, position),
  unique (exam_id, practice_item_id)
);
create index exam_answers_user_idx on exam_answers (user_id);
create index exam_answers_item_idx on exam_answers (practice_item_id);

-- ---------------------------------------------------------------------------
-- Drug cards, built from the student's own sources where they cover the drug
-- ---------------------------------------------------------------------------

create table drug_cards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  name_key text not null check (char_length(name_key) between 1 and 120),
  card jsonb not null,
  source_refs jsonb not null default '[]',
  stone_id uuid references stepping_stones(id) on delete set null,
  practice_item_ids uuid[] not null default '{}',
  model text not null,
  created_at timestamptz not null default now(),
  unique (user_id, name_key)
);
create index drug_cards_stone_idx on drug_cards (stone_id);

-- ---------------------------------------------------------------------------
-- Mistake notebook: the student's own note on a question they missed
-- ---------------------------------------------------------------------------

create table mistake_notes (
  user_id uuid not null references auth.users(id) on delete cascade,
  practice_item_id uuid not null references practice_items(id) on delete cascade,
  note text not null check (char_length(note) <= 1000),
  updated_at timestamptz not null default now(),
  primary key (user_id, practice_item_id)
);
create index mistake_notes_item_idx on mistake_notes (practice_item_id);

do $$
declare t text;
begin
  foreach t in array array['game_rounds', 'exam_sessions', 'exam_answers', 'drug_cards', 'mistake_notes'] loop
    execute format('alter table %I enable row level security', t);
    execute format(
      'create policy "owner access" on %I for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))',
      t
    );
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Questions the student's latest answer got wrong, newest first, with how often they missed each.
-- ---------------------------------------------------------------------------

create or replace function my_mistakes(p_limit int default 100)
returns table (practice_item_id uuid, missed_at timestamptz, misses int)
language sql stable security invoker set search_path = public as $$
  with latest as (
    select distinct on (pa.practice_item_id) pa.practice_item_id, pa.is_correct, pa.answered_at
    from practice_attempts pa
    where pa.user_id = (select auth.uid())
    order by pa.practice_item_id, pa.answered_at desc, pa.id desc
  )
  select l.practice_item_id, l.answered_at,
         (select count(*) from practice_attempts m
          where m.user_id = (select auth.uid()) and m.practice_item_id = l.practice_item_id and not m.is_correct)::int
  from latest l
  where not l.is_correct
  order by l.answered_at desc
  limit least(greatest(coalesce(p_limit, 100), 1), 200);
$$;

-- ---------------------------------------------------------------------------
-- Readiness now also counts questions tied to a client need (no stone) and game rounds.
-- A game round counts once, as right when the student scored 80% or better.
-- ---------------------------------------------------------------------------

create or replace function readiness_by_client_need()
returns table (client_need_id text, name text, min_pct numeric, max_pct numeric, attempts int, correct int)
language sql stable security invoker set search_path = public as $$
  with tagged as (
    select 'q' || pa.id::text as attempt_key, pa.is_correct, t.client_need_id
    from practice_attempts pa
    join practice_items pi on pi.id = pa.practice_item_id
    join stone_blueprint_tags t on t.stone_id = pi.stone_id
    where pa.user_id = (select auth.uid())
    union
    select 'q' || pa.id::text, pa.is_correct, pi.client_need_id
    from practice_attempts pa
    join practice_items pi on pi.id = pa.practice_item_id
    where pa.user_id = (select auth.uid()) and pi.stone_id is null and pi.client_need_id is not null
    union
    select 'g' || gr.id::text, gr.correct * 5 >= gr.total * 4, gr.client_need_id
    from game_rounds gr
    where gr.user_id = (select auth.uid()) and gr.answered_at is not null
  )
  select cn.id, cn.name, cn.min_pct, cn.max_pct,
         count(tagged.attempt_key)::int,
         count(tagged.attempt_key) filter (where tagged.is_correct)::int
  from nclex_client_needs cn
  join nclex_test_plans tp on tp.id = cn.test_plan_id and tp.is_current
  left join tagged on tagged.client_need_id = cn.id
  group by cn.id, cn.name, cn.min_pct, cn.max_pct, cn.sort_order
  order by cn.sort_order;
$$;

revoke execute on function my_mistakes(int) from public, anon;
grant execute on function my_mistakes(int) to authenticated;
