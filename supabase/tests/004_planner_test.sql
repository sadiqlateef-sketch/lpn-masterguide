-- Database tests for stage 4: the planner profile, study blocks, spaced review scheduling and study days.

\set ON_ERROR_STOP 1

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000e1', 'e1@example.com'),
  ('00000000-0000-0000-0000-0000000000e2', 'e2@example.com');

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000e1', false);

create temporary table planner_book as
select create_syllabus(
  '{"course_id":"pharmacology","title":"Pharm Planner","authors":[],"toc_source":"manual"}',
  jsonb_build_object('units', jsonb_build_array(jsonb_build_object('title', 'U1', 'modules', jsonb_build_array(
    jsonb_build_object('title', 'M1', 'chapter_number', '1', 'stones', jsonb_build_array(
      jsonb_build_object('title', 'P1', 'summary', '', 'key_topics', '[]'::jsonb, 'tags', '[]'::jsonb),
      jsonb_build_object('title', 'P2', 'summary', '', 'key_topics', '[]'::jsonb, 'tags', '[]'::jsonb)
    ))
  ))))
) as book_id;

-- The profile only takes real time zones and sensible buffers.
do $$
begin
  insert into study_profiles (user_id, nclex_date, timezone) values (auth.uid(), '2027-03-01', 'America/New_York');
  begin
    update study_profiles set timezone = 'Mars/Olympus' where user_id = auth.uid();
    raise exception 'made-up time zone accepted';
  exception when check_violation then null;
  end;
  begin
    update study_profiles set review_buffer_days = 90 where user_id = auth.uid();
    raise exception 'buffer of 90 days accepted';
  exception when check_violation then null;
  end;
end $$;

-- The local day follows the saved time zone: 03:30 UTC is still the evening before in New York.
do $$
begin
  if local_day('2026-11-11 03:30+00') <> '2026-11-10' then raise exception 'New York day: %', local_day('2026-11-11 03:30+00'); end if;
  update study_profiles set timezone = 'Asia/Tokyo' where user_id = auth.uid();
  if local_day('2026-11-10 16:00+00') <> '2026-11-11' then raise exception 'Tokyo day: %', local_day('2026-11-10 16:00+00'); end if;
  update study_profiles set timezone = 'UTC' where user_id = auth.uid();
end $$;

-- Study blocks: a real weekday and a sensible length.
do $$
begin
  insert into study_blocks (user_id, weekday, start_time, minutes, course_id) values (auth.uid(), 1, '19:00', 45, 'pharmacology');
  insert into study_blocks (user_id, weekday, start_time, minutes) values (auth.uid(), 3, '06:30', 30);
  begin
    insert into study_blocks (user_id, weekday, start_time, minutes) values (auth.uid(), 8, '06:30', 30);
    raise exception 'weekday 8 accepted';
  exception when check_violation then null;
  end;
  begin
    insert into study_blocks (user_id, weekday, start_time, minutes) values (auth.uid(), 2, '06:30', 5);
    raise exception 'five-minute block accepted';
  exception when check_violation then null;
  end;
end $$;

-- Mastering a stone schedules its first review for tomorrow and counts toward today, once.
do $$
declare p1 uuid := (select id from stepping_stones where title = 'P1'); r record; d record;
begin
  perform complete_stone(p1, 0.5);
  if exists (select 1 from stone_reviews where stone_id = p1) then raise exception 'a low score should not schedule a review'; end if;

  perform complete_stone(p1, 0.9);
  select * into r from stone_reviews where stone_id = p1;
  if r.due_on <> local_day() + 1 or r.interval_days <> 1 or r.reps <> 1 then
    raise exception 'first review: due % interval % reps %', r.due_on, r.interval_days, r.reps;
  end if;

  -- Finishing an already mastered stone again changes nothing.
  update stone_reviews set due_on = local_day() + 9, interval_days = 9 where stone_id = p1;
  perform complete_stone(p1, 1);
  if (select interval_days from stone_reviews where stone_id = p1) <> 9 then raise exception 're-finishing reset the schedule'; end if;

  select * into d from study_days where day = local_day();
  if d.stones_done <> 1 then raise exception 'stones done today: %', d.stones_done; end if;

  -- A stone that slipped (a missed question) and is mastered again starts over at one day.
  update stepping_stones set status = 'needs_review' where id = p1;
  perform complete_stone(p1, 0.85);
  if (select interval_days from stone_reviews where stone_id = p1) <> 1 then raise exception 'relearned stone should restart at 1 day'; end if;
  if (select stones_done from study_days where day = local_day()) <> 2 then raise exception 'relearning should count as a stone done'; end if;
end $$;

-- Answering a question counts toward today, through the trigger.
do $$
declare p2 uuid := (select id from stepping_stones where title = 'P2'); item uuid; before int;
begin
  before := coalesce((select questions_answered from study_days where day = local_day()), 0);
  insert into practice_items (user_id, stone_id, item_type, payload)
  values (auth.uid(), p2, 'lesson_mcq', '{}'::jsonb) returning id into item;
  insert into practice_attempts (user_id, practice_item_id, is_correct) values (auth.uid(), item, true);
  insert into practice_attempts (user_id, practice_item_id, is_correct) values (auth.uid(), item, false);
  if (select questions_answered from study_days where day = local_day()) <> before + 2 then raise exception 'answered questions not counted'; end if;

  perform bump_study_day(p_minutes => 25, p_reviews => 1);
  perform bump_study_day(p_minutes => -10);
  if (select minutes from study_days where day = local_day()) <> 25 then raise exception 'minutes should add and ignore negatives'; end if;
end $$;

-- The review log keeps answers honest.
do $$
declare p1 uuid := (select id from stepping_stones where title = 'P1');
begin
  insert into review_log (user_id, stone_id, grade, answered, correct, interval_days) values (auth.uid(), p1, 'good', 5, 4, 6);
  begin
    insert into review_log (user_id, stone_id, grade, answered, correct, interval_days) values (auth.uid(), p1, 'good', 3, 4, 6);
    raise exception 'more right than answered accepted';
  exception when check_violation then null;
  end;
  begin
    insert into review_log (user_id, stone_id, grade, answered, correct, interval_days) values (auth.uid(), p1, 'perfect', 3, 3, 6);
    raise exception 'unknown grade accepted';
  exception when check_violation then null;
  end;
end $$;

-- Weekly reports: one per week.
do $$
begin
  insert into weekly_reports (user_id, week_start, payload) values (auth.uid(), '2026-11-02', '{}');
  begin
    insert into weekly_reports (user_id, week_start, payload) values (auth.uid(), '2026-11-02', '{}');
    raise exception 'two reports for one week accepted';
  exception when unique_violation then null;
  end;
end $$;

-- Another student sees none of it, and can't write into it.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000e2', false);
do $$
declare n int;
begin
  select (select count(*) from study_profiles) + (select count(*) from study_blocks) + (select count(*) from stone_reviews)
       + (select count(*) from review_log) + (select count(*) from study_days) + (select count(*) from weekly_reports)
    into n;
  if n <> 0 then raise exception 'another student can see % planner rows', n; end if;
  begin
    insert into study_days (user_id, day) values ('00000000-0000-0000-0000-0000000000e1', '2026-01-01');
    raise exception 'wrote a study day for someone else';
  exception when insufficient_privilege then null;
  end;
  -- With no profile of their own, their day is the UTC day.
  if local_day('2026-11-11 03:30+00') <> '2026-11-11' then raise exception 'default day should be UTC'; end if;
end $$;

reset role;

-- With no one signed in, bumping a day does nothing.
select set_config('request.jwt.claim.sub', '', false);
do $$
declare n int := (select count(*) from study_days);
begin
  perform bump_study_day(p_questions => 1);
  if (select count(*) from study_days) <> n then raise exception 'bumped a day with no one signed in'; end if;
end $$;

-- Stones mastered before the update got a review, spread over the next week.
do $$
begin
  if exists (select 1 from stepping_stones s where s.status = 'mastered' and not exists (select 1 from stone_reviews r where r.stone_id = s.id)) then
    raise exception 'a mastered stone has no review';
  end if;
end $$;
