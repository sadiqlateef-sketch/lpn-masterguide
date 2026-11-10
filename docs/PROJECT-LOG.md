# LPN MasterGuide: project log

Everything done on the app so far, in order, and where things stand today. Last updated 2026-11-10.

## Where things live

| What | Where |
| --- | --- |
| Code (source of truth) | GitHub `sadiqlateef-sketch/lpn-masterguide` (private), branch `main` |
| Working copy in the Claude project | `/mnt/project-files/lpn-masterguide/` |
| Live web app and API | https://lpn-masterguide.vercel.app (Vercel, Hobby plan, deploys from GitHub `main`) |
| Database, sign-in, file storage | Supabase project `lpn-masterguide` (ref `vozovrbvnxrgppagaqos`, region us-west-2), owned by the account sadiq.lateef010@gmail.com with sadiq.lateef@gmail.com invited to its team |
| Android app | `builds/LPN-MasterGuide-connected-debug.apk` in the project folder (not in git) |
| Setup guide | `docs/SETUP.md` |
| Rules for whoever works on the code | `CLAUDE.md` |

The other Supabase project, **ironlog**, belongs to a different app (the workout log). Nothing for LPN MasterGuide goes there.

## What the app does

A study app for LPN/LVN students, from day one to passing the NCLEX-PN and the HESI PN Exit exam. It runs on the web and as an Android app.

- **Path:** a map of bite-size "stepping stones" built from your own school textbooks, grouped by course (Fundamentals, Pharmacology, Med-Surg, Maternal/Peds). Blue means ready, green means mastered, and red means it needs review.
- **Magic +:** one button for everything you add. Snap a photo or screenshot, paste a note or question, or add a school book by title or ISBN. The app works out what it is and files it.
- **Lessons:** each stone has a 5-card story lesson: Explain Like I'm 10, The LPN Core, HESI Hint & NCLEX Alert, From Your NotebookLM, and Quick Play. Listen reads the cards aloud. 80% or better on Quick Play masters the stone and opens the next one.
- **Readiness:** an NCLEX-PN readiness % and a HESI score projection (after 20 answers), plus your weakest areas. Both are the app's own estimates, not official scores.
- **NotebookLM:** your exported notes feed Card 4 of each lesson. A sync script can keep a folder of exports up to date.
- **UWorld:** a missed question you add turns its stone red and gets two brand-new practice questions, a twin question and an NGN mini bowtie. UWorld text is never copied.
- Everything stays inside LPN scope of practice: data collection, reinforcing teaching, stable clients, and safe delegation.

## Build history

### Phase 1: Foundation (done 2026-10-17)

- Next.js 15 + TypeScript + Tailwind v4 + Framer Motion project, with the glass UI building blocks (`src/components/glass/`).
- Database schema `supabase/migrations/001_initial_schema.sql`: textbooks, units, modules, stepping stones, notes with vector search, UWorld questions, practice items and attempts, lessons, the private `uploads` storage bucket, and row-level security so each student only sees their own data.
- Hand-written blueprint data (not scraped): the NCLEX-PN 2026 test plan client needs and weights, the six NCSBN Clinical Judgment steps, the HESI PN domains and score bands, and the four courses.
- `CLAUDE.md` with the project, clinical-content and design rules.

### Phase 2: Magic Add and syllabus building (done 2026-10-18)

- `POST /api/magic-ingest`: accepts a book title or ISBN, cover or table-of-contents photos, UWorld screenshots or pasted questions, and NotebookLM notes (PDF, markdown, text or photos), and figures out which one it is.
- `POST /api/books/build-syllabus`: finds a textbook's chapter list (Google Books and Open Library first, then a web search by Claude, then a photo of the table of contents read by Claude) and splits each chapter into stepping stones tagged to the NCLEX-PN and HESI blueprints.
- `GET/POST /api/blueprints/sync`: checks the blueprint data, tags untagged stones, and links notes and questions added before their book.
- Migration `002_magic_add.sql`.

### Phase 3: Screens and lessons (done 2026-10-19)

- The Path map, the Magic + sheet, the lesson player and the Readiness rings.
- `POST /api/lessons/generate`: one Claude call builds a stone's whole 5-card lesson from the textbook chapter, your notes, your missed UWorld questions and the blueprint. It's saved and reused until one of those sources changes.
- Quick Play is graded on the server, so answers are never sent to the phone ahead of time. `POST /api/stones/{id}/complete` masters the stone at 80% or better and opens the next one.
- `GET /api/readiness`, the notes list and delete endpoints, and the NotebookLM folder sync script (`scripts/notebooklm-sync.mjs`).
- Migration `003_lessons_progress_sync.sql`. 104 tests passing at that point, including end-to-end tests against a real local database.

### Phase 4: Android app (done 2026-10-19)

- Capacitor 8 Android project (`android/`, app id `com.lpnmasterguide.app`). The screens are bundled into the app, and it calls the hosted API for everything else.
- Native features: camera or photo picker for Magic +, read-aloud with the phone's own voice, haptic buzz on Quick Play, the Android back button, a dark splash screen and status bar, and the app icon.
- CORS so the API accepts calls from the Android app and refuses other websites.
- Build scripts: `npm run android:apk` (debug), `android:release` and `android:bundle` (signed, for sharing or the Play Store), and `android:keystore`. The build stops if a secret key ever ends up in the app.
- 112 tests passing at that point.

### Next update, stages 1 and 2 (2026-11-10, merged)

- `docs/ROADMAP.md` plans the next update in six stages: the 40 ideas plus multiple NotebookLM notebooks, whole textbooks and a course plan that deepens with each source, a study-time planner, Anki import with fact-check flags, learning games, and NCLEX-style questions closing every section.
- Stage 2 fixed the 20 UI items: dock and bottom spacing on gesture-bar phones, light mode, course tabs with swipe and a remembered choice, Continue button and chapter jump list, a drawn trail between stones, clearer locked stones, Ready count, a weekly trend chart and tap-to-explain rings on Readiness, first-run screens, shimmer loading, colored story cards, a fading swipe hint, answer flashes, a bigger mastery celebration, the Fold's side-by-side lesson pane, and the phone's text size in the app.
- Before and after screenshots are in `docs/ui-polish/`. No database change.

### Next update, stage 3 (2026-11-10, merged and live)

- Several NotebookLM notebooks: Magic + has a notebook picker, the sync script files each top-level subfolder as a notebook, and lesson cards name the notebook and source.
- Whole textbook PDFs: "Add a whole book (PDF)" in Magic + splits big PDFs on the phone, uploads the parts straight to Storage and reads them one by one. Lessons then use the real pages and cite them.
- Course plan: a Path / Plan switch on each course. Weeks of stones with goals, the book pages and notebooks behind each week, how well it's covered, and an NCLEX checkpoint per week. It redrafts when a source changes.
- Ask about this card (a button on lesson cards) and one search box in Magic +.
- Migration `005_sources_and_plans.sql` was applied to the live database on 2026-11-10 before the merge.

### Next update, stage 4 (2026-11-10, branch `claude/study-planner`, awaiting approval)

- Today card at the top of the Path: reviews due, stones to learn and a question goal sized to today's study times, a streak, and the pace toward the next exam.
- Planner sheet: NCLEX-PN and HESI dates, a review-only buffer, study times per weekday with a course each, and a daily reminder (a calendar download on the website).
- Spaced review: a mastered stone comes back the next day, then further out the better each review goes. Due stones show a clock on the Path. A poor review sends the stone back to learn again.
- Weekly report on Readiness.
- Needs migration `006_planner.sql` on the live database before the merge. It is written and tested on a scratch database, not applied.

## Going live (2026-10-19 to 2026-11-10)

1. **First APK (2026-10-19).** Built in a cloud environment that allows Google's Android download servers. Gradle compiled it fine, but there were no Supabase keys or hosted address yet, so that build only showed "This copy of the app isn't connected yet". It has since been deleted.
2. **Supabase (2026-11-10).** The first Supabase account's free plan was full, so a new project `lpn-masterguide` was made on sadiq.lateef010@gmail.com. Then sadiq.lateef@gmail.com was invited to its team and the Supabase connector was re-authorized so Claude could reach it.
3. **Database set up.** Migrations 001, 002 and 003 were applied, then a new `004_advisor_fixes.sql` for two Supabase security-advisor warnings: a fixed `search_path` on `set_updated_at`, and the API can no longer call the trigger function `flag_missed_question`. The result is 19 tables with the NCLEX-PN and HESI data loaded. One advisor warning is left on purpose: the `vector` extension sits in the `public` schema, and moving it would break the vector columns.
4. **Guest sign-ins turned on** in Supabase (Authentication > Sign In / Providers > Allow anonymous sign-ins), with Email left on. Tested and working.
5. **AI keys.** An Anthropic key (with a little billing credit) and a Voyage AI key were created. The first pair showed up in a screenshot in the project chat, so replacing them with new keys was recommended. If that hasn't been done, do it and update Vercel.
6. **GitHub.** An empty private repo `lpn-masterguide` was created and the code uploaded through the GitHub website. The web upload skipped the hidden files (`.gitignore`, `.env.example`, `android/.gitignore`, `android/app/.gitignore`). They were added back in the commit that brought in this log.
7. **Vercel.** The repo was imported into Vercel with six environment variables: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL=claude-sonnet-5-5`, `VOYAGE_API_KEY` and `VOYAGE_MODEL=voyage-3.5`. Lessons learned there:
   - Pasting a whole `.env` block from a phone joins the lines into one, so enter each variable on its own row.
   - Never copy a value from Vercel's masked display. The first deploy got `eyJhbGci•••…` as the anon key and every sign-in failed.
   - `NEXT_PUBLIC_*` variables can't be marked **Sensitive**. Those two are public by design, and Supabase's row-level security protects the data. Keep the AI keys Sensitive.
   - Environment variable changes only apply after a **Redeploy**.
8. **Live checks.** On https://lpn-masterguide.vercel.app: sign-in works, the Path loads, and a test note went through Claude and Voyage and was saved with its exam pearl.
9. **Connected APK.** Rebuilt with `NEXT_PUBLIC_API_BASE_URL=https://lpn-masterguide.vercel.app` and installed on the Galaxy Z Fold8 over wireless ADB from the Windows PC. The old build had to be uninstalled first because it was signed with a different debug key.
10. **First real use.** "Textbook of Nursing Foundation" was added and became 84 stepping stones, the first lessons and Quick Play were done, and the guest account was upgraded to a saved, confirmed email account.

## How to rebuild the Android app

On a computer with Node 20+, Java 21 and the Android SDK (see `docs/SETUP.md`), put this in `.env.local`:

```
NEXT_PUBLIC_SUPABASE_URL=https://vozovrbvnxrgppagaqos.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<the anon key from Supabase > Project Settings > API>
NEXT_PUBLIC_API_BASE_URL=https://lpn-masterguide.vercel.app
```

Then run `npm install` and `npm run android:apk`. The APK lands in `dist/`. Install it with `adb install -r dist/LPN-MasterGuide-0.1.0-debug.apk`.

A Claude cloud thread can do the same in the "Android build" environment (it allows dl.google.com and maven.google.com): install the Android command-line tools, then `platform-tools`, `platforms;android-36` and `build-tools;36.0.0`, and run the same script. The first build takes about 3 minutes.

Each cloud build is signed with a new debug key, so the phone needs the old app uninstalled first. A release build signed with your own keystore (`npm run android:keystore`, then `npm run android:release`) avoids that and is what the Play Store needs.

## Updating the web app

Push to `main` on GitHub and Vercel redeploys on its own. A database change goes in a new numbered migration in `supabase/migrations/` (never edit one that has already run). Apply it to the Supabase project, and add it to the list in `docs/SETUP.md`.

## Open items

- **Migration 006:** apply `006_planner.sql` to the live Supabase project before stage 4 goes live.
- **Phone reminders:** need the `@capacitor/local-notifications` plugin, waiting on the owner's yes.
- **Note uploads over 4.5 MB:** Vercel caps a request body at about 4.5 MB, so a large PDF note sent through Magic + or the sync script may fail even though the app allows 25 MB. Textbook PDFs avoid this by going straight to Storage; notes could do the same later.

- **Signed release build:** not made yet. It's needed before sharing the app or publishing to Google Play.
- **Test accounts:** a few empty guest accounts from testing sit in Supabase Authentication, plus one with a sample digoxin note. They're harmless and can be deleted under Authentication > Users.
- **Phone testing:** Claude checked the install and launch on the phone; everything after that has only been tested by using the app. Report anything that looks wrong.
- **NCLEX-PN data:** the 2026 test plan weights came from a UWorld summary of the plan effective 2026-04-01. Confirm them against NCSBN's official test plan.
