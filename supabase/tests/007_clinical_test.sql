-- Database tests for stage 6b: skills checklists, clinical day prep, care plans and share links.

\set ON_ERROR_STOP 1

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000b1', 'c1@example.com'),
  ('00000000-0000-0000-0000-0000000000b2', 'c2@example.com');

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', false);

do $$
declare p uuid; cp uuid; n int;
begin
  -- Skill runs: steps done can't pass the total, and the skill id is a plain slug.
  insert into skill_checks (user_id, skill_id, steps_total, steps_done, missed_steps, confidence)
    values (auth.uid(), 'hand_hygiene', 10, 9, '{4}', 'with_help');
  begin
    insert into skill_checks (user_id, skill_id, steps_total, steps_done, confidence) values (auth.uid(), 'hand_hygiene', 5, 6, 'on_my_own');
    raise exception 'more steps done than the skill has';
  exception when check_violation then null;
  end;
  begin
    insert into skill_checks (user_id, skill_id, steps_total, steps_done, confidence) values (auth.uid(), 'Hand Hygiene!', 5, 5, 'on_my_own');
    raise exception 'odd skill id accepted';
  exception when check_violation then null;
  end;
  begin
    insert into skill_checks (user_id, skill_id, steps_total, steps_done, confidence) values (auth.uid(), 'hand_hygiene', 5, 5, 'expert');
    raise exception 'unknown confidence accepted';
  exception when check_violation then null;
  end;

  -- One sign-off per skill.
  insert into skill_signoffs (user_id, skill_id, signed_off_on) values (auth.uid(), 'hand_hygiene', current_date);
  begin
    insert into skill_signoffs (user_id, skill_id, signed_off_on) values (auth.uid(), 'hand_hygiene', current_date);
    raise exception 'second sign-off for the same skill accepted';
  exception when unique_violation then null;
  end;

  -- A care plan can come from a prep, and outlives it.
  insert into clinical_preps (user_id, title, input, sheet, model) values (auth.uid(), 'Thursday', '{}', '{}', 'm') returning id into p;
  insert into care_plans (user_id, prep_id, situation, plan, model) values (auth.uid(), p, 'Older adult with heart failure', '{}', 'm') returning id into cp;
  delete from clinical_preps where id = p;
  if (select prep_id from care_plans where id = cp) is not null then raise exception 'care plan still points at a deleted prep'; end if;

  -- Share links: a live link reads back; a revoked or expired one doesn't; tokens are long and unique.
  insert into shared_decks (user_id, token, kind, title, snapshot, item_count, expires_at)
    values (auth.uid(), repeat('a', 43), 'lesson', 'Digoxin', '{"cards":[]}', 0, now() + interval '30 days');
  insert into shared_decks (user_id, token, kind, title, snapshot, item_count, expires_at, revoked_at)
    values (auth.uid(), repeat('b', 43), 'questions', 'Revoked', '{}', 0, now() + interval '30 days', now());
  insert into shared_decks (user_id, token, kind, title, snapshot, item_count, created_at, expires_at)
    values (auth.uid(), repeat('c', 43), 'questions', 'Expired', '{}', 0, now() - interval '40 days', now() - interval '10 days');
  begin
    insert into shared_decks (user_id, token, kind, title, snapshot, item_count, expires_at) values (auth.uid(), 'short', 'lesson', 'x', '{}', 0, now() + interval '1 day');
    raise exception 'short token accepted';
  exception when check_violation then null;
  end;
  begin
    insert into shared_decks (user_id, token, kind, title, snapshot, item_count, expires_at) values (auth.uid(), repeat('a', 43), 'lesson', 'x', '{}', 0, now() + interval '1 day');
    raise exception 'duplicate token accepted';
  exception when unique_violation then null;
  end;
end $$;

-- Another student sees none of it, and can't write as the first student.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b2', false);
do $$
declare n int;
begin
  select (select count(*) from skill_checks) + (select count(*) from skill_signoffs) + (select count(*) from clinical_preps)
       + (select count(*) from care_plans) + (select count(*) from shared_decks)
    into n;
  if n <> 0 then raise exception 'another student can see % stage 6b rows', n; end if;
  begin
    insert into skill_checks (user_id, skill_id, steps_total, steps_done, confidence) values ('00000000-0000-0000-0000-0000000000b1', 'hand_hygiene', 5, 5, 'on_my_own');
    raise exception 'wrote a skill check for another student';
  exception when insufficient_privilege then null;
  end;
  -- ...but a link they were given reads.
  if (select count(*) from shared_deck(repeat('a', 43))) <> 1 then raise exception 'live link did not read for another student'; end if;
end $$;

reset role;

-- Someone not signed in can read only a live link, by its token.
set role anon;
do $$
begin
  if (select count(*) from shared_deck(repeat('a', 43))) <> 1 then raise exception 'live link did not read'; end if;
  if (select count(*) from shared_deck(repeat('b', 43))) <> 0 then raise exception 'revoked link read'; end if;
  if (select count(*) from shared_deck(repeat('c', 43))) <> 0 then raise exception 'expired link read'; end if;
  if (select count(*) from shared_deck('')) <> 0 then raise exception 'empty token read'; end if;
  begin
    perform count(*) from shared_decks;
    raise exception 'anon read the share table directly';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
