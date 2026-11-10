# LPN MasterGuide

A Web + Android study app that takes an LPN/LVN student from day 1 to passing the NCLEX-PN and the HESI PN Exit exam.

## Stack

- Next.js 15 (App Router, TypeScript strict), Tailwind CSS v4 (config lives in `src/app/globals.css` via `@theme`), Framer Motion, Lucide React, canvas-confetti.
- Supabase: Postgres + `pgvector` + Storage. Migrations live in `supabase/migrations/`, numbered `NNN_name.sql`, never edited after they ship; add a new migration instead.
- Capacitor 8 for the Android app (`android/`, `capacitor.config.ts`, appId `com.lpnmasterguide.app`).
- AI: Anthropic SDK, model `claude-sonnet-5-5` (read from `ANTHROPIC_MODEL`). Do not use retired models such as `claude-3-5-sonnet-latest`. All AI calls run server-side in route handlers; the API key never reaches the client.

## Build phases

Build one phase at a time and stop for the owner's approval after each.

1. Foundation: this file, config, `001_initial_schema.sql`, glass UI primitives. (done)
2. Magic Add ingestion (`/api/magic-ingest`), textbook TOC lookup/OCR (`/api/books/build-syllabus`), blueprint sync (`/api/blueprints/sync`). (done)
3. Screens (`PathMap`, `MagicAddSheet`, `ReadinessRings`) and the lesson generator (`/api/lessons/generate`). (done)
4. Capacitor Android config, camera, TTS, APK build scripts. (done)

The next update is planned in `docs/ROADMAP.md` as six stages, each on its own branch with the owner's approval before merge. Stages 1 and 2 (the roadmap and the 20 UI fixes) are merged. Stage 3 (notebooks, whole textbooks, course plans, Ask and search) is on `claude/sources-and-plans`.

## Working style

The owner wants speed and thoroughness over saving tokens: build complete features, test them properly, and use the strongest approach rather than the cheapest.

- Lessons are generated once per stone, stored in `lessons`, and reused. Anything that changes a stone's sources (new notes, a newly linked question) deletes that stone's lesson so it regenerates (`invalidateLessons` in `src/lib/server/path.ts`).
- NCLEX-PN and HESI blueprint data is hand-written seed data in migrations, not scraped. `/api/blueprints/sync` reads it and checks it against `src/lib/blueprint-ids.ts`.

## Server architecture (Phase 2)

- Route handlers live in `src/app/api/**/route.ts` and stay thin: `requireUser` -> parse -> call a service -> `json`. Wrap them in `route()` from `src/lib/server/http.ts` so every error becomes `{ error: { code, message } }`. Messages in `ApiError` are shown to the student, so keep them short and friendly.
- Every request acts as the signed-in student (`Authorization: Bearer <supabase access token>`), so row-level security applies. Never use the service-role key in routes.
- Claude calls go through `generateStructured` (Zod schema in `src/lib/server/ai-schemas.ts`, streaming, `fallbacks: "default"`, cached system prompt) or `researchWithWebSearch`. Keep schemas free of length limits; enforce limits in code after parsing.
- Embeddings: Voyage `voyage-3.5`, 1024 dimensions, `document` for stored text and `query` for questions. Matching thresholds live in `path.ts` / `uworld.ts`.
- Multi-row writes that must succeed together go in a SQL function (see `create_syllabus` in `002_magic_add.sql`).
- Uploads: up to 10 files; photos JPEG/PNG/WebP/GIF under 5 MB (the Phase 3 client must downscale camera photos and convert HEIC); PDFs, markdown and text under 25 MB. On Vercel a request body is capped at about 4.5 MB, so larger files must go straight to Storage the way textbook PDFs do. Originals go to the private `uploads` bucket under `<user id>/ingest/<item id>/`.

## Testing

- `npm run typecheck`, `npm test` (unit + route tests), `npm run build`, `npm run mobile:build`.
- `npm run test:db` applies all migrations to a scratch Postgres (needs pgvector) and runs `supabase/tests/*_test.sql`.
- `npm run test:integration` runs the API routes (and the NotebookLM sync script as a child process) end to end against Postgres + PostgREST with Claude and Voyage faked. Needs `PGHOST`/`PGPORT`/`PGUSER` and `POSTGREST_BIN`; skipped otherwise.
- Every new route or migration gets tests at the matching level before a phase is called done.

## App architecture (Phase 3)

- `src/components/AppShell.tsx` owns the session, tabs, Magic + sheet and lesson player; screens live in `src/components/screens/`. Shapes shared by routes and screens are in `src/lib/api-types.ts`.
- The browser talks only to our API routes (`src/lib/client/api.ts`), sending the Supabase access token. Students start anonymous (`ensureSession`); saving an email and password keeps the same account.
- Lessons (`src/lib/server/lessons.ts`): one Claude call returns the whole deck (`LessonSchema`), then `tidyLesson` enforces limits in code: 3 bullets per card, 3 LPN Core sub-cards, NotebookLM quotes kept only if they appear word for word in the cited note, broken questions dropped. A fingerprint of the stone's sources decides when the cached deck is reused. Bump `LESSON_VERSION` when the prompt or card format changes.
- Practice items are sent to the phone without answers (`toPracticeView`) and graded on the server (`src/lib/server/practice.ts`). Quick Play = the lesson's 2 new questions plus a missed UWorld question's twin and bowtie, or the lesson's own NGN checkpoint when there is no twin.
- Readiness math (`src/lib/server/progress.ts`) is the app's own estimate and is labeled as one in the UI. HESI publishes no formula.
- NotebookLM folder sync: `scripts/notebooklm-sync.mjs` uploads with `as=notes` and `externalKey` (the file's path in the folder). The server stores a sha256 `content_hash`, skips unchanged files, and saves the new copy before deleting the old one.
- Modals (lesson, Magic +) make the page behind them `inert`.

## Sources and plans (stage 3)

- Notebooks (`src/lib/server/notebooks.ts`): every note source belongs to one; `resolveNotebook` picks it by id, by name (the sync script sends the top-level subfolder as `notebook`), or "My notes". Deleting a notebook deletes its notes on purpose; the database only clears the link.
- Whole textbook PDFs never pass through the API (Vercel caps a request at about 4.5 MB). The phone splits the PDF with `pdf-lib` (`src/lib/client/textbook-upload.ts`, sizes in `src/lib/textbook-parts.ts`: 20 MB target, 45 MB cap, 40 parts), uploads each part to `uploads/<user>/textbooks/<book>/part-N.pdf`, registers it (`POST /api/textbooks/{id}/parts` with its sha256), then asks the server to read it (`POST /api/textbooks/{id}/process`). Parts are read in order so page numbers carry over; a part already read is skipped, so an interrupted upload resumes.
- Reading a part (`src/lib/server/books/textbook-pdf.ts`): `unpdf` per page, `chunkPdfPages` (`src/lib/server/text/pdf-chunk.ts`) splits by headings it spots from line shapes and drops running headers and page numbers, Voyage embeds, `link_textbook_chunks` links each passage to the nearest stone of the same book. Scanned parts (almost no text) are marked `no_text`.
- Lessons read up to 6 linked passages (`stone_textbook_chunks`) and the notes' notebook names; both are in the fingerprint. Card captions name the book pages and the notebook (`lessonCaptions`).
- Course plans (`src/lib/server/course-plan.ts`): Claude only groups stones (by S-number) into weeks with titles and goals; `tidyPlan` keeps every stone once and in path order. The server, not the model, fills each week's sources and coverage from `course_plan_sources`. A week's checkpoint is picked at read time from its stones' practice items. A plan is stale when its source fingerprint changes, and the Plan view redrafts it.
- Ask about this card (`src/lib/server/ask.ts`) and search (`src/lib/server/search.ts`, SQL `search_study`): citations are checked in code against the numbered sources.

## Planner and spaced review (stage 4)

- All the math is pure, in `src/lib/study-math.ts`, shared by server and client: SM-2 (`gradeFromScore`, `nextReview`, `reviewDueOn`), pacing (`pace`), today's plan (`planToday`), `streak`, `weeklyReport`, `reminderIcs`. Server code is `src/lib/server/planner.ts`.
- The student's day comes from the planner's time zone: SQL `local_day()`, TS `localDay(at, tz)`. Until a profile is saved, `GET /api/planner/today?tz=` saves the phone's time zone.
- `study_days` counts activity: the `practice_attempts` trigger adds questions, `complete_stone` adds a stone mastered, a review adds a review, and the app posts lesson minutes to `/api/planner/activity`.
- A review scores the stone's lesson items answered since the round started (`POST /api/reviews/{stoneId}` with `startedAt`). It needs the stone mastered; "again" sets it to `needs_review`.
- Phone notifications aren't built: they need `@capacitor/local-notifications`, which hasn't been approved. The website offers an .ics calendar reminder.

## Android app (Phase 4)

- `MOBILE_BUILD=1 next build` (`npm run mobile:build`) static-exports the screens to `out/`, Capacitor's `webDir`. In that mode only `.tsx`/`.jsx` count as pages, so `route.ts` and `middleware.ts` are left out; the app calls the hosted API at `NEXT_PUBLIC_API_BASE_URL` (`API_BASE` in `src/lib/client/api.ts`). Keep screens free of server-only imports and dynamic routes so the export keeps working.
- The app's origin is `https://localhost` (`androidScheme: "https"`). `src/middleware.ts` + `src/lib/server/cors.ts` allow it (plus `CORS_ALLOWED_ORIGINS`) on `/api/*`, without credentials; auth stays the Bearer token.
- Phone features go through `src/lib/client/native.ts` only: `takePhoto`/`pickPhotos` (Camera 8 `takePhoto`/`chooseFromGallery`; `getPhoto`/`pickImages` are deprecated), `speak`/`stopSpeaking` (`@capacitor-community/text-to-speech`, since Android WebView speech is unreliable), `haptic`, `setupNativeChrome`, `onBackButton`. Each falls back to web APIs in the browser, and plugins load with dynamic `import()`.
- No camera or media permission is declared: photos come from the camera app intent and the system photo picker. Only `READ_EXTERNAL_STORAGE` up to API 28 for old phones.
- Never put a secret, a Google cookie or a Google token in the app. `scripts/android-build.sh` fails the build if a server key's value appears in `out/`.
- Build with `npm run android:apk | android:release | android:bundle`; release signing reads `android/keystore.properties` or `LPN_KEYSTORE_*` env vars (`scripts/android-keystore.sh` makes them). Icons and splash come from `assets/` via `npx @capacitor/assets generate --android`; the adaptive icon XML is hand-edited to drop its inset, so re-check it after regenerating.
- Testing the native paths without a phone: load `out/` in a browser with a fake `window.androidBridge` + `window.Capacitor` (`PluginHeaders`, `nativePromise`, `nativeCallback`), which makes Capacitor treat the page as Android.

## Clinical content rules (non-negotiable)

Every lesson, question and rationale must stay inside LPN/LVN scope of practice:

- **Data collection**, not initial RN assessment. The LPN collects data and reports abnormal findings to the RN or provider.
- **Reinforce teaching** the RN or provider started; the LPN does not create the initial teaching plan.
- Care for **stable clients with predictable outcomes**. Unstable or new-admission clients go to the RN.
- **Delegation**: LPNs assign to UAPs only tasks within UAP scope (ADLs, vitals on stable clients, ambulation, I&O). Never delegate assessment, teaching, evaluation, or care of unstable clients.
- **Medication safety**: rights of medication administration, check allergies and parameters (apical pulse before digoxin, BP before antihypertensives), and state-specific IV therapy limits.
- Priority frameworks used in hints: ABCs, Maslow, safety, acute over chronic, actual over potential.
- Clinical Judgment uses the NCSBN model steps: Recognize Cues, Analyze Cues, Prioritize Hypotheses, Generate Solutions, Take Action, Evaluate Outcomes.

## Third-party content rules

- UWorld screenshots the user uploads are stored privately for that user only (Supabase Storage + row-level security).
- Twin Questions and NGN items must be newly written. Never copy UWorld, HESI or textbook question text.
- Notes from the user's NotebookLM exports are the primary source of truth for lesson Card 4 and are never shared between users.

## UX rules

- A 10-year-old should be able to use it. Three-button floating dock only: Path, Magic +, Readiness.
- No settings screens, no dense tables, no walls of text. Story cards have at most 3 bullets.
- Node colors: Electric Blue = ready, Emerald = mastered, Ruby Red = needs review.
- Story card order and glow: 1 Cyan "Explain Like I'm 10", 2 Blue "The LPN Core", 3 Amber "HESI Hint & NCLEX Alert", 4 Violet "From Your NotebookLM", 5 Emerald "Quick Play".
- Respect `prefers-reduced-motion`; all Framer Motion animation in primitives checks `useReducedMotion()`.
- Every interactive element needs an accessible name and a 44px minimum touch target.

## Design tokens

- Canvas: `bg-canvas` (`#020617` dark, `#eef2f7` light) with blurred aurora orbs (`AmbientCanvas`). Never hard-code the canvas hex in a screen.
- Glass surface: `GLASS_SURFACE` in `GlassCard.tsx` (`backdrop-blur-2xl bg-glass` with specular borders `border-t-edge-t border-l-edge-l border-b-edge-soft border-r-edge-soft`), inner highlight `shadow-[inset_0_1px_1px_rgba(255,255,255,0.35)]`.
- Light mode follows the phone. `globals.css` remaps tokens under `prefers-color-scheme: light`: `white` becomes the ink color and the pale accent shades (100 to 300) become deep ones, so screens keep writing `text-white/..` and `text-sky-300`. Use `snow` for anything that must stay white in both themes (text and sheen on colored buttons and stones), `on-accent` for text on bright accent fills, and `dock` for the dock and dropdowns.
- Bottom spacing: `--safe-bottom` (gesture bar, from `env()` or Capacitor's `--safe-area-inset-bottom`), `--safe-top`, and `--dock-space` (the room the dock takes). Pad scrolling screens with `--dock-space`; `AppShell` draws a canvas fade under the dock.
- Wide screens (`TWO_PANE_QUERY`, 700px and up, e.g. the Fold opened): the lesson opens as a right-hand pane beside the path instead of covering it.
- Loading states use the `.shimmer` class; first-run screens show one clear action instead of zeros.
- Reuse the primitives in `src/components/glass/`; don't restyle glass ad hoc in screens. Pure layout and chart math lives in `src/lib/ui/` with unit tests.

## Code rules

- Complete, working files. No `// TODO`, placeholders or stubbed functions.
- Path alias `@/*` maps to `src/*`. Use `cn()` from `@/lib/cn` to merge classes.
- Client components declare `"use client"` at the top; keep data fetching in server components or route handlers.
