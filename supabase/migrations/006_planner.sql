-- Stage 4: study planner, spaced review, streaks and weekly reports.
-- New tables and functions, plus a new version of complete_stone that schedules a stone's first review.

-- ---------------------------------------------------------------------------
-- The student's exam dates, reminder time and time zone
-- ---------------------------------------------------------------------------

-- True for a time zone name Postgres knows, such as 'America/New_York'.
create or replace function valid_time_zone(tz text) returns boolean
language sql stable security invoker set search_path = public as $$
  select exists (select 1 from pg_timezone_names where name = tz);
$$;

create table study_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  nclex_date date,
  hesi_date date,
  reminder_time time,
  timezone text not null default 'UTC' check (valid_time_zone(timezone)),
  -- Days before the exam kept free of new stones, for review only.
  review_buffer_days int not null default 14 check (review_buffer_days between 0 and 60),
  updated_at timestamptz not null default now()
);
create trigger study_profiles_updated_at before update on study_profiles for each row execute function set_updated_at();

-- The student's own calendar day, in the time zone saved in the planner (UTC until one is saved).
create or replace function local_day(p_at timestamptz default now()) returns date
language sql stable security invoker set search_path = public as $$
  select (p_at at time zone coalesce((select p.timezone from study_profiles p where p.user_id = auth.uid()), 'UTC'))::date;
$$;

-- ---------------------------------------------------------------------------
-- Weekly study times: each block belongs to one course path, or to whichever course is furthest behind
-- ---------------------------------------------------------------------------

create table study_blocks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  weekday int not null check (weekday between 1 and 7), -- ISO: 1 is Monday, 7 is Sunday
  start_time time not null,
  minutes int not null check (minutes between 10 and 480),
  course_id text references courses(id),
  created_at timestamptz not null default now()
);
create index study_blocks_user_idx on study_blocks (user_id, weekday, start_time);

-- ---------------------------------------------------------------------------
-- Spaced review: one schedule per mastered stone, and a log of every review
-- ---------------------------------------------------------------------------

create table stone_reviews (
  stone_id uuid primary key references stepping_stones(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  interval_days int not null default 1 check (interval_days between 1 and 365),
  ease numeric(4, 2) not null default 2.5 check (ease between 1.3 and 3.5),
  reps int not null default 1 check (reps >= 0),
  lapses int not null default 0 check (lapses >= 0),
  due_on date not null,
  last_reviewed_at timestamptz,
  -- When the stone was first mastered.
  created_at timestamptz not null default now()
);
create index stone_reviews_due_idx on stone_reviews (user_id, due_on);

create table review_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  stone_id uuid not null references stepping_stones(id) on delete cascade,
  grade text not null check (grade in ('again', 'hard', 'good', 'easy')),
  answered int not null check (answered >= 1),
  correct int not null check (correct between 0 and answered),
  interval_days int not null check (interval_days >= 1),
  reviewed_at timestamptz not null default now()
);
create index review_log_user_idx on review_log (user_id, reviewed_at desc);

-- ---------------------------------------------------------------------------
-- Study days, for streaks and the weekly report
-- ---------------------------------------------------------------------------

create table study_days (
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  minutes int not null default 0 check (minutes >= 0),
  stones_done int not null default 0 check (stones_done >= 0),
  questions_answered int not null default 0 check (questions_answered >= 0),
  reviews_done int not null default 0 check (reviews_done >= 0),
  primary key (user_id, day)
);

-- Adds to today's totals for the signed-in student. Does nothing when no one is signed in.
create or replace function bump_study_day(p_minutes int default 0, p_stones int default 0, p_questions int default 0, p_reviews int default 0)
returns void
language plpgsql security invoker set search_path = public as $$
begin
  if auth.uid() is null then
    return;
  end if;
  insert into study_days (user_id, day, minutes, stones_done, questions_answered, reviews_done)
  values (auth.uid(), local_day(), greatest(p_minutes, 0), greatest(p_stones, 0), greatest(p_questions, 0), greatest(p_reviews, 0))
  on conflict (user_id, day) do update set
    minutes = study_days.minutes + excluded.minutes,
    stones_done = study_days.stones_done + excluded.stones_done,
    questions_answered = study_days.questions_answered + excluded.questions_answered,
    reviews_done = study_days.reviews_done + excluded.reviews_done;
end;
$$;

-- Every answered question counts toward today.
create or replace function count_answered_question() returns trigger
language plpgsql security invoker set search_path = public as $$
begin
  if new.user_id = auth.uid() then
    perform bump_study_day(p_questions => 1);
  end if;
  return new;
end;
$$;

create trigger practice_attempts_count_day
  after insert on practice_attempts
  for each row execute function count_answered_question();

-- Only runs as a trigger, never as an API call.
revoke execute on function count_answered_question() from public, anon, authenticated;

create table weekly_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  week_start date not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  unique (user_id, week_start)
);

-- ---------------------------------------------------------------------------
-- Finishing a stone (replaces the version from 003): as before, plus a newly mastered stone
-- gets its first review tomorrow and counts toward today.
-- ---------------------------------------------------------------------------

create or replace function complete_stone(p_stone_id uuid, p_score numeric)
returns table (status stone_status, unlocked_stone_id uuid)
language plpgsql security invoker set search_path = public as $$
declare
  uid uuid := auth.uid();
  v_before stone_status;
  v_status stone_status;
  v_textbook uuid;
  v_unit_order int;
  v_module_order int;
  v_stone_order int;
  v_next uuid;
begin
  if uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  if p_score < 0 or p_score > 1 then
    raise exception 'score must be between 0 and 1' using errcode = '22023';
  end if;

  select u.textbook_id, u.sort_order, m.sort_order, s.sort_order, s.status
    into v_textbook, v_unit_order, v_module_order, v_stone_order, v_before
  from stepping_stones s
  join modules m on m.id = s.module_id
  join units u on u.id = m.unit_id
  where s.id = p_stone_id and s.user_id = uid;

  if v_textbook is null then
    raise exception 'stone not found' using errcode = 'P0002';
  end if;

  update stepping_stones s
  set status = case when p_score >= 0.8 then 'mastered'::stone_status else s.status end,
      mastery = greatest(s.mastery, p_score)
  where s.id = p_stone_id
  returning s.status into v_status;

  -- Newly mastered (or mastered again after slipping): first review tomorrow.
  if v_status = 'mastered' and v_before is distinct from 'mastered' then
    insert into stone_reviews (stone_id, user_id, interval_days, reps, due_on)
    values (p_stone_id, uid, 1, 1, local_day() + 1)
    on conflict (stone_id) do update set interval_days = 1, reps = 1, due_on = excluded.due_on;
    perform bump_study_day(p_stones => 1);
  end if;

  -- The next stone in path order (unit, module, stone) that is still locked.
  select s.id into v_next
  from stepping_stones s
  join modules m on m.id = s.module_id
  join units u on u.id = m.unit_id
  where u.textbook_id = v_textbook
    and s.user_id = uid
    and (u.sort_order, m.sort_order, s.sort_order) > (v_unit_order, v_module_order, v_stone_order)
  order by u.sort_order, m.sort_order, s.sort_order
  limit 1;

  if v_next is not null then
    update stepping_stones s set status = 'ready' where s.id = v_next and s.status = 'locked';
    if not found then
      v_next := null;
    end if;
  end if;

  return query select v_status, v_next;
end;
$$;

-- Stones mastered before this update get a review too, spread over the next week so they don't all land at once.
insert into stone_reviews (stone_id, user_id, interval_days, reps, due_on)
select s.id, s.user_id, 1, 1,
       (now() at time zone 'UTC')::date + 1 + ((row_number() over (partition by s.user_id order by s.updated_at) - 1) % 7)::int
from stepping_stones s
where s.status = 'mastered'
on conflict (stone_id) do nothing;

-- ---------------------------------------------------------------------------
-- Row-level security: each student sees only their own rows
-- ---------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array['study_profiles', 'study_blocks', 'stone_reviews', 'review_log', 'study_days', 'weekly_reports'] loop
    execute format('alter table %I enable row level security', t);
    execute format(
      'create policy "owner access" on %I for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))',
      t
    );
  end loop;
end;
$$;

revoke execute on function bump_study_day(int, int, int, int) from public, anon;
revoke execute on function local_day(timestamptz) from public, anon;
