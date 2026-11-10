-- Phase 3: lesson practice items, stone progress, readiness, and NotebookLM folder sync.

-- Lesson-generated questions are practice items too.
alter table practice_items drop constraint if exists practice_items_item_type_check;
alter table practice_items add constraint practice_items_item_type_check
  check (item_type in ('twin_mcq', 'sata', 'ngn_mini_bowtie', 'lesson_mcq'));

alter table practice_attempts add column selected_option_ids text[] not null default '{}';
create index practice_attempts_item_idx on practice_attempts (practice_item_id);
create index practice_items_stone_idx on practice_items (stone_id);

-- ---------------------------------------------------------------------------
-- NotebookLM folder sync: a synced file is identified by its path in the student's folder.
-- Re-sending the same path with new content replaces the old copy.
-- ---------------------------------------------------------------------------

alter table note_sources
  add column external_key text,
  add column content_hash text;

create unique index note_sources_user_external_key on note_sources (user_id, external_key) where external_key is not null;

-- ---------------------------------------------------------------------------
-- Finishing a stone: mastered at 80% or better, then the next stone on the path opens up.
-- Returns the stone's new status and the id of the stone that was unlocked, if any.
-- ---------------------------------------------------------------------------

create or replace function complete_stone(p_stone_id uuid, p_score numeric)
returns table (status stone_status, unlocked_stone_id uuid)
language plpgsql security invoker set search_path = public as $$
declare
  uid uuid := auth.uid();
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

  select u.textbook_id, u.sort_order, m.sort_order, s.sort_order
    into v_textbook, v_unit_order, v_module_order, v_stone_order
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

-- ---------------------------------------------------------------------------
-- Readiness inputs: attempts per client need, including client needs with no attempts yet.
-- ---------------------------------------------------------------------------

create or replace function readiness_by_client_need()
returns table (client_need_id text, name text, min_pct numeric, max_pct numeric, attempts int, correct int)
language sql stable security invoker set search_path = public as $$
  with tagged as (
    select distinct pa.id as attempt_id, pa.is_correct, t.client_need_id
    from practice_attempts pa
    join practice_items pi on pi.id = pa.practice_item_id
    join stone_blueprint_tags t on t.stone_id = pi.stone_id
    where pa.user_id = auth.uid()
  )
  select cn.id, cn.name, cn.min_pct, cn.max_pct,
         count(tagged.attempt_id)::int,
         count(tagged.attempt_id) filter (where tagged.is_correct)::int
  from nclex_client_needs cn
  join nclex_test_plans tp on tp.id = cn.test_plan_id and tp.is_current
  left join tagged on tagged.client_need_id = cn.id
  group by cn.id, cn.name, cn.min_pct, cn.max_pct, cn.sort_order
  order by cn.sort_order;
$$;
