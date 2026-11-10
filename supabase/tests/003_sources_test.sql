-- Database tests for stage 3: notebooks, textbook PDF passages, course plans, card questions and search.

\set ON_ERROR_STOP 1

-- A unit vector along one axis, so similarities in these tests are exact.
create function pg_temp.axis(i int, j int default null) returns vector
language sql immutable as $$
  select array(
    select case when g = i then 1 when g = j then 1 else 0 end::real from generate_series(1, 1024) g
  )::vector
$$;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000d1', 'd1@example.com'),
  ('00000000-0000-0000-0000-0000000000d2', 'd2@example.com');

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000d1', false);

-- Two books, so linking can be shown to stay inside one book.
create temporary table books as
select
  create_syllabus(
    '{"course_id":"fundamentals","title":"Foundations","authors":[],"toc_source":"manual"}',
    jsonb_build_object('units', jsonb_build_array(jsonb_build_object('title', 'U1', 'modules', jsonb_build_array(
      jsonb_build_object('title', 'Infection control', 'chapter_number', '1', 'stones', jsonb_build_array(
        jsonb_build_object('title', 'Hand hygiene', 'summary', 'Wash hands', 'key_topics', '[]'::jsonb, 'tags', '[]'::jsonb),
        jsonb_build_object('title', 'PPE order', 'summary', 'Donning and doffing', 'key_topics', '[]'::jsonb, 'tags', '[]'::jsonb)
      ))
    ))))
  ) as fund_id,
  create_syllabus(
    '{"course_id":"pharmacology","title":"Pharm","authors":[],"toc_source":"manual"}',
    jsonb_build_object('units', jsonb_build_array(jsonb_build_object('title', 'U1', 'modules', jsonb_build_array(
      jsonb_build_object('title', 'Cardiac', 'chapter_number', '1', 'stones', jsonb_build_array(
        jsonb_build_object('title', 'Digoxin', 'summary', 'Hold parameters', 'key_topics', '[]'::jsonb, 'tags', '[]'::jsonb)
      ))
    ))))
  ) as pharm_id;

update stepping_stones set embedding = pg_temp.axis(1) where title = 'Hand hygiene';
update stepping_stones set embedding = pg_temp.axis(2) where title = 'PPE order';
update stepping_stones set embedding = pg_temp.axis(3) where title = 'Digoxin';

-- Notebooks: names are unique per student, ignoring case and spaces.
do $$
begin
  insert into notebooks (user_id, name) values (auth.uid(), 'Pharm notebook');
  begin
    insert into notebooks (user_id, name) values (auth.uid(), '  pharm NOTEBOOK ');
    raise exception 'duplicate notebook name accepted';
  exception when unique_violation then null;
  end;
  begin
    insert into notebooks (user_id, name) values (auth.uid(), '   ');
    raise exception 'blank notebook name accepted';
  exception when check_violation then null;
  end;
  begin
    insert into notebooks (user_id, name, color) values (auth.uid(), 'Odd', 'plaid');
    raise exception 'unknown color accepted';
  exception when check_violation then null;
  end;
end $$;

-- Deleting a notebook keeps its notes (the app removes them on purpose; the database never loses them by accident).
do $$
declare nb uuid; src uuid; nb_after uuid;
begin
  insert into notebooks (user_id, name) values (auth.uid(), 'Scratch') returning id into nb;
  insert into note_sources (user_id, title, notebook_id) values (auth.uid(), 'Loose notes', nb) returning id into src;
  delete from notebooks where id = nb;
  select notebook_id into nb_after from note_sources where id = src;
  if nb_after is not null then raise exception 'notebook link should clear'; end if;
end $$;

-- Textbook passages link to the closest stone of their own book only.
do $$
declare
  fund uuid := (select fund_id from books);
  f uuid;
  linked int;
  hand uuid := (select id from stepping_stones where title = 'Hand hygiene');
  ppe uuid := (select id from stepping_stones where title = 'PPE order');
  n int;
begin
  insert into textbook_files (user_id, textbook_id, part_number, storage_path, bytes, content_hash)
  values (auth.uid(), fund, 1, auth.uid() || '/textbooks/' || fund || '/part-1.pdf', 1000, 'h1')
  returning id into f;

  begin
    insert into textbook_files (user_id, textbook_id, part_number, storage_path, bytes, content_hash)
    values (auth.uid(), fund, 1, 'x', 10, 'h');
    raise exception 'duplicate part accepted';
  exception when unique_violation then null;
  end;

  insert into textbook_chunks (user_id, textbook_id, file_id, chunk_index, page_from, page_to, heading, content, embedding) values
    (auth.uid(), fund, f, 0, 12, 12, 'Chapter 1 > Hand hygiene', 'Rub hands for 20 seconds.', pg_temp.axis(1)),
    (auth.uid(), fund, f, 1, 13, 14, 'Chapter 1 > PPE', 'Gloves come off first.', pg_temp.axis(2)),
    -- Closest to Digoxin, which is in another book, so it must stay unlinked.
    (auth.uid(), fund, f, 2, 15, 15, 'Chapter 1 > Aside', 'Cardiac glycosides.', pg_temp.axis(3, 5));

  select coalesce(sum(chunk_count), 0) into linked from link_textbook_chunks(fund, 0.35);
  if linked <> 2 then raise exception 'expected 2 linked passages, got %', linked; end if;
  if (select stone_id from textbook_chunks where chunk_index = 0) is distinct from hand then raise exception 'passage 0 linked wrong'; end if;
  if (select stone_id from textbook_chunks where chunk_index = 1) is distinct from ppe then raise exception 'passage 1 linked wrong'; end if;
  if (select stone_id from textbook_chunks where chunk_index = 2) is not null then raise exception 'passage linked across books'; end if;

  -- A second run finds nothing new.
  select count(*) into n from link_textbook_chunks(fund, 0.35);
  if n <> 0 then raise exception 'relink should be a no-op'; end if;

  select count(*) into n from stone_textbook_chunks(ppe, 6);
  if n <> 1 then raise exception 'stone passages: %', n; end if;

  select count(*) into n from match_textbook_chunks(pg_temp.axis(3), 5, 0.6);
  if n <> 1 then raise exception 'meaning match: %', n; end if;

  begin
    insert into textbook_chunks (user_id, textbook_id, file_id, chunk_index, page_from, page_to, content, embedding)
    values (auth.uid(), fund, f, 9, 20, 19, 'Backwards', pg_temp.axis(4));
    raise exception 'page_to before page_from accepted';
  exception when check_violation then null;
  end;
end $$;

-- Search finds things by words and by meaning, best first.
do $$
declare top record; n int;
begin
  select * into top from search_study('gloves', pg_temp.axis(900), 10) limit 1;
  if top.kind <> 'textbook' or top.snippet <> 'Gloves come off first.' then raise exception 'word search: % %', top.kind, top.snippet; end if;
  if top.title <> 'Foundations, p. 13' then raise exception 'passage title: %', top.title; end if;

  select * into top from search_study('zzz', pg_temp.axis(3), 10) limit 1;
  if top.kind <> 'stone' or top.title <> 'Digoxin' then raise exception 'meaning search: % %', top.kind, top.title; end if;

  -- Wildcards in the search box are matched literally.
  select count(*) into n from search_study('%', pg_temp.axis(900), 10);
  if n <> 0 then raise exception 'a bare %% matched % rows', n; end if;
end $$;

-- Course plans: one row per version, weeks numbered once, coverage from a fixed list.
do $$
declare p uuid;
begin
  insert into course_plans (user_id, course_id, version, source_fingerprint, model) values (auth.uid(), 'fundamentals', 1, 'fp', 'm') returning id into p;
  insert into course_plan_weeks (user_id, plan_id, week_number, title, coverage) values (auth.uid(), p, 1, 'Week 1', 'full');
  begin
    insert into course_plan_weeks (user_id, plan_id, week_number, title, coverage) values (auth.uid(), p, 1, 'Again', 'full');
    raise exception 'duplicate week accepted';
  exception when unique_violation then null;
  end;
  begin
    insert into course_plan_weeks (user_id, plan_id, week_number, title, coverage) values (auth.uid(), p, 2, 'Week 2', 'guessed');
    raise exception 'unknown coverage accepted';
  exception when check_violation then null;
  end;
end $$;

-- Plan sources: each stone of a course with the passages, notes and questions behind it.
do $$
declare r record;
begin
  select * into r from course_plan_sources('fundamentals') where stone_id = (select id from stepping_stones where title = 'PPE order');
  if r.passages <> 1 or r.page_from <> 13 or r.page_to <> 14 or r.book <> 'Foundations' then
    raise exception 'plan sources: % % % %', r.passages, r.page_from, r.page_to, r.book;
  end if;
  if (select count(*) from course_plan_sources('fundamentals')) <> 2 then raise exception 'plan sources should list both stones'; end if;
  if (select count(*) from course_plan_sources('pharmacology')) <> 1 then raise exception 'plan sources mixed courses'; end if;
end $$;

-- Card questions: a question has to say something, and not too much.
do $$
declare s uuid := (select id from stepping_stones where title = 'Digoxin');
begin
  insert into card_questions (user_id, stone_id, card_id, question, answer) values (auth.uid(), s, 'eli10', 'Why hold it?', 'Because...');
  begin
    insert into card_questions (user_id, stone_id, card_id, question, answer) values (auth.uid(), s, 'eli10', repeat('x', 501), 'a');
    raise exception 'long question accepted';
  exception when check_violation then null;
  end;
end $$;

-- Another student sees none of it.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000d2', false);
do $$
declare n int;
begin
  select (select count(*) from notebooks) + (select count(*) from textbook_files) + (select count(*) from textbook_chunks)
       + (select count(*) from course_plans) + (select count(*) from course_plan_weeks) + (select count(*) from card_questions)
    into n;
  if n <> 0 then raise exception 'another student can see % stage 3 rows', n; end if;
  select count(*) into n from search_study('gloves', pg_temp.axis(1), 10);
  if n <> 0 then raise exception 'search leaked % rows', n; end if;
  select count(*) into n from course_plan_sources('fundamentals');
  if n <> 0 then raise exception 'plan sources leaked % rows', n; end if;
  begin
    insert into notebooks (user_id, name) values ('00000000-0000-0000-0000-0000000000d1', 'Sneaky');
    raise exception 'wrote a notebook for someone else';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;
