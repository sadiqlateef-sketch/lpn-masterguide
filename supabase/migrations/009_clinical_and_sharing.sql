-- Stage 6b: skills checklists, clinical day prep, the care plan builder and read-only share links.
-- Offline lessons and the audio playlist keep everything on the phone and need no tables.

-- Questions that close a skills checklist, a clinical prep sheet or a care plan check.
alter table practice_items drop constraint if exists practice_items_item_type_check;
alter table practice_items add constraint practice_items_item_type_check
  check (item_type in (
    'twin_mcq', 'sata', 'ngn_mini_bowtie', 'lesson_mcq',
    'ngn_matrix', 'ngn_cloze', 'ngn_highlight', 'ngn_ordered',
    'drug_mcq', 'round_mcq', 'skill_mcq', 'clinical_mcq'
  ));

-- ---------------------------------------------------------------------------
-- Skills checklists. The checklists themselves are written in code; these rows are the student's runs
-- through them and the skills an instructor has signed off.
-- ---------------------------------------------------------------------------

create table skill_checks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  skill_id text not null check (skill_id ~ '^[a-z0-9_]{2,40}$'),
  steps_total int not null check (steps_total between 1 and 60),
  steps_done int not null check (steps_done between 0 and steps_total),
  missed_steps int[] not null default '{}',
  confidence text not null check (confidence in ('not_yet', 'with_help', 'on_my_own')),
  checked_at timestamptz not null default now()
);
create index skill_checks_user_skill_idx on skill_checks (user_id, skill_id, checked_at desc);

create table skill_signoffs (
  user_id uuid not null references auth.users(id) on delete cascade,
  skill_id text not null check (skill_id ~ '^[a-z0-9_]{2,40}$'),
  signed_off_on date not null,
  created_at timestamptz not null default now(),
  primary key (user_id, skill_id)
);

-- ---------------------------------------------------------------------------
-- Clinical day prep: the diagnoses, medications and skills for a clinical day (never names or other
-- identifiers), turned into a study sheet that ends with NCLEX-style questions.
-- ---------------------------------------------------------------------------

create table clinical_preps (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 120),
  clinical_on date,
  input jsonb not null,
  sheet jsonb not null,
  source_refs jsonb not null default '[]',
  practice_item_ids uuid[] not null default '{}',
  model text not null,
  created_at timestamptz not null default now()
);
create index clinical_preps_user_idx on clinical_preps (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Care plans in LPN scope: the student writes the plan, a draft and a check help.
-- ---------------------------------------------------------------------------

create table care_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  prep_id uuid references clinical_preps(id) on delete set null,
  situation text not null check (char_length(situation) between 1 and 2000),
  plan jsonb not null,
  feedback jsonb,
  practice_item_ids uuid[] not null default '{}',
  model text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index care_plans_user_idx on care_plans (user_id, updated_at desc);
create index care_plans_prep_idx on care_plans (prep_id);

-- ---------------------------------------------------------------------------
-- Share links: a read-only copy of a lesson or a question set, taken when the link is made.
-- The copy holds no notebook card, no captions and no source quotes, so personal notes never leave.
-- ---------------------------------------------------------------------------

create table shared_decks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  token text not null unique check (token ~ '^[A-Za-z0-9_-]{32,64}$'),
  kind text not null check (kind in ('lesson', 'questions')),
  title text not null check (char_length(title) between 1 and 160),
  stone_id uuid references stepping_stones(id) on delete set null,
  snapshot jsonb not null,
  item_count int not null check (item_count between 0 and 100),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  check (expires_at > created_at)
);
create index shared_decks_user_idx on shared_decks (user_id, created_at desc);
create index shared_decks_stone_idx on shared_decks (stone_id);

do $$
declare t text;
begin
  foreach t in array array['skill_checks', 'skill_signoffs', 'clinical_preps', 'care_plans', 'shared_decks'] loop
    execute format('alter table %I enable row level security', t);
    execute format(
      'create policy "owner access" on %I for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))',
      t
    );
  end loop;
end $$;

-- Anyone holding a live link may read that one copy, and nothing else.
create or replace function shared_deck(p_token text)
returns table (kind text, title text, snapshot jsonb, created_at timestamptz, expires_at timestamptz)
language sql stable security definer set search_path = public as $$
  select d.kind, d.title, d.snapshot, d.created_at, d.expires_at
  from shared_decks d
  where d.token = p_token and d.revoked_at is null and d.expires_at > now();
$$;

revoke execute on function shared_deck(text) from public;
grant execute on function shared_deck(text) to anon, authenticated;
