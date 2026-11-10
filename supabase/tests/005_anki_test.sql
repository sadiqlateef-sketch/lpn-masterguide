-- Database tests for stage 5: Anki decks, fact-checks, suggested cards and the cost guard.

\set ON_ERROR_STOP 1

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000f1', 'f1@example.com'),
  ('00000000-0000-0000-0000-0000000000f2', 'f2@example.com');

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000f1', false);

-- A 1024-dimension unit vector along axis i.
create or replace function pg_temp.anki_axis(i int) returns vector
language sql immutable as $$
  select (array_agg(case when g = i then 1.0 else 0.0 end order by g))::float4[]::vector
  from generate_series(1, 1024) g;
$$;

create temporary table anki_book as
select create_syllabus(
  '{"course_id":"pharmacology","title":"Pharm Anki","authors":[],"toc_source":"manual"}',
  jsonb_build_object('units', jsonb_build_array(jsonb_build_object('title', 'U1', 'modules', jsonb_build_array(
    jsonb_build_object('title', 'M1', 'chapter_number', '1', 'stones', jsonb_build_array(
      jsonb_build_object('title', 'Anticoagulants', 'summary', '', 'key_topics', '[]'::jsonb, 'tags', '[]'::jsonb),
      jsonb_build_object('title', 'Diuretics', 'summary', '', 'key_topics', '[]'::jsonb, 'tags', '[]'::jsonb)
    ))
  ))))
) as book_id;

update stepping_stones set embedding = pg_temp.anki_axis(1) where title = 'Anticoagulants';
update stepping_stones set embedding = pg_temp.anki_axis(2) where title = 'Diuretics';

-- A deck with three cards: two near a stone, one far from both.
do $$
declare d uuid;
begin
  insert into decks (user_id, name, source_format, state, card_count, check_cap)
  values (auth.uid(), 'Pharm deck', 'apkg', 'ready', 3, 2) returning id into d;
  insert into deck_cards (user_id, deck_id, front, back, sort_order, embedding) values
    (auth.uid(), d, 'Antidote for heparin?', 'Protamine sulfate', 1, pg_temp.anki_axis(1)),
    (auth.uid(), d, 'Furosemide lowers which electrolyte?', 'Potassium', 2, pg_temp.anki_axis(2)),
    (auth.uid(), d, 'Capital of France?', 'Paris', 3, pg_temp.anki_axis(500));
end $$;

-- Linking files each card under its closest stone, and leaves the far one alone.
do $$
declare n int;
begin
  n := link_deck_cards((select id from decks where name = 'Pharm deck'));
  if n <> 2 then raise exception 'linked % cards, expected 2', n; end if;
  if (select s.title from deck_cards c join stepping_stones s on s.id = c.stone_id where c.sort_order = 1) <> 'Anticoagulants' then
    raise exception 'heparin card filed under the wrong stone';
  end if;
  if (select stone_id from deck_cards where sort_order = 3) is not null then raise exception 'unrelated card was filed'; end if;
end $$;

-- The cost guard never hands out more checks than the cap.
do $$
declare d uuid := (select id from decks where name = 'Pharm deck'); g int;
begin
  g := reserve_deck_checks(d, 5);
  if g <> 2 then raise exception 'granted % checks, cap is 2', g; end if;
  g := reserve_deck_checks(d, 1);
  if g <> 0 then raise exception 'granted % checks past the cap', g; end if;
  perform release_deck_checks(d, 1);
  if (select checks_used from decks where id = d) <> 1 then raise exception 'release did not give a check back'; end if;
  update decks set check_cap = 5 where id = d;
  g := reserve_deck_checks(d, 10);
  if g <> 4 then raise exception 'after raising the cap, granted %', g; end if;
  begin
    update decks set check_cap = 5000 where id = d;
    raise exception 'cap of 5000 accepted';
  exception when check_violation then null;
  end;
end $$;

-- Accepting a correction changes the card and keeps the original; dismissing changes nothing.
do $$
declare
  d uuid := (select id from decks where name = 'Pharm deck');
  c1 uuid := (select id from deck_cards where sort_order = 1);
  c2 uuid := (select id from deck_cards where sort_order = 2);
  c3 uuid := (select id from deck_cards where sort_order = 3);
  k1 uuid; k2 uuid; k3 uuid;
begin
  insert into card_checks (user_id, deck_id, card_id, verdict, explanation, suggestion, model, decision)
  values (auth.uid(), d, c1, 'disagrees', 'The book names protamine sulfate and its dosing.', '{"front":"Antidote for heparin?","back":"Protamine sulfate (1 mg per 100 units)"}', 'm', 'pending')
  returning id into k1;
  insert into card_checks (user_id, deck_id, card_id, verdict, explanation, suggestion, model, decision)
  values (auth.uid(), d, c2, 'disagrees', 'Wrong', '{"front":"X","back":"Y"}', 'm', 'pending')
  returning id into k2;
  insert into card_checks (user_id, deck_id, card_id, verdict, explanation, suggestion, model, decision)
  values (auth.uid(), d, c3, 'out_of_scope', 'Not nursing content.', '{"action":"suspend"}', 'm', 'pending')
  returning id into k3;

  perform decide_card_check(k1, 'accepted');
  if (select back from deck_cards where id = c1) <> 'Protamine sulfate (1 mg per 100 units)' then raise exception 'accepted correction not applied'; end if;
  if (select original_back from deck_cards where id = c1) <> 'Protamine sulfate' then raise exception 'original not kept'; end if;

  perform decide_card_check(k2, 'dismissed');
  if (select back from deck_cards where id = c2) <> 'Potassium' or (select original_back from deck_cards where id = c2) is not null then
    raise exception 'a dismissed check changed the card';
  end if;

  perform decide_card_check(k3, 'accepted');
  if (select state from deck_cards where id = c3) <> 'suspended' then raise exception 'out-of-scope card not suspended'; end if;

  begin
    perform decide_card_check(k1, 'dismissed');
    raise exception 'decided the same check twice';
  exception when object_not_in_prerequisite_state then null;
  end;
  begin
    insert into card_checks (user_id, deck_id, card_id, verdict, explanation, model, decision)
    values (auth.uid(), d, c1, 'agrees', 'again', 'm', 'none');
    raise exception 'two checks for one card accepted';
  exception when unique_violation then null;
  end;
  begin
    update card_checks set verdict = 'maybe' where id = k1;
    raise exception 'unknown verdict accepted';
  exception when check_violation then null;
  end;
end $$;

-- Accepting a suggested card adds it to the deck; dismissing adds nothing.
do $$
declare
  d uuid := (select id from decks where name = 'Pharm deck');
  st uuid := (select id from stepping_stones where title = 'Diuretics');
  s1 uuid; s2 uuid; new_card uuid; before int;
begin
  before := (select card_count from decks where id = d);
  insert into card_suggestions (user_id, deck_id, stone_id, front, back, model)
  values (auth.uid(), d, st, 'Spironolactone spares which electrolyte?', 'Potassium', 'm') returning id into s1;
  insert into card_suggestions (user_id, deck_id, stone_id, front, back, model)
  values (auth.uid(), d, st, 'Q', 'A', 'm') returning id into s2;

  new_card := decide_card_suggestion(s1, 'accepted');
  if new_card is null or (select origin from deck_cards where id = new_card) <> 'suggested' then raise exception 'accepted suggestion not added'; end if;
  if (select stone_id from deck_cards where id = new_card) <> st then raise exception 'suggested card not filed under its stone'; end if;
  if (select card_count from decks where id = d) <> before + 1 then raise exception 'card count not updated'; end if;

  if decide_card_suggestion(s2, 'dismissed') is not null then raise exception 'dismissed suggestion added a card'; end if;
  if (select count(*) from deck_cards where deck_id = d) <> 4 then raise exception 'wrong number of cards'; end if;
end $$;

-- Another student sees none of it and can't decide on it.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000f2', false);
do $$
declare n int;
begin
  select (select count(*) from decks) + (select count(*) from deck_cards) + (select count(*) from card_checks) + (select count(*) from card_suggestions)
    into n;
  if n <> 0 then raise exception 'another student can see % deck rows', n; end if;
  begin
    perform reserve_deck_checks((select id from decks limit 1), 1);
  exception when no_data_found then null;
  end;
  begin
    insert into decks (user_id, name, source_format) values ('00000000-0000-0000-0000-0000000000f1', 'x', 'text');
    raise exception 'made a deck for someone else';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;

-- Deleting a stone leaves its cards in the deck, unfiled.
do $$
begin
  delete from stepping_stones where title = 'Anticoagulants';
  if (select stone_id from deck_cards where front = 'Antidote for heparin?') is not null then raise exception 'card kept a deleted stone'; end if;
end $$;
