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

## Stage 4: Study planner, spaced review and habits

### What the owner gets

- **Exam countdown (F3).** NCLEX-PN and HESI dates; the Path's pace adapts so every stone is mastered with a review buffer before the exam.
- **Study-time map per path.** The student marks the times he can study each week (with his work shifts in mind) and how to split them across courses (Fundamentals, Pharm, Med-Surg, Maternal/Peds). The map shows each course path's blocks across the week and what lands in each block.
- **Daily plan (F2).** A "Today" card at the top of the Path: stones to learn, stones due for review and a set of questions, sized to today's study blocks.
- **Spaced repetition (F1).** Mastered stones come back on a schedule (an SM-2 style interval per stone, reset by a miss). Due stones show a small clock on the Path.
- **Streaks and reminders (F13).** A daily streak, and a reminder at a time he picks: local notifications on Android (`@capacitor/local-notifications`), web push on the website.
- **Weekly progress report (F18).** A weekly card: what was mastered, what slipped, readiness change and next week's focus.

### Data model (migration `006_planner.sql`)

- `study_profiles` (user_id primary key, nclex_date, hesi_date, reminder_time, timezone, weekly_minutes jsonb).
- `study_blocks` (id, user_id, weekday, start_time, minutes, course_id).
- `stone_reviews` (stone_id, user_id, interval_days, ease, due_on, last_reviewed_at, lapses).
- `study_days` (user_id, day, minutes, stones_done, questions_answered) for streaks and reports.
- `weekly_reports` (id, user_id, week_start, payload jsonb).

### Routes

- `GET/PUT /api/planner/profile`, `GET/PUT /api/planner/blocks`, `GET /api/planner/today`, `POST /api/reviews/{stoneId}`, `GET /api/reports/weekly`.
- `complete_stone` is extended (new migration, not edited) to schedule the first review.

### Screens

Today card and due-review markers on the Path; a planner sheet (opened from the Today card, not a settings screen) with the exam dates and the weekly time map; the weekly report card on Readiness.

### Tests

SM-2 interval math, pacing math against exam dates and blocks, streak edges across time zones and midnight, route tests, and a migration test for the extended `complete_stone`.

## Stage 5: Anki decks

### What the owner gets

- **Import.** Magic + takes an Anki `.apkg` (or a text export). The importer reads the deck's SQLite file on the server, keeps fields, tags and media references, and files each card under the closest stone.
- **Fact-check.** Each card is checked against the student's own sources (textbook chunks, NotebookLM notes) by Sonnet. A card gets one of: agrees, disagrees, outdated, out of LPN scope, or no source found. Every flag quotes the source passage it rests on, with the book or notebook and page. Cards Sonnet can't settle go to the review model. **Nothing on a card changes until the student accepts the suggestion.**
- **New cards.** For stones with thin coverage, the app suggests new cards from the sources, each with its source quoted. Suggestions wait for acceptance.
- **Review.** Accepted cards join spaced review (stage 4), and every review session ends with NCLEX-style questions.
- **Export** of an accepted deck back to `.apkg` so it still works in Anki.

### Data model (migration `007_anki.sql`)

- `decks` (id, user_id, name, source_file_path, imported_at, card_count).
- `deck_cards` (id, user_id, deck_id, stone_id, front, back, tags text[], anki_note_id, state).
- `card_checks` (id, user_id, card_id, verdict, suggestion jsonb, source_refs jsonb, model, checked_at, decision: pending, accepted, dismissed).
- `card_suggestions` (id, user_id, stone_id, front, back, source_refs jsonb, decision).

### Routes

`POST /api/decks/import`, `POST /api/decks/{id}/check` (batched, resumable), `GET /api/decks/{id}/checks`, `POST /api/card-checks/{id}/decision`, `POST /api/decks/{id}/suggest`, `GET /api/decks/{id}/export`.

### Cost guard

Checks run in batches with prompt caching, show a running count, and stop at a per-import cap the student can raise. Only unclear cards go to the review model.

### Tests

`.apkg` parsing with a fixture deck, verdict schema parsing, the escalation rule, decision handling (a dismissed check never changes the card), and export round trip.

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
- Stage 4: reminder time and whether reminders should skip his work days.
- Stage 5: a per-import spending cap for the fact-check (the default will be shown before the first check runs).
