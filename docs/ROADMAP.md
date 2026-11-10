# LPN MasterGuide: next update roadmap

The full plan for the next update, agreed with the owner on 2026-11-10. It covers the 40 improvements he accepted ("add all of them") plus his own additions. Every stage builds from this file.

## How the work runs

- Six stages, one branch and one pull request each. Every stage gets tests and the owner's approval before it merges to `main`.
- Merging to `main` redeploys the web app on Vercel. The Android app is rebuilt at the big milestones (after stages 2, 4 and 6).
- Database changes go in new numbered migrations only (`005_...` onward). A migration is written and tested on a scratch database (`npm run test:db`), and the owner is asked before it's applied to the live Supabase project.
- AI models: lessons, course plans, games and questions use `ANTHROPIC_MODEL` (`claude-sonnet-5-5`). The Anki fact-check also uses Sonnet, and sends only the cards it can't settle to a stronger model read from a new `ANTHROPIC_REVIEW_MODEL` environment variable (the owner picks the value in Vercel). All calls stay server-side.
- The rules in `CLAUDE.md` hold for everything here: LPN scope of practice, newly written questions only (never copied from UWorld, HESI, textbooks or Anki decks the student didn't write), three-button dock, at most 3 bullets per story card, 44px touch targets, `prefers-reduced-motion`.

## The rule that runs through every stage

**Every learning section ends with NCLEX-style questions.** A lesson already ends with Quick Play. From stage 3 on, the same holds for a chapter (a chapter checkpoint after its last stone), a course plan week, a game round and an Anki review session. The questions are newly written, tagged to the NCLEX-PN client needs and the NCSBN Clinical Judgment steps, and graded on the server like Quick Play.

## The 40 accepted items, by stage

| # | Item | Stage |
| --- | --- | --- |
| F1 | Spaced repetition | 4 |
| F2 | Daily plan ("Today") | 4 |
| F3 | Exam countdown (NCLEX and HESI dates) | 4 |
| F4 | Timed practice exams that stop adaptively | 6 |
| F5 | More NGN types (matrix, drag-and-drop, highlight, cloze) | 6 |
| F6 | Rationales for every option | 6 |
| F7 | Med-math drills | 6 |
| F8 | Lab values trainer | 6 |
| F9 | Drug cards | 6 |
| F10 | Mistake notebook | 6 |
| F11 | Ask about this card | 3 |
| F12 | Offline lessons | 6 |
| F13 | Study streaks and reminders | 4 |
| F14 | Audio playlist mode | 6 |
| F15 | Clinical day prep | 6 |
| F16 | Care plan builder (LPN scope) | 6 |
| F17 | Skills checklists | 6 |
| F18 | Weekly progress report | 4 |
| F19 | Search | 3 |
| F20 | Share a deck | 6 |
| U1 to U20 | The 20 UI and design items | 2 (done in this pull request) |

## Stage 2: UI and design polish (this pull request)

All 20 items, no database change. What each one became is listed in the pull request. Summary:

1. **Dock overlap:** the page's bottom space is sized from the dock plus the phone's gesture bar (`env(safe-area-inset-bottom)` or Capacitor's `--safe-area-inset-bottom`), and a fade sits under the dock.
2. **Stray dock shape:** the fade hides the stone that peeked out under the dock.
3. **Jump to chapter:** a "Continue" pill scrolls to the next stone, and a chapter list jumps to any chapter.
4. **Course switcher:** swipeable course tabs when there's more than one course.
5. **Ready count:** the path API returns `counts.ready` and the legend shows it.
6. **Locked stones:** dimmed, with a "coming up" count per chapter so the length of the path shows.
7. **Path connectors:** a dashed line links the stones of a chapter.
8. **Lesson card space:** cards size to their content, and short cards get a large faint picture of their card type.
9. **Swipe hint:** brighter, and shown only for the first three lessons.
10. **Card type colors:** each of the five card types has its own accent, border and title tint.
11. **Readiness caption:** the HESI band's meaning sits right under the HESI number.
12. **Ring explanations:** tapping a ring shows how the estimate is worked out.
13. **Trend chart:** weekly share of questions right over the last 8 weeks, from `practice_attempts` (no new table).
14. **Fold8 layout:** at 700px wide and up, the path stays on the left and the lesson opens on the right.
15. **Light mode:** follows the phone's setting.
16. **Text size:** the Android app follows the phone's font size, and layouts were checked at 130%.
17. **Mastery celebration:** a full-screen moment with the stone turning green.
18. **Quick Play feedback:** a green or red flash with a haptic buzz on every answer.
19. **Empty states:** first-run screens on Path and Readiness that point to Magic +.
20. **Loading skeletons:** a shimmering lesson card while a new lesson is written.

## Stage 3: Sources, textbooks and the course plan (built on `claude/sources-and-plans`)

### What the owner gets

- **Several NotebookLM notebooks.** Each export is filed under a named notebook (for example "Fundamentals notebook", "Pharm notebook"). Magic + asks which notebook when it isn't obvious, and the folder sync script maps each subfolder to a notebook. Lesson Card 4 cites the notebook and source by name.
- **A whole textbook.** Magic + takes the school book's PDF. The phone splits a big PDF into parts (about 20 MB each, 45 MB at most, up to 40 parts) and uploads them straight to the student's private Storage folder, because Vercel caps a request at about 4.5 MB. The server reads one part at a time: pages are extracted with `unpdf`, chunked by heading, embedded with Voyage, and linked to the matching stones of that book. Lessons then draw on the real chapter text instead of the table of contents alone. Sending a book PDF from the sync script is left for later.
- **A course plan that deepens with every source.** From the books, notebooks and decks a student has added, Claude drafts a course plan: weeks, each with its stones, the textbook pages and notes behind them, and an NCLEX checkpoint at the end. Adding a source re-drafts the plan, and the plan shows which sources fed each week and what's thin. A plan is never more detailed than its sources: a week with no source says so instead of guessing.
- **Ask about this card (F11).** A chat button on any lesson card answers follow-up questions from that stone's sources, in LPN scope, with the source named.
- **Search (F19).** One search box (inside the Magic + sheet, keeping the dock at three buttons) finds stones, notes, textbook passages and questions, by meaning and by words.

### Data model (migration `005_sources_and_plans.sql`)

- `notebooks` (id, user_id, name, color, created_at). `note_sources.notebook_id` (nullable; existing sources go in a "My notes" notebook created by the migration).
- `textbooks.pdf_parts`. `textbook_files` (id, user_id, textbook_id, part_number, storage_path, bytes, content_hash, page_offset, pages, chunks, state, error). `textbook_chunks` (id, user_id, textbook_id, file_id, chunk_index, page_from, page_to, heading, content, embedding vector(1024), stone_id). HNSW index on the embedding. Functions `link_textbook_chunks`, `stone_textbook_chunks`, `match_textbook_chunks`. A Storage update policy on the student's own folder, so a re-split book overwrites its parts.
- `course_plans` (id, user_id, course_id, version, source_fingerprint, model, summary, created_at) and `course_plan_weeks` (plan_id, week_number, title, goals text[], stone_ids uuid[], source_refs jsonb, coverage). A week's checkpoint questions are picked when the plan is read, from its stones' practice items, so they never go stale. Function `course_plan_sources` counts what stands behind each stone.
- `search_study(q, query_embedding)` searches stones, notes, textbook passages and saved questions by meaning and by words.
- `card_questions` (id, user_id, stone_id, card_id, question, answer, source_refs jsonb, created_at) for Ask about this card.
- Row-level security on every new table, same pattern as `note_sources`.

### Routes

- `POST /api/notebooks`, `GET /api/notebooks`, `PATCH /api/notebooks/{id}`, `DELETE /api/notebooks/{id}`.
- `GET /api/textbooks` (books with their PDF progress), `POST /api/textbooks/{id}/parts` (records a part already uploaded to Storage, with its sha256) and `POST /api/textbooks/{id}/process` (extract, chunk, embed, link; one part per call, resumable). Notes keep using `POST /api/magic-ingest`, now with `notebookId` or `notebook`.
- `POST /api/course-plans/generate` and `GET /api/course-plans/{courseId}`.
- `POST /api/lessons/ask` (stone id, card id, question).
- `GET /api/search?q=`.
- Lesson generation reads textbook chunks; `LESSON_VERSION` is bumped and `invalidateLessons` runs when a book's text arrives.

### Screens

- Magic +: notebook picker, "Add a whole book (PDF)" with part progress.
- Path: a "Plan" view toggle at the top of each course (weeks with checkpoints), staying inside the Path tab.
- Lesson cards: an "Ask" button and answer sheet.
- Search inside Magic +.

### Tests

Migration tests for the new tables, functions and RLS; unit tests for PDF chunking by heading, splitting into parts, page numbers across parts, plan weeks, sources, coverage and fingerprints, Ask citations and search; a sign-in test for each new route. Still to write: an integration test that uploads a two-part PDF and checks the plan cites both parts (the integration suite needs PostgREST, which the build environment couldn't download).

## Stage 4: Study planner, spaced review and habits (built on `claude/study-planner`)

### What the owner gets

- **Exam countdown (F3).** NCLEX-PN and HESI dates in the planner sheet. The pace counts study days left to the nearest exam, minus a review-only buffer (14 days by default, 0 to 60), and says whether the path is on track, tight or behind.
- **Study-time map per path.** Study times for each weekday, each one set to a course or to "any course", which goes to the course furthest behind. The sheet shows each course's minutes a week and previews the pace as times are added.
- **Daily plan (F2).** A Today card at the top of the Path: reviews due (at most 40% of today's time), stones to learn, a question goal, today's study times, and what's done so far.
- **Spaced repetition (F1).** Mastering a stone schedules a review for the next day. A review replays the stone's Quick Play questions; the share right sets the next interval (SM-2 style: all right is easy, 80% good, 60% hard, less is "again"). "Again" sends the stone back to the path to learn again. Reviews are pulled in to the day before an exam. Due stones show an amber clock on the Path and a "Due" count in the map key.
- **Streaks and reminders (F13).** A daily streak on the Today card. Any study counts: a question answered, a stone mastered, a review, or minutes in a lesson. A daily reminder time is saved; on the website "Add to calendar" downloads a repeating calendar event with an alert.
- **Weekly progress report (F18).** On Readiness: minutes against plan, days studied, questions and share right (with the change from the week before), reviews, stones mastered and slipped, and what to focus on next. Last week's report is kept as it was.

### Changes from the plan

- `study_profiles.weekly_minutes` was dropped. Each study block carries its course instead, which says the same thing with less to keep in step.
- A `review_log` table records each review's grade and score, for the weekly report and for checking the schedule later.
- Phone notifications aren't in yet. They need the `@capacitor/local-notifications` plugin, a new package, which waits for the owner's yes. Web push needs keys and settings on the hosting side, so the website uses a calendar reminder instead.

### Data model (migration `006_planner.sql`)

- `study_profiles` (user_id primary key, nclex_date, hesi_date, reminder_time, timezone checked against real time zones, review_buffer_days).
- `study_blocks` (id, user_id, weekday 1 to 7, start_time, minutes 10 to 480, course_id or null).
- `stone_reviews` (stone_id primary key, user_id, interval_days, ease, reps, lapses, due_on, last_reviewed_at).
- `review_log` (user_id, stone_id, grade, answered, correct, interval_days, reviewed_at).
- `study_days` (user_id, day, minutes, stones_done, questions_answered, reviews_done), filled by `bump_study_day`, a trigger on `practice_attempts`, and `complete_stone`.
- `weekly_reports` (user_id, week_start unique, payload).
- `local_day()` gives the student's day in their saved time zone. `complete_stone` is replaced (same behaviour) to schedule the first review. Stones mastered before the update get a review spread over the next week.

### Routes

- `GET/PUT /api/planner/profile`, `GET/PUT /api/planner/blocks`, `GET /api/planner/today?tz=`, `POST /api/planner/activity`, `POST /api/reviews/{stoneId}`, `GET /api/reports/weekly`.

### Screens

Today card above the Path, review sheet, planner sheet (opened from the Today card), due clocks on the Path, weekly report card on Readiness. Minutes in a lesson (up to 90) count toward today.

### Tests

Pure math in `src/lib/study-math.ts` (SM-2, pacing, today's plan, streaks across time zones, weekly report, calendar reminder), labels in `src/lib/ui/planner-format.ts`, planner service tests, route sign-in tests, and `supabase/tests/004_planner_test.sql` for the tables, `local_day`, the trigger and the new `complete_stone`.

## Stage 5: Anki decks (built on `claude/anki-import`)

### What the owner gets

- **Import.** Magic + has a new "Add an Anki Deck" choice. It takes an Anki `.apkg` or `.colpkg` (any Anki version's collection format, including the newer compressed one) or a plain-text export. The phone uploads the file straight to the student's private Storage folder, the server reads it, and each card is filed under its closest stone.
- **Fact-check.** "Check cards" checks each card against the student's own textbook passages and notes, eight cards per Sonnet call, with a running count. A card gets one of: matches your sources, doesn't match, out of date, not LPN content, or not in your sources yet. Every verdict shows the source words it rests on, with the book and pages or the notebook. Cards Sonnet isn't sure about get a second look from the review model. **Nothing on a card changes until the student taps Accept.**
- **New cards.** "Suggest cards for thin stones" writes up to three cards for each stone the deck covers with fewer than three cards, from that stone's passages and notes, each with its source words. Suggestions wait for Add to deck or Skip.
- **Review.** A stone's cleared cards (checked and matching, accepted fixes, added suggestions) come first in its spaced review, as flip cards, before the stone's NCLEX-style questions.
- **Export.** On the web, "Export for Anki" downloads the deck as an `.apkg`, named "(checked)", with accepted fixes and added cards and without suspended ones.

### Changes from the plan

- **Media isn't kept.** Pictures and sounds on cards show as "[image]" and are dropped from the export; the plan said media references would be kept. Text is what the check needs, and decks with media are often too big to upload.
- **The review model is an environment variable with no default.** Until `ANTHROPIC_REVIEW_MODEL` is set in Vercel, the second look uses the everyday model again with more effort.
- **A quote must be real.** A verdict counts only when its quote appears word for word in the source it names. A card whose verdict has no real quote gets the second look, and if that still has none it's marked "not in your sources yet" instead of being flagged.
- **Cards nothing is near are not sent to the model.** A card with no passage or note close to it is marked "not in your sources yet" without a call, and doesn't count toward the cap.
- **Export is web only.** The Android app can't save a downloaded file without a new plugin, so the button shows only on the web.
- **Suggested cards are checked only for real quotes, not fact-checked again.** They're built from the same sources a check would use.
- **Decks can be removed.** Removing a deck deletes its cards, checks and suggestions in the app, not the student's Anki copy.

### Data model (migration `007_anki.sql`)

- `decks` (name, file name, format, storage path, state importing/ready/failed, card and skipped counts, `check_cap` default 200, `checks_used`).
- `deck_cards` (deck, stone (cleared if the stone is deleted), front, back, the original front and back once a fix is accepted, tags, Anki note id and guid, origin import/suggested, state active/suspended, a 1024-dimension vector, `checked_at`).
- `card_checks` (one per card: verdict, explanation, suggestion `{front, back}` or `{action: "suspend"}`, source quotes, model, whether it was escalated, decision none/pending/accepted/dismissed).
- `card_suggestions` (deck, stone, front, back, source quotes, decision, the card it became).
- Functions: `link_deck_cards`, `reserve_deck_checks` and `release_deck_checks` (the cap, taken atomically), `decide_card_check` (accepting applies the fix and keeps the original, or suspends; dismissing changes nothing) and `decide_card_suggestion`.
- Row-level security on all four tables, owner only.

### Routes

`GET /api/decks`, `POST /api/decks/import`, `GET|PUT|DELETE /api/decks/{id}` (PUT raises the cap), `POST /api/decks/{id}/check` (resumable: call again until nothing remains or the cap is reached), `GET /api/decks/{id}/checks`, `POST /api/card-checks/{id}/decision`, `GET|POST /api/decks/{id}/suggest`, `POST /api/card-suggestions/{id}/decision`, `GET /api/decks/{id}/export`, `GET /api/stones/{id}/cards`.

### Cost guard

Each deck may check up to 200 cards at first. The student can allow 200 more at a time, up to 2000. Checks are reserved before the call and given back if a batch fails. The system prompt is cached, and only unsure cards get the second look.

### Tests

`tests/anki-apkg.test.ts` (field text, cloze, a compressed modern collection inside a zip, a non-deck file, text exports, and the export round trip with stable ids), `tests/anki-check.test.ts` (quote matching, the verdict and escalation rules, suggestion cleanup) and `supabase/tests/005_anki_test.sql` (filing cards, the cap, accept and dismiss, suggestions, and that another student sees nothing).

## Stage 6: Games, practice and the remaining features

### Games (each round ends with NCLEX-style questions)

- **Med match:** pairs game matching a medication to its effect, class or key nursing action.
- **Lab value higher or lower:** is this value high, low or normal, and what does the LPN do next.
- **Priority triage sort:** order four clients by who the LPN sees first (ABCs, Maslow, safety, acute over chronic), with the stable/unstable line marked so RN-only clients are handed off.
- **PPE order:** drag the PPE items into donning and doffing order.
- **Med-math speed round:** dosage, drip rates and conversions against a timer, with worked steps.
- **Scope or not:** swipe tasks into LPN, RN or UAP.
- **Isolation match:** match diseases to contact, droplet or airborne precautions.

Games draw from the student's stones and sources, so they cover what he's studying. Scores feed readiness by client need.

### Remaining features

Timed adaptive practice exams (F4), more NGN item types (F5), rationales for every option (F6), med-math drills (F7), lab values trainer (F8), drug cards (F9), mistake notebook (F10), offline lessons (F12, a downloaded chapter cached on the phone), audio playlist mode (F14), clinical day prep (F15), LPN-scope care plan builder (F16), skills checklists (F17) and share a deck (F20, a read-only link to a lesson or question set, with no personal notes).

### Data model (migration `008_games_and_practice.sql`)

- `practice_items.item_type` gains the new NGN types and game types (new check constraint).
- `game_sessions` (id, user_id, game, stone_ids, score, duration_ms, finished_at) and `game_rounds`.
- `exam_sessions` (id, user_id, kind, started_at, finished_at, ability_estimate, stop_reason) and `exam_answers`.
- `drug_cards`, `skills_checklists` and `skill_checks`, `shared_decks` (token, item ids, expires_at).

### Routes

`/api/games/{game}/round` and `/api/games/{game}/finish`, `/api/exams/start`, `/api/exams/{id}/answer`, `/api/drug-cards`, `/api/clinical-prep`, `/api/care-plans`, `/api/skills`, `/api/share`.

### Tests

Grading for each NGN type, game round generation stays in LPN scope, adaptive stop rule, med-math answer checking with units, share links never expose notes.

## Open questions for the owner, by stage

- Stage 3: the textbook PDFs are for his own study only and stay private to his account. Confirm that's how he wants it.
- Stage 4: whether to add phone notifications (the official Capacitor plugin), and whether they should skip his work days.
- Stage 5: each deck checks up to 200 cards before asking to allow more (the button shows how many it will check). Say if you want a different default, and whether to set `ANTHROPIC_REVIEW_MODEL` in Vercel for the second look.
