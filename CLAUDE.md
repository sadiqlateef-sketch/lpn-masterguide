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
- Uploads: up to 10 files; photos JPEG/PNG/WebP/GIF under 5 MB (the Phase 3 client must downscale camera photos and convert HEIC); PDFs, markdown and text under 25 MB. Originals go to the private `uploads` bucket under `<user id>/ingest/<item id>/`.

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

- Canvas: `#020617` with blurred aurora orbs (`AmbientCanvas`).
- Glass surface: `backdrop-blur-2xl bg-white/[0.07]`, specular borders `border-t-white/25 border-l-white/20 border-b-white/5 border-r-white/5`, inner highlight `shadow-[inset_0_1px_1px_rgba(255,255,255,0.35)]`.
- Reuse the primitives in `src/components/glass/`; don't restyle glass ad hoc in screens.

## Code rules

- Complete, working files. No `// TODO`, placeholders or stubbed functions.
- Path alias `@/*` maps to `src/*`. Use `cn()` from `@/lib/cn` to merge classes.
- Client components declare `"use client"` at the top; keep data fetching in server components or route handlers.
