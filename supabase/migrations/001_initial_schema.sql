-- LPN MasterGuide: initial schema
-- Blueprint reference data (NCLEX-PN, NGN, HESI) is hand-seeded here on purpose.
-- It is not scraped and not AI-generated. Update it with a new migration when NCSBN publishes a new test plan.

create extension if not exists vector;
create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

create type stone_status as enum ('locked', 'ready', 'mastered', 'needs_review');
create type ingest_kind as enum ('book_title', 'toc_photo', 'uworld_screenshot', 'uworld_text', 'notebooklm_note', 'unknown');
create type ingest_state as enum ('pending', 'processing', 'done', 'failed');
create type hesi_priority as enum ('high', 'medium', 'low');

-- ---------------------------------------------------------------------------
-- Shared helpers
-- ---------------------------------------------------------------------------

create or replace function set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Blueprint reference tables (read-only for users)
-- ---------------------------------------------------------------------------

create table nclex_test_plans (
  id text primary key,
  label text not null,
  effective_date date not null,
  source_url text not null,
  is_current boolean not null default false
);

create table nclex_client_needs (
  id text primary key,
  test_plan_id text not null references nclex_test_plans(id),
  parent_category text not null,
  name text not null,
  min_pct numeric(4,1) not null check (min_pct >= 0 and min_pct <= 100),
  max_pct numeric(4,1) not null check (max_pct >= min_pct and max_pct <= 100),
  lpn_focus text not null,
  sort_order int not null
);

create table ngn_clinical_judgment_steps (
  id text primary key,
  step_order int not null unique,
  name text not null,
  question text not null,
  lpn_example text not null
);

create table hesi_pn_domains (
  id text primary key,
  name text not null,
  priority hesi_priority not null,
  classic_hint text not null,
  sort_order int not null
);

create table hesi_score_benchmarks (
  id text primary key,
  min_score int not null,
  max_score int,
  label text not null,
  meaning text not null
);

create table courses (
  id text primary key,
  name text not null,
  sort_order int not null,
  default_hesi_domain_id text references hesi_pn_domains(id)
);

-- ---------------------------------------------------------------------------
-- Seed: NCLEX-PN Test Plan
-- Weights from the NCLEX-PN Test Plan effective 2026-04-01 (unchanged from the 2023 plan ranges).
-- Verify against https://www.nclex.com/test-plans.page when NCSBN publishes the next plan.
-- ---------------------------------------------------------------------------

insert into nclex_test_plans (id, label, effective_date, source_url, is_current) values
  ('pn-2026', 'NCLEX-PN Test Plan 2026', '2026-04-01', 'https://www.nclex.com/test-plans.page', true);

insert into nclex_client_needs (id, test_plan_id, parent_category, name, min_pct, max_pct, lpn_focus, sort_order) values
  ('coordinated_care', 'pn-2026', 'Safe and Effective Care Environment', 'Coordinated Care', 18, 24,
   'Collaborates with the health care team: assigning tasks to UAPs, advocacy, client rights, confidentiality, informed consent (verifying, not obtaining), continuity of care, and reporting to the RN.', 1),
  ('safety_infection', 'pn-2026', 'Safe and Effective Care Environment', 'Safety and Infection Prevention and Control', 10, 16,
   'Protects clients and staff: fall prevention, restraint safety, standard and transmission-based precautions, error prevention, handling hazardous materials, emergency response.', 2),
  ('health_promotion', 'pn-2026', 'Health Promotion and Maintenance', 'Health Promotion and Maintenance', 6, 12,
   'Growth and development across the lifespan, prenatal through older adult; data collection techniques; reinforcing teaching on screenings, immunizations and lifestyle.', 3),
  ('psychosocial', 'pn-2026', 'Psychosocial Integrity', 'Psychosocial Integrity', 9, 15,
   'Coping, grief and loss, abuse and neglect, therapeutic communication, substance use, behavioral management, crisis and suicide precautions.', 4),
  ('basic_care', 'pn-2026', 'Physiological Integrity', 'Basic Care and Comfort', 7, 13,
   'ADLs, mobility, elimination, nutrition and oral hydration, rest and sleep, non-pharmacological comfort measures, assistive devices.', 5),
  ('pharm', 'pn-2026', 'Physiological Integrity', 'Pharmacological and Parenteral Therapies', 10, 16,
   'Safe medication administration and dosage calculation, expected effects, side effects, interactions, monitoring parameters, and reinforcing medication teaching.', 6),
  ('risk_reduction', 'pn-2026', 'Physiological Integrity', 'Reduction of Risk Potential', 9, 15,
   'Collecting data on changes in condition, lab values, diagnostic test prep and follow-up, potential complications of procedures, and reporting abnormal findings.', 7),
  ('phys_adaptation', 'pn-2026', 'Physiological Integrity', 'Physiological Adaptation', 7, 13,
   'Caring for clients with acute, chronic or life-threatening conditions: recognizing alterations in body systems, fluid and electrolyte imbalances, medical emergencies, and responding to unexpected changes.', 8);

-- ---------------------------------------------------------------------------
-- Seed: NCSBN Clinical Judgment Measurement Model (NGN) cognitive steps
-- ---------------------------------------------------------------------------

insert into ngn_clinical_judgment_steps (id, step_order, name, question, lpn_example) values
  ('recognize_cues', 1, 'Recognize Cues', 'What matters most in the data I collected?',
   'Notices the client''s oxygen saturation dropped from 96% to 89% and they are newly restless.'),
  ('analyze_cues', 2, 'Analyze Cues', 'What could these cues mean together?',
   'Links restlessness, low SpO2 and post-op day 2 to a possible pulmonary embolism.'),
  ('prioritize_hypotheses', 3, 'Prioritize Hypotheses', 'Which possibility is the most urgent?',
   'Ranks impaired gas exchange above pain using the ABCs.'),
  ('generate_solutions', 4, 'Generate Solutions', 'What actions are within my scope and would help?',
   'Plans to raise the head of the bed, apply ordered oxygen, and notify the RN.'),
  ('take_action', 5, 'Take Action', 'What do I do first, right now?',
   'Stays with the client, applies oxygen per protocol, and reports to the RN using SBAR.'),
  ('evaluate_outcomes', 6, 'Evaluate Outcomes', 'Did it work, and what has changed?',
   'Rechecks SpO2 and respiratory effort and reports whether the client improved.');

-- ---------------------------------------------------------------------------
-- Seed: HESI PN Exit content domains and classic testing patterns
-- Domain list and hints are written for study use; they are not copied from Elsevier materials.
-- ---------------------------------------------------------------------------

insert into hesi_pn_domains (id, name, priority, classic_hint, sort_order) values
  ('fundamentals', 'Fundamentals of Nursing', 'high',
   'Safety first: when two answers look right, pick the one that protects the client from immediate harm.', 1),
  ('pharmacology', 'Pharmacology', 'high',
   'Know the hold parameters: apical pulse under 60 for digoxin, low BP for antihypertensives, and check potassium with loop diuretics.', 2),
  ('med_surg', 'Medical-Surgical Nursing', 'high',
   'Early signs beat late signs: restlessness and anxiety come before cyanosis in hypoxia.', 3),
  ('maternity', 'Maternity Nursing', 'medium',
   'Late decelerations mean placental insufficiency: turn to the left side, stop oxytocin, give oxygen, and notify.', 4),
  ('pediatrics', 'Pediatric Nursing', 'medium',
   'Match care to developmental stage, and remember children compensate well and then crash fast.', 5),
  ('mental_health', 'Mental Health Nursing', 'medium',
   'Safety before therapy: assess for suicide risk first, then use therapeutic communication.', 6),
  ('gerontology', 'Gerontological Nursing', 'medium',
   'New confusion in an older adult is not normal aging: check for infection, hypoxia, or medication effects.', 7),
  ('nutrition', 'Nutrition', 'low',
   'Pair the diet with the disease: low sodium for heart failure, low protein with high calories for kidney failure.', 8),
  ('leadership', 'Leadership and Management (LPN Scope)', 'high',
   'The LPN does not delegate assessment, teaching or evaluation, and gives unstable clients to the RN.', 9);

insert into hesi_score_benchmarks (id, min_score, max_score, label, meaning) values
  ('excellent', 950, null, 'Excellent', 'Very likely to pass the NCLEX-PN.'),
  ('recommended', 900, 949, 'Recommended', 'The score most programs aim for before the NCLEX-PN.'),
  ('acceptable', 850, 899, 'Acceptable', 'Passing at many programs; keep reviewing weak areas.'),
  ('needs_work', 800, 849, 'Needs Work', 'Focused remediation is recommended.'),
  ('at_risk', 0, 799, 'At Risk', 'Intensive review is recommended before testing.');

insert into courses (id, name, sort_order, default_hesi_domain_id) values
  ('fundamentals', 'Fundamentals', 1, 'fundamentals'),
  ('pharmacology', 'Pharmacology', 2, 'pharmacology'),
  ('med_surg', 'Med-Surg', 3, 'med_surg'),
  ('maternal_peds', 'Maternal/Peds', 4, 'maternity');

-- ---------------------------------------------------------------------------
-- User learning path: textbook -> units -> modules -> stepping stones
-- ---------------------------------------------------------------------------

create table textbooks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  course_id text not null references courses(id),
  title text not null,
  authors text[] not null default '{}',
  isbn text,
  edition text,
  cover_url text,
  toc_source text not null check (toc_source in ('google_books', 'openlibrary', 'vision_ocr', 'manual')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table units (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  textbook_id uuid not null references textbooks(id) on delete cascade,
  title text not null,
  sort_order int not null,
  unique (textbook_id, sort_order)
);

create table modules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  unit_id uuid not null references units(id) on delete cascade,
  title text not null,
  chapter_number text,
  sort_order int not null,
  unique (unit_id, sort_order)
);

create table stepping_stones (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  module_id uuid not null references modules(id) on delete cascade,
  title text not null,
  summary text,
  sort_order int not null,
  status stone_status not null default 'locked',
  mastery numeric(4,3) not null default 0 check (mastery between 0 and 1),
  embedding vector(1024),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (module_id, sort_order)
);

create table stone_blueprint_tags (
  stone_id uuid not null references stepping_stones(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  client_need_id text not null references nclex_client_needs(id),
  hesi_domain_id text not null references hesi_pn_domains(id),
  relevance numeric(3,2) not null default 1 check (relevance between 0 and 1),
  primary key (stone_id, client_need_id, hesi_domain_id)
);

-- ---------------------------------------------------------------------------
-- Magic Add ingestion log
-- ---------------------------------------------------------------------------

create table ingest_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind ingest_kind not null default 'unknown',
  state ingest_state not null default 'pending',
  raw_text text,
  storage_path text,
  result jsonb not null default '{}'::jsonb,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- NotebookLM notes (RAG)
-- Embeddings are 1024-dimensional (Voyage AI voyage-3 family, Anthropic's recommended embedding provider).
-- ---------------------------------------------------------------------------

create table note_sources (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  ingest_item_id uuid references ingest_items(id) on delete set null,
  title text not null,
  created_at timestamptz not null default now()
);

create table note_chunks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source_id uuid not null references note_sources(id) on delete cascade,
  stone_id uuid references stepping_stones(id) on delete set null,
  chunk_index int not null,
  content text not null,
  is_exam_pearl boolean not null default false,
  embedding vector(1024) not null,
  created_at timestamptz not null default now(),
  unique (source_id, chunk_index)
);

create index note_chunks_embedding_idx on note_chunks using hnsw (embedding vector_cosine_ops);
create index stepping_stones_embedding_idx on stepping_stones using hnsw (embedding vector_cosine_ops);

-- ---------------------------------------------------------------------------
-- UWorld questions the user uploaded, and newly written twin questions
-- ---------------------------------------------------------------------------

create table uworld_questions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  ingest_item_id uuid references ingest_items(id) on delete set null,
  stone_id uuid references stepping_stones(id) on delete set null,
  vignette text not null,
  choices jsonb not null,
  correct_answer text not null,
  core_takeaway text not null,
  trap_analysis jsonb not null default '[]'::jsonb,
  user_missed boolean not null,
  client_need_id text references nclex_client_needs(id),
  hesi_domain_id text references hesi_pn_domains(id),
  created_at timestamptz not null default now()
);

create table practice_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  stone_id uuid not null references stepping_stones(id) on delete cascade,
  origin_question_id uuid references uworld_questions(id) on delete set null,
  item_type text not null check (item_type in ('twin_mcq', 'sata', 'ngn_mini_bowtie')),
  ngn_step_id text references ngn_clinical_judgment_steps(id),
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create table practice_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  practice_item_id uuid not null references practice_items(id) on delete cascade,
  is_correct boolean not null,
  answered_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Lessons: generated once per stone, cached, regenerated only when sources change
-- ---------------------------------------------------------------------------

create table lessons (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  stone_id uuid not null unique references stepping_stones(id) on delete cascade,
  cards jsonb not null,
  source_fingerprint text not null,
  model text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

create trigger textbooks_updated_at before update on textbooks for each row execute function set_updated_at();
create trigger stepping_stones_updated_at before update on stepping_stones for each row execute function set_updated_at();
create trigger ingest_items_updated_at before update on ingest_items for each row execute function set_updated_at();
create trigger lessons_updated_at before update on lessons for each row execute function set_updated_at();

-- A missed UWorld question lights its stone up Ruby Red.
create or replace function flag_missed_question() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.user_missed and new.stone_id is not null then
    update stepping_stones set status = 'needs_review'
    where id = new.stone_id and user_id = new.user_id;
  end if;
  return new;
end;
$$;

create trigger uworld_questions_flag_missed
  after insert or update of user_missed, stone_id on uworld_questions
  for each row execute function flag_missed_question();

-- ---------------------------------------------------------------------------
-- Semantic search over the user's own notes
-- ---------------------------------------------------------------------------

create or replace function match_note_chunks(
  query_embedding vector(1024),
  match_count int default 8,
  min_similarity float default 0.5
) returns table (id uuid, source_id uuid, stone_id uuid, content text, is_exam_pearl boolean, similarity float)
language sql stable security invoker set search_path = public as $$
  select c.id, c.source_id, c.stone_id, c.content, c.is_exam_pearl,
         1 - (c.embedding <=> query_embedding) as similarity
  from note_chunks c
  where c.user_id = auth.uid()
    and 1 - (c.embedding <=> query_embedding) >= min_similarity
  order by c.embedding <=> query_embedding
  limit match_count;
$$;

-- ---------------------------------------------------------------------------
-- Readiness: accuracy per NCLEX client need, weighted by the test plan midpoint
-- ---------------------------------------------------------------------------

create or replace view client_need_accuracy with (security_invoker = true) as
select
  pa.user_id,
  cn.id as client_need_id,
  cn.name,
  (cn.min_pct + cn.max_pct) / 2 as weight_pct,
  count(*) as attempts,
  avg(case when pa.is_correct then 1.0 else 0.0 end) as accuracy
from practice_attempts pa
join practice_items pi on pi.id = pa.practice_item_id
join stone_blueprint_tags t on t.stone_id = pi.stone_id
join nclex_client_needs cn on cn.id = t.client_need_id
join nclex_test_plans tp on tp.id = cn.test_plan_id and tp.is_current
group by pa.user_id, cn.id, cn.name, cn.min_pct, cn.max_pct;

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

alter table nclex_test_plans enable row level security;
alter table nclex_client_needs enable row level security;
alter table ngn_clinical_judgment_steps enable row level security;
alter table hesi_pn_domains enable row level security;
alter table hesi_score_benchmarks enable row level security;
alter table courses enable row level security;

create policy "reference read" on nclex_test_plans for select to authenticated using (true);
create policy "reference read" on nclex_client_needs for select to authenticated using (true);
create policy "reference read" on ngn_clinical_judgment_steps for select to authenticated using (true);
create policy "reference read" on hesi_pn_domains for select to authenticated using (true);
create policy "reference read" on hesi_score_benchmarks for select to authenticated using (true);
create policy "reference read" on courses for select to authenticated using (true);

do $$
declare t text;
begin
  foreach t in array array[
    'textbooks', 'units', 'modules', 'stepping_stones', 'stone_blueprint_tags',
    'ingest_items', 'note_sources', 'note_chunks', 'uworld_questions',
    'practice_items', 'practice_attempts', 'lessons'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format(
      'create policy "owner access" on %I for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid())',
      t
    );
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Storage: private bucket for screenshots and TOC photos, one folder per user
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public) values ('uploads', 'uploads', false)
on conflict (id) do nothing;

create policy "own uploads read" on storage.objects for select to authenticated
  using (bucket_id = 'uploads' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "own uploads write" on storage.objects for insert to authenticated
  with check (bucket_id = 'uploads' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "own uploads delete" on storage.objects for delete to authenticated
  using (bucket_id = 'uploads' and (storage.foldername(name))[1] = auth.uid()::text);
