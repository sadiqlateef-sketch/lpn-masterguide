-- Stage 3: several NotebookLM notebooks, whole textbook PDFs, course plans, "Ask about this card" and search.
-- New tables only, plus one nullable column on note_sources. Existing notes are moved into a "My notes" notebook.

-- ---------------------------------------------------------------------------
-- Notebooks
-- ---------------------------------------------------------------------------

create table notebooks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  color text not null default 'violet' check (color in ('violet', 'sky', 'emerald', 'amber', 'rose', 'cyan')),
  created_at timestamptz not null default now()
);
create unique index notebooks_user_name_key on notebooks (user_id, lower(btrim(name)));

alter table note_sources add column notebook_id uuid references notebooks(id) on delete set null;
create index note_sources_notebook_idx on note_sources (notebook_id);

insert into notebooks (user_id, name)
select distinct user_id, 'My notes' from note_sources
on conflict do nothing;

update note_sources s
set notebook_id = n.id
from notebooks n
where s.notebook_id is null and n.user_id = s.user_id and lower(n.name) = 'my notes';

-- ---------------------------------------------------------------------------
-- Whole textbook PDFs, uploaded in parts straight to Storage and read one part at a time
-- ---------------------------------------------------------------------------

alter table textbooks add column pdf_parts int check (pdf_parts between 1 and 40);

create table textbook_files (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  textbook_id uuid not null references textbooks(id) on delete cascade,
  part_number int not null check (part_number between 1 and 40),
  storage_path text not null,
  bytes bigint not null check (bytes > 0),
  content_hash text not null,
  -- Page number (in the whole book) of this part's first page. Known once the earlier parts are read.
  page_offset int not null default 0 check (page_offset >= 0),
  pages int check (pages >= 0),
  chunks int not null default 0,
  state text not null default 'uploaded' check (state in ('uploaded', 'processing', 'done', 'no_text', 'failed')),
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (textbook_id, part_number)
);
create trigger textbook_files_updated_at before update on textbook_files for each row execute function set_updated_at();

create table textbook_chunks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  textbook_id uuid not null references textbooks(id) on delete cascade,
  file_id uuid not null references textbook_files(id) on delete cascade,
  chunk_index int not null,
  page_from int not null check (page_from >= 1),
  page_to int not null check (page_to >= page_from),
  heading text not null default '',
  content text not null,
  embedding vector(1024) not null,
  stone_id uuid references stepping_stones(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (file_id, chunk_index)
);
create index textbook_chunks_embedding_idx on textbook_chunks using hnsw (embedding vector_cosine_ops);
create index textbook_chunks_stone_idx on textbook_chunks (stone_id);
create index textbook_chunks_textbook_idx on textbook_chunks (textbook_id);

-- Links a book's unlinked passages to the closest stepping stone of the same book.
create or replace function link_textbook_chunks(p_textbook_id uuid, min_similarity float default 0.35)
returns table (stone_id uuid, chunk_count int)
language plpgsql security invoker set search_path = public as $$
begin
  return query
  with book_stones as (
    select s.id, s.embedding
    from stepping_stones s
    join modules m on m.id = s.module_id
    join units u on u.id = m.unit_id
    where u.textbook_id = p_textbook_id and s.user_id = auth.uid() and s.embedding is not null
  ),
  best as (
    select c.id as chunk_id, nearest.id as stone_id
    from textbook_chunks c
    cross join lateral (
      select bs.id, 1 - (bs.embedding <=> c.embedding) as similarity
      from book_stones bs
      order by bs.embedding <=> c.embedding
      limit 1
    ) nearest
    where c.textbook_id = p_textbook_id
      and c.user_id = auth.uid()
      and c.stone_id is null
      and nearest.similarity >= min_similarity
  ),
  updated as (
    update textbook_chunks c set stone_id = best.stone_id
    from best
    where c.id = best.chunk_id
    returning c.stone_id
  )
  select u.stone_id, count(*)::int from updated u group by u.stone_id;
end;
$$;

-- The passages behind one stone, closest to the stone's own meaning first.
create or replace function stone_textbook_chunks(p_stone_id uuid, match_count int default 6)
returns table (id uuid, textbook_id uuid, page_from int, page_to int, heading text, content text, similarity float)
language sql stable security invoker set search_path = public as $$
  select c.id, c.textbook_id, c.page_from, c.page_to, c.heading, c.content,
         case when s.embedding is null then 0 else 1 - (c.embedding <=> s.embedding) end
  from textbook_chunks c
  join stepping_stones s on s.id = c.stone_id
  where c.stone_id = p_stone_id and c.user_id = auth.uid()
  order by case when s.embedding is null then 0 else c.embedding <=> s.embedding end, c.page_from
  limit match_count;
$$;

create or replace function match_textbook_chunks(
  query_embedding vector(1024),
  match_count int default 8,
  min_similarity float default 0.4
) returns table (id uuid, textbook_id uuid, stone_id uuid, page_from int, page_to int, heading text, content text, similarity float)
language sql stable security invoker set search_path = public as $$
  select c.id, c.textbook_id, c.stone_id, c.page_from, c.page_to, c.heading, c.content,
         1 - (c.embedding <=> query_embedding)
  from textbook_chunks c
  where c.user_id = auth.uid()
    and 1 - (c.embedding <=> query_embedding) >= min_similarity
  order by c.embedding <=> query_embedding
  limit match_count;
$$;

-- A re-split book overwrites its parts in place, which needs update rights on the student's own folder.
create policy "own uploads update" on storage.objects for update to authenticated
  using (bucket_id = 'uploads' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'uploads' and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------------------------------------------------------------------------
-- Course plans: weeks drafted from the student's own sources, redrafted when the sources change
-- ---------------------------------------------------------------------------

create table course_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  course_id text not null references courses(id),
  version int not null check (version >= 1),
  source_fingerprint text not null,
  model text not null,
  summary text not null default '',
  created_at timestamptz not null default now(),
  unique (user_id, course_id, version)
);

create table course_plan_weeks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  plan_id uuid not null references course_plans(id) on delete cascade,
  week_number int not null check (week_number >= 1),
  title text not null,
  goals text[] not null default '{}',
  stone_ids uuid[] not null default '{}',
  -- What fed this week: textbook pages, notebooks and saved questions, counted by the server, never by the model.
  source_refs jsonb not null default '{}'::jsonb,
  coverage text not null check (coverage in ('full', 'partial', 'outline_only')),
  unique (plan_id, week_number)
);

-- What each stone of a course has behind it, so the plan can say which sources fed each week.
create or replace function course_plan_sources(p_course_id text)
returns table (stone_id uuid, book text, passages int, page_from int, page_to int, notes int, notebooks text[], questions int)
language sql stable security invoker set search_path = public as $$
  select s.id, t.title,
    (select count(*)::int from textbook_chunks c where c.stone_id = s.id),
    (select min(c.page_from) from textbook_chunks c where c.stone_id = s.id),
    (select max(c.page_to) from textbook_chunks c where c.stone_id = s.id),
    (select count(*)::int from note_chunks n where n.stone_id = s.id),
    (select coalesce(array_agg(distinct nb.name order by nb.name), '{}')
       from note_chunks n
       join note_sources ns on ns.id = n.source_id
       join notebooks nb on nb.id = ns.notebook_id
      where n.stone_id = s.id),
    (select count(*)::int from uworld_questions q where q.stone_id = s.id)
  from stepping_stones s
  join modules m on m.id = s.module_id
  join units u on u.id = m.unit_id
  join textbooks t on t.id = u.textbook_id
  where t.course_id = p_course_id and s.user_id = auth.uid();
$$;

-- ---------------------------------------------------------------------------
-- Ask about this card
-- ---------------------------------------------------------------------------

create table card_questions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  stone_id uuid not null references stepping_stones(id) on delete cascade,
  card_id text not null,
  question text not null check (char_length(question) between 1 and 500),
  answer text not null,
  in_scope boolean not null default true,
  source_refs jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);
create index card_questions_stone_idx on card_questions (stone_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Search: by meaning (embeddings) and by words, across stones, notes, textbook passages and saved questions
-- ---------------------------------------------------------------------------

create or replace function search_study(q text, query_embedding vector(1024), match_count int default 20)
returns table (kind text, id uuid, stone_id uuid, title text, snippet text, score float)
language sql stable security invoker set search_path = public as $$
  with words as (
    select '%' || replace(replace(replace(btrim(q), '\', '\\'), '%', '\%'), '_', '\_') || '%' as pattern
  ),
  hits as (
    select 'stone'::text, s.id, s.id, s.title, coalesce(s.summary, ''),
           greatest(case when s.embedding is null then 0 else 1 - (s.embedding <=> query_embedding) end,
                    case when s.title ilike w.pattern then 0.9 else 0 end)
    from stepping_stones s, words w
    where s.user_id = auth.uid()
    union all
    select 'note', c.id, c.stone_id, coalesce(ns.title, 'My notes'), c.content,
           greatest(1 - (c.embedding <=> query_embedding), case when c.content ilike w.pattern then 0.75 else 0 end)
    from note_chunks c
    left join note_sources ns on ns.id = c.source_id, words w
    where c.user_id = auth.uid()
    union all
    select 'textbook', c.id, c.stone_id, t.title || ', p. ' || c.page_from, c.content,
           greatest(1 - (c.embedding <=> query_embedding), case when c.content ilike w.pattern then 0.7 else 0 end)
    from textbook_chunks c
    join textbooks t on t.id = c.textbook_id, words w
    where c.user_id = auth.uid()
    union all
    select 'question', uq.id, uq.stone_id, coalesce(nullif(uq.topic, ''), 'Saved question'), uq.core_takeaway,
           greatest(case when uq.embedding is null then 0 else 1 - (uq.embedding <=> query_embedding) end,
                    case when uq.topic ilike w.pattern or uq.vignette ilike w.pattern then 0.75 else 0 end)
    from uworld_questions uq, words w
    where uq.user_id = auth.uid()
  )
  select * from hits h(kind, id, stone_id, title, snippet, score)
  where h.score >= 0.45
  order by h.score desc
  limit least(greatest(match_count, 1), 50);
$$;

-- ---------------------------------------------------------------------------
-- Row-level security: each student sees only their own rows
-- ---------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array['notebooks', 'textbook_files', 'textbook_chunks', 'course_plans', 'course_plan_weeks', 'card_questions'] loop
    execute format('alter table %I enable row level security', t);
    execute format(
      'create policy "owner access" on %I for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid())',
      t
    );
  end loop;
end;
$$;
