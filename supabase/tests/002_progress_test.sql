-- Database tests for Phase 3: stone completion and unlocking, readiness inputs, and synced note replacement.

\set ON_ERROR_STOP 1

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000c1', 'c@example.com');

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c1', false);

create temporary table ids as
select create_syllabus(
  '{"course_id":"pharmacology","title":"Pharm Made Easy","authors":[],"toc_source":"manual"}',
  jsonb_build_object('units', jsonb_build_array(
    jsonb_build_object('title', 'U1', 'modules', jsonb_build_array(
      jsonb_build_object('title', 'M1', 'chapter_number', '1', 'stones', jsonb_build_array(
        jsonb_build_object('title', 'S1', 'summary', '', 'key_topics', '[]'::jsonb,
          'tags', jsonb_build_array(jsonb_build_object('client_need_id', 'pharm', 'hesi_domain_id', 'pharmacology'))),
        jsonb_build_object('title', 'S2', 'summary', '', 'key_topics', '[]'::jsonb, 'tags', '[]'::jsonb)
      )),
      jsonb_build_object('title', 'M2', 'chapter_number', '2', 'stones', jsonb_build_array(
        jsonb_build_object('title', 'S3', 'summary', '', 'key_topics', '[]'::jsonb, 'tags', '[]'::jsonb)
      ))
    ))
  ))
) as book_id;

-- A low score keeps the stone ready but still opens the next one; a high score masters it.
do $$
declare r record; s1 uuid; s2 uuid; s3 uuid;
begin
  select id into s1 from stepping_stones where title = 'S1';
  select id into s2 from stepping_stones where title = 'S2';
  select id into s3 from stepping_stones where title = 'S3';

  select * into r from complete_stone(s1, 0.5);
  if r.status <> 'ready' or r.unlocked_stone_id is distinct from s2 then
    raise exception 'low score: got % / %', r.status, r.unlocked_stone_id;
  end if;

  select * into r from complete_stone(s1, 0.9);
  if r.status <> 'mastered' or r.unlocked_stone_id is not null then
    raise exception 'second completion should master and unlock nothing new: % / %', r.status, r.unlocked_stone_id;
  end if;

  select * into r from complete_stone(s2, 1);
  if r.unlocked_stone_id is distinct from s3 then
    raise exception 'finishing the last stone of a module should open the next module: %', r.unlocked_stone_id;
  end if;

  select * into r from complete_stone(s3, 1);
  if r.unlocked_stone_id is not null then raise exception 'end of path should unlock nothing'; end if;

  begin
    perform complete_stone(s1, 1.5);
    raise exception 'score above 1 accepted';
  exception when invalid_parameter_value then null;
  end;
end $$;

-- Readiness counts attempts per client need and lists untouched needs with zero.
do $$
declare s1 uuid; item uuid; n int; c int; total int;
begin
  select id into s1 from stepping_stones where title = 'S1';
  insert into practice_items (user_id, stone_id, item_type, payload) values (auth.uid(), s1, 'lesson_mcq', '{}') returning id into item;
  insert into practice_attempts (user_id, practice_item_id, is_correct) values (auth.uid(), item, true), (auth.uid(), item, false), (auth.uid(), item, true);
  select attempts, correct into n, c from readiness_by_client_need() where client_need_id = 'pharm';
  if n <> 3 or c <> 2 then raise exception 'pharm readiness wrong: % / %', c, n; end if;
  select count(*) into total from readiness_by_client_need();
  if total <> 8 then raise exception 'expected all 8 client needs, got %', total; end if;
end $$;

-- Synced notes: one source per external key per student.
do $$
begin
  insert into note_sources (user_id, title, external_key, content_hash) values (auth.uid(), 'Cardiac', 'pharm/cardiac.md', 'h1');
  begin
    insert into note_sources (user_id, title, external_key, content_hash) values (auth.uid(), 'Cardiac again', 'pharm/cardiac.md', 'h2');
    raise exception 'duplicate external key accepted';
  exception when unique_violation then null;
  end;
end $$;

reset role;
