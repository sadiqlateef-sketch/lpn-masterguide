-- Database tests: seed data, row-level security, the missed-question trigger, syllabus creation,
-- and the semantic linking functions. Each check raises an exception on failure.

\set ON_ERROR_STOP 1

-- Seed data ------------------------------------------------------------------

do $$
declare n int; lo numeric; hi numeric;
begin
  select count(*), sum(min_pct), sum(max_pct) into n, lo, hi
  from nclex_client_needs cn join nclex_test_plans tp on tp.id = cn.test_plan_id and tp.is_current;
  if n <> 8 then raise exception 'expected 8 client needs, got %', n; end if;
  if not (lo <= 100 and hi >= 100) then raise exception 'weights % - % cannot add to 100', lo, hi; end if;

  select count(*) into n from ngn_clinical_judgment_steps;
  if n <> 6 then raise exception 'expected 6 NGN steps, got %', n; end if;

  select count(*) into n from hesi_pn_domains;
  if n < 9 then raise exception 'expected at least 9 HESI domains, got %', n; end if;

  select count(*) into n from courses;
  if n <> 4 then raise exception 'expected 4 courses, got %', n; end if;
end $$;

-- Two users ------------------------------------------------------------------

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'a@example.com'),
  ('00000000-0000-0000-0000-00000000000b', 'b@example.com');

create function pg_temp.vec(hot int) returns vector language sql as $$
  select (array_fill(0::real, array[hot - 1]) || array[1::real] || array_fill(0::real, array[1024 - hot]))::vector
$$;

create function pg_temp.vec_mix(a int, b int) returns vector language sql as $$
  select (
    array_fill(0::real, array[a - 1]) || array[0.9::real] ||
    array_fill(0::real, array[b - a - 1]) || array[0.1::real] ||
    array_fill(0::real, array[1024 - b])
  )::vector
$$;

grant execute on function pg_temp.vec(int), pg_temp.vec_mix(int, int) to authenticated;

-- User A builds a syllabus ---------------------------------------------------

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);

select create_syllabus(
  jsonb_build_object(
    'course_id', 'fundamentals', 'title', 'Foundations of Nursing', 'authors', jsonb_build_array('Cooper', 'Gosnell'),
    'isbn', '9780323812054', 'edition', '9th', 'cover_url', '', 'toc_source', 'manual'
  ),
  jsonb_build_object('units', jsonb_build_array(
    jsonb_build_object('title', 'Unit 1: Safety', 'modules', jsonb_build_array(
      jsonb_build_object('title', 'Infection Prevention', 'chapter_number', '1', 'stones', jsonb_build_array(
        jsonb_build_object('title', 'Hand hygiene', 'summary', 'When and how to clean hands.', 'key_topics', jsonb_build_array('hand hygiene'),
          'embedding', pg_temp.vec(1)::text,
          'tags', jsonb_build_array(jsonb_build_object('client_need_id', 'safety_infection', 'hesi_domain_id', 'fundamentals', 'relevance', 1))),
        jsonb_build_object('title', 'Isolation precautions', 'summary', 'Contact, droplet, airborne.', 'key_topics', jsonb_build_array('PPE'),
          'embedding', pg_temp.vec(2)::text,
          'tags', jsonb_build_array(jsonb_build_object('client_need_id', 'safety_infection', 'hesi_domain_id', 'fundamentals')))
      ))
    ))
  ))
);

do $$
declare n int; first_status stone_status; second_status stone_status;
begin
  select count(*) into n from stepping_stones;
  if n <> 2 then raise exception 'user A should see 2 stones, saw %', n; end if;
  select status into first_status from stepping_stones where title = 'Hand hygiene';
  select status into second_status from stepping_stones where title = 'Isolation precautions';
  if first_status <> 'ready' or second_status <> 'locked' then
    raise exception 'first stone should be ready and the rest locked, got % / %', first_status, second_status;
  end if;
  select count(*) into n from stone_blueprint_tags;
  if n <> 2 then raise exception 'expected 2 blueprint tags, got %', n; end if;
end $$;

-- Notes link to the nearest stone ---------------------------------------------

insert into note_sources (id, user_id, title) values ('00000000-0000-0000-0000-0000000000f1', auth.uid(), 'NotebookLM: Infection control');
insert into note_chunks (user_id, source_id, chunk_index, content, embedding) values
  (auth.uid(), '00000000-0000-0000-0000-0000000000f1', 0, 'Wash hands 20 seconds; alcohol rub unless C. diff.', pg_temp.vec_mix(1, 500)),
  (auth.uid(), '00000000-0000-0000-0000-0000000000f1', 1, 'N95 for TB, measles, chickenpox.', pg_temp.vec_mix(2, 500)),
  (auth.uid(), '00000000-0000-0000-0000-0000000000f1', 2, 'Unrelated grocery list.', pg_temp.vec(900));

do $$
declare linked int; still_unlinked int; hygiene_chunks int;
begin
  select coalesce(sum(chunk_count), 0) into linked from link_unlinked_note_chunks(0.5);
  select count(*) into still_unlinked from note_chunks where stone_id is null;
  select count(*) into hygiene_chunks from note_chunks c join stepping_stones s on s.id = c.stone_id where s.title = 'Hand hygiene';
  if linked <> 2 or still_unlinked <> 1 or hygiene_chunks <> 1 then
    raise exception 'note linking wrong: linked %, unlinked %, hand hygiene %', linked, still_unlinked, hygiene_chunks;
  end if;
end $$;

-- A missed UWorld question links to its stone and turns it Ruby Red ---------------

insert into uworld_questions (user_id, vignette, choices, correct_answer, core_takeaway, user_missed, topic, embedding)
values (auth.uid(), 'A client on contact precautions...', '[{"id":"A","text":"Gown and gloves"}]', 'A',
        'Contact precautions need gown and gloves.', true, 'isolation precautions', pg_temp.vec_mix(2, 600));

do $$
declare n int; s stone_status;
begin
  select count(*) into n from link_unlinked_questions(0.5);
  if n <> 1 then raise exception 'expected 1 linked question, got %', n; end if;
  select status into s from stepping_stones where title = 'Isolation precautions';
  if s <> 'needs_review' then raise exception 'missed question should flag the stone, got %', s; end if;
end $$;

-- match_stepping_stones ranks by similarity --------------------------------------

do $$
declare top text;
begin
  select title into top from match_stepping_stones(pg_temp.vec(2), 1, 0.1);
  if top is distinct from 'Isolation precautions' then raise exception 'wrong top match: %', top; end if;
end $$;

-- User B sees none of user A's data ---------------------------------------------

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);

do $$
declare n int;
begin
  select (select count(*) from textbooks) + (select count(*) from stepping_stones) + (select count(*) from note_chunks)
       + (select count(*) from uworld_questions) + (select count(*) from stone_blueprint_tags) into n;
  if n <> 0 then raise exception 'user B can see % of user A''s rows', n; end if;
  select count(*) into n from match_stepping_stones(pg_temp.vec(1), 5, 0);
  if n <> 0 then raise exception 'user B matched % of user A''s stones', n; end if;
  select count(*) into n from nclex_client_needs;
  if n <> 8 then raise exception 'user B should still read reference data, saw %', n; end if;
end $$;

do $$
begin
  begin
    insert into textbooks (user_id, course_id, title, toc_source)
    values ('00000000-0000-0000-0000-00000000000a', 'fundamentals', 'Sneaky', 'manual');
    raise exception 'user B wrote a row for user A';
  exception when insufficient_privilege then
    null;
  end;
end $$;

-- Signed-out callers cannot build a syllabus ------------------------------------

select set_config('request.jwt.claim.sub', '', false);

do $$
begin
  begin
    perform create_syllabus('{"course_id":"fundamentals","title":"x","toc_source":"manual"}', '{"units":[]}');
    raise exception 'signed-out syllabus build should fail';
  exception when insufficient_privilege then
    null;
  end;
end $$;

reset role;
