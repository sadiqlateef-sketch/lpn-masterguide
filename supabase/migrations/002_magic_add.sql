-- Phase 2: Magic Add ingestion, textbook syllabus building, and semantic linking.

alter type ingest_kind add value if not exists 'book_cover';

-- Textbook chapter lists can now also come from a web search.
alter table textbooks drop constraint if exists textbooks_toc_source_check;
alter table textbooks add constraint textbooks_toc_source_check
  check (toc_source in ('google_books', 'openlibrary', 'vision_ocr', 'web_search', 'manual'));

create unique index textbooks_user_isbn_key on textbooks (user_id, isbn) where isbn is not null;

alter table stepping_stones add column key_topics text[] not null default '{}';

alter table ingest_items add column summary text;

alter table uworld_questions
  add column user_answer text,
  add column topic text not null default '',
  add column ngn_step_id text references ngn_clinical_judgment_steps(id),
  add column embedding vector(1024);

create index uworld_questions_unlinked_idx on uworld_questions (user_id) where stone_id is null;
create index note_chunks_unlinked_idx on note_chunks (user_id) where stone_id is null;
create index note_chunks_stone_idx on note_chunks (stone_id);
create index stepping_stones_module_idx on stepping_stones (module_id, sort_order);

-- ---------------------------------------------------------------------------
-- Nearest stepping stones to a query embedding, for the signed-in user only.
-- ---------------------------------------------------------------------------

create or replace function match_stepping_stones(
  query_embedding vector(1024),
  match_count int default 5,
  min_similarity float default 0.3
) returns table (id uuid, title text, module_id uuid, similarity float)
language sql stable security invoker set search_path = public as $$
  select s.id, s.title, s.module_id, 1 - (s.embedding <=> query_embedding) as similarity
  from stepping_stones s
  where s.user_id = auth.uid()
    and s.embedding is not null
    and 1 - (s.embedding <=> query_embedding) >= min_similarity
  order by s.embedding <=> query_embedding
  limit match_count;
$$;

-- ---------------------------------------------------------------------------
-- Attach unlinked note chunks to their closest stone. Returns the stones that gained notes,
-- so their cached lessons can be regenerated.
-- ---------------------------------------------------------------------------

create or replace function link_unlinked_note_chunks(min_similarity float default 0.35)
returns table (stone_id uuid, chunk_count int)
language plpgsql security invoker set search_path = public as $$
begin
  return query
  with best as (
    select c.id as chunk_id, nearest.id as stone_id
    from note_chunks c
    cross join lateral (
      select s.id, 1 - (s.embedding <=> c.embedding) as similarity
      from stepping_stones s
      where s.user_id = c.user_id and s.embedding is not null
      order by s.embedding <=> c.embedding
      limit 1
    ) nearest
    where c.user_id = auth.uid()
      and c.stone_id is null
      and nearest.similarity >= min_similarity
  ),
  updated as (
    update note_chunks c set stone_id = best.stone_id
    from best
    where c.id = best.chunk_id
    returning c.stone_id
  )
  select u.stone_id, count(*)::int from updated u group by u.stone_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Attach unlinked UWorld questions to their closest stone. Missed questions light the stone up
-- through the existing flag_missed_question trigger.
-- ---------------------------------------------------------------------------

create or replace function link_unlinked_questions(min_similarity float default 0.35)
returns table (question_id uuid, stone_id uuid, user_missed boolean)
language plpgsql security invoker set search_path = public as $$
begin
  return query
  with best as (
    select q.id as question_id, nearest.id as stone_id
    from uworld_questions q
    cross join lateral (
      select s.id, 1 - (s.embedding <=> q.embedding) as similarity
      from stepping_stones s
      where s.user_id = q.user_id and s.embedding is not null
      order by s.embedding <=> q.embedding
      limit 1
    ) nearest
    where q.user_id = auth.uid()
      and q.stone_id is null
      and q.embedding is not null
      and nearest.similarity >= min_similarity
  )
  update uworld_questions q set stone_id = best.stone_id
  from best
  where q.id = best.question_id
  returning q.id, q.stone_id, q.user_missed;
end;
$$;

-- ---------------------------------------------------------------------------
-- Write a whole syllabus (units -> modules -> stones -> blueprint tags) in one transaction,
-- so a failed build never leaves a half-made path behind.
-- ---------------------------------------------------------------------------

create or replace function create_syllabus(textbook jsonb, syllabus jsonb)
returns uuid
language plpgsql security invoker set search_path = public as $$
declare
  uid uuid := auth.uid();
  book_id uuid;
  unit jsonb;
  module jsonb;
  stone jsonb;
  tag jsonb;
  unit_id uuid;
  module_id uuid;
  stone_id uuid;
  unit_order int := 0;
  module_order int;
  stone_order int;
  is_first boolean := true;
begin
  if uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  insert into textbooks (user_id, course_id, title, authors, isbn, edition, cover_url, toc_source)
  values (
    uid,
    textbook->>'course_id',
    textbook->>'title',
    coalesce(array(select jsonb_array_elements_text(textbook->'authors')), '{}'),
    nullif(textbook->>'isbn', ''),
    nullif(textbook->>'edition', ''),
    nullif(textbook->>'cover_url', ''),
    textbook->>'toc_source'
  )
  returning id into book_id;

  for unit in select * from jsonb_array_elements(syllabus->'units') loop
    unit_order := unit_order + 1;
    insert into units (user_id, textbook_id, title, sort_order)
    values (uid, book_id, unit->>'title', unit_order)
    returning id into unit_id;

    module_order := 0;
    for module in select * from jsonb_array_elements(unit->'modules') loop
      module_order := module_order + 1;
      insert into modules (user_id, unit_id, title, chapter_number, sort_order)
      values (uid, unit_id, module->>'title', nullif(module->>'chapter_number', ''), module_order)
      returning id into module_id;

      stone_order := 0;
      for stone in select * from jsonb_array_elements(module->'stones') loop
        stone_order := stone_order + 1;
        insert into stepping_stones (user_id, module_id, title, summary, key_topics, sort_order, status, embedding)
        values (
          uid,
          module_id,
          stone->>'title',
          stone->>'summary',
          coalesce(array(select jsonb_array_elements_text(stone->'key_topics')), '{}'),
          stone_order,
          case when is_first then 'ready'::stone_status else 'locked'::stone_status end,
          case when stone ? 'embedding' then (stone->>'embedding')::vector else null end
        )
        returning id into stone_id;
        is_first := false;

        for tag in select * from jsonb_array_elements(stone->'tags') loop
          insert into stone_blueprint_tags (stone_id, user_id, client_need_id, hesi_domain_id, relevance)
          values (stone_id, uid, tag->>'client_need_id', tag->>'hesi_domain_id', coalesce((tag->>'relevance')::numeric, 1))
          on conflict do nothing;
        end loop;
      end loop;
    end loop;
  end loop;

  return book_id;
end;
$$;
