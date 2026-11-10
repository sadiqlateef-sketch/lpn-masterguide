-- Database tests for stage 6: questions tied to a client need, new item types, game rounds in
-- readiness, the mistake notebook, exams, drug cards and isolation between students.

\set ON_ERROR_STOP 1

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'g1@example.com'),
  ('00000000-0000-0000-0000-0000000000a2', 'g2@example.com');

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);

create temporary table games_book as
select create_syllabus(
  '{"course_id":"pharmacology","title":"Games Pharm","authors":[],"toc_source":"manual"}',
  jsonb_build_object('units', jsonb_build_array(jsonb_build_object('title', 'U1', 'modules', jsonb_build_array(
    jsonb_build_object('title', 'M1', 'chapter_number', '1', 'stones', jsonb_build_array(
      jsonb_build_object('title', 'Game stone', 'summary', '', 'key_topics', '[]'::jsonb,
        'tags', jsonb_build_array(jsonb_build_object('client_need_id', 'pharm', 'hesi_domain_id', 'pharmacology')))
    ))
  ))))
) as book_id;

do $$
declare
  s uuid; by_stone uuid; by_need uuid; ngn uuid; n int; c int; r uuid; ex uuid;
begin
  select id into s from stepping_stones where title = 'Game stone';

  -- A question needs a stone or a client need.
  insert into practice_items (user_id, stone_id, item_type, payload) values (auth.uid(), s, 'lesson_mcq', '{}') returning id into by_stone;
  insert into practice_items (user_id, client_need_id, item_type, payload) values (auth.uid(), 'pharm', 'drug_mcq', '{"drug":"Digoxin"}') returning id into by_need;
  begin
    insert into practice_items (user_id, item_type, payload) values (auth.uid(), 'round_mcq', '{}');
    raise exception 'question with no stone and no client need accepted';
  exception when check_violation then null;
  end;

  -- The new NGN types are allowed; an unknown type isn't.
  insert into practice_items (user_id, stone_id, item_type, payload) values (auth.uid(), s, 'ngn_matrix', '{}') returning id into ngn;
  insert into practice_items (user_id, stone_id, item_type, payload)
    select auth.uid(), s, t, '{}' from unnest(array['ngn_cloze', 'ngn_highlight', 'ngn_ordered', 'round_mcq']) t;
  begin
    insert into practice_items (user_id, stone_id, item_type, payload) values (auth.uid(), s, 'trivia', '{}');
    raise exception 'unknown item type accepted';
  exception when check_violation then null;
  end;

  -- Mistakes: by_stone was missed then answered right (out); by_need was missed (in); ngn missed twice (in).
  insert into practice_attempts (user_id, practice_item_id, is_correct, answered_at) values
    (auth.uid(), by_stone, false, now() - interval '2 hours'),
    (auth.uid(), by_stone, true, now() - interval '1 hour'),
    (auth.uid(), by_need, false, now() - interval '30 minutes'),
    (auth.uid(), ngn, false, now() - interval '3 hours'),
    (auth.uid(), ngn, false, now() - interval '20 minutes');
  select count(*) into n from my_mistakes();
  if n <> 2 then raise exception 'expected 2 mistakes, got %', n; end if;
  if exists (select 1 from my_mistakes() where practice_item_id = by_stone) then raise exception 'a question answered right is still a mistake'; end if;
  select misses into n from my_mistakes() where practice_item_id = ngn;
  if n <> 2 then raise exception 'expected 2 misses on the NGN item, got %', n; end if;
  if (select practice_item_id from my_mistakes(1)) <> ngn then raise exception 'mistakes should be newest first'; end if;

  -- Readiness: pharm counts the stone's attempts (by_stone x2, ngn x2) and the client-need question (by_need x1).
  select attempts, correct into n, c from readiness_by_client_need() where client_need_id = 'pharm';
  if n <> 5 or c <> 1 then raise exception 'pharm readiness wrong: % / %', c, n; end if;

  -- Game rounds count once each, right at 80% or better; unscored rounds don't count.
  insert into game_rounds (user_id, game, client_need_id, payload, total, correct, answered_at) values
    (auth.uid(), 'isolation', 'safety_infection', '{}', 5, 4, now()),
    (auth.uid(), 'ppe_order', 'safety_infection', '{}', 5, 3, now());
  insert into game_rounds (user_id, game, client_need_id, payload, total) values (auth.uid(), 'scope', 'coordinated_care', '{}', 6);
  select attempts, correct into n, c from readiness_by_client_need() where client_need_id = 'safety_infection';
  if n <> 2 or c <> 1 then raise exception 'safety readiness wrong: % / %', c, n; end if;
  select attempts into n from readiness_by_client_need() where client_need_id = 'coordinated_care';
  if n <> 0 then raise exception 'an unscored round counted: %', n; end if;

  begin
    insert into game_rounds (user_id, game, client_need_id, payload, total, correct) values (auth.uid(), 'scope', 'coordinated_care', '{}', 6, 3);
    raise exception 'a score without answered_at accepted';
  exception when check_violation then null;
  end;
  begin
    insert into game_rounds (user_id, game, client_need_id, payload, total, correct, answered_at) values (auth.uid(), 'scope', 'coordinated_care', '{}', 6, 7, now());
    raise exception 'more right than total accepted';
  exception when check_violation then null;
  end;
  begin
    insert into game_rounds (user_id, game, client_need_id, payload, total) values (auth.uid(), 'chess', 'coordinated_care', '{}', 6);
    raise exception 'unknown game accepted';
  exception when check_violation then null;
  end;

  -- Exams: one answer per question per exam.
  insert into exam_sessions (user_id, min_items, max_items, time_limit_minutes, current_item_id) values (auth.uid(), 15, 40, 60, by_stone) returning id into ex;
  insert into exam_answers (exam_id, user_id, practice_item_id, position, client_need_id, is_correct, score, difficulty, ability_after)
    values (ex, auth.uid(), by_stone, 1, 'pharm', true, 1, -0.3, 0.4);
  begin
    insert into exam_answers (exam_id, user_id, practice_item_id, position, is_correct, score, difficulty, ability_after)
      values (ex, auth.uid(), by_stone, 2, true, 1, -0.3, 0.5);
    raise exception 'same question twice in one exam accepted';
  exception when unique_violation then null;
  end;
  begin
    update exam_sessions set finished_at = now() where id = ex;
    raise exception 'finished without a stop reason accepted';
  exception when check_violation then null;
  end;
  begin
    insert into exam_sessions (user_id, min_items, max_items, time_limit_minutes) values (auth.uid(), 40, 15, 60);
    raise exception 'max below min accepted';
  exception when check_violation then null;
  end;

  -- Drug cards: one per medication per student.
  insert into drug_cards (user_id, name, name_key, card, model) values (auth.uid(), 'Digoxin (Lanoxin)', 'digoxin', '{}', 'test');
  begin
    insert into drug_cards (user_id, name, name_key, card, model) values (auth.uid(), 'Digoxin', 'digoxin', '{}', 'test');
    raise exception 'duplicate drug card accepted';
  exception when unique_violation then null;
  end;

  insert into mistake_notes (user_id, practice_item_id, note) values (auth.uid(), ngn, 'Read every row before picking.');

  -- Deleting a stone keeps the client-need question and clears the exam's current question.
  delete from stepping_stones where id = s;
  if not exists (select 1 from practice_items where id = by_need) then raise exception 'client-need question was deleted with the stone'; end if;
  if (select current_item_id from exam_sessions where id = ex) is not null then raise exception 'exam still points at a deleted question'; end if;
  if exists (select 1 from mistake_notes where practice_item_id = ngn) then raise exception 'note outlived its question'; end if;
  if (select count(*) from exam_answers where exam_id = ex) <> 1 then raise exception 'exam answer lost with its question'; end if;
end $$;

-- Another student sees none of it.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a2', false);
do $$
declare n int;
begin
  select (select count(*) from game_rounds) + (select count(*) from exam_sessions) + (select count(*) from exam_answers)
       + (select count(*) from drug_cards) + (select count(*) from mistake_notes) + (select count(*) from my_mistakes())
    into n;
  if n <> 0 then raise exception 'another student can see % stage 6 rows', n; end if;
  select sum(attempts) into n from readiness_by_client_need();
  if n <> 0 then raise exception 'another student''s readiness counts % attempts', n; end if;
  begin
    insert into game_rounds (user_id, game, client_need_id, payload, total) values ('00000000-0000-0000-0000-0000000000a1', 'scope', 'coordinated_care', '{}', 6);
    raise exception 'wrote a round for another student';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;

-- Anonymous callers can't run the mistakes function.
do $$
begin
  if has_function_privilege('anon', 'my_mistakes(int)', 'execute') then raise exception 'anon can run my_mistakes'; end if;
end $$;
