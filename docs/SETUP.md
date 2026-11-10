# Setting up LPN MasterGuide

You need three free accounts. Each one gives you keys that go in a file called `.env.local` (copy `.env.example` and fill it in).

## 1. Supabase (database and file storage)

1. Create a project at [supabase.com](https://supabase.com).
2. Open **SQL Editor** and run each file in `supabase/migrations/` in order: `001_initial_schema.sql`, `002_magic_add.sql`, `003_lessons_progress_sync.sql`, `004_advisor_fixes.sql`, then `005_sources_and_plans.sql`.
3. Open **Authentication > Sign In / Providers** and turn on **Allow anonymous sign-ins**. The app signs students in automatically so there is no login screen. Leave **Email** sign-in on too: students save an email and password from Magic + when they want to sync a NotebookLM folder or move to a new phone.
4. Open **Project Settings > API** and copy:
   - Project URL into `NEXT_PUBLIC_SUPABASE_URL`
   - `anon` public key into `NEXT_PUBLIC_SUPABASE_ANON_KEY`

## 2. Anthropic (the AI that reads photos and builds lessons)

1. Create an API key at [console.anthropic.com](https://console.anthropic.com).
2. Put it in `ANTHROPIC_API_KEY`. Leave `ANTHROPIC_MODEL=claude-sonnet-5-5`.

## 3. Voyage AI (matches your notes to the right lesson)

1. Create an API key at [voyageai.com](https://www.voyageai.com).
2. Put it in `VOYAGE_API_KEY`.

## Optional: Google Books

Book lookups work without a key but Google limits them heavily. A free key from the Google Cloud console goes in `GOOGLE_BOOKS_API_KEY`.

## Run it

```bash
npm install
npm run dev
```

Then open http://localhost:3000.

## What Phase 2 added

| Endpoint | What it does |
| --- | --- |
| `POST /api/magic-ingest` | The Magic + button. Accepts a book title or ISBN, photos of a cover or table of contents, UWorld screenshots or pasted questions, or NotebookLM notes (PDF, markdown, text, or photos). Figures out what it is and handles it. |
| `POST /api/books/build-syllabus` | Turns a textbook into your learning path. Looks up the chapter list in Google Books and OpenLibrary, reads it from photos, or searches the web, then splits each chapter into bite-size stepping stones tagged to the NCLEX-PN and HESI blueprints. |
| `GET /api/blueprints/sync` | Returns the NCLEX-PN 2026 test plan, NGN steps, HESI domains and score bands, and checks they're consistent. |
| `POST /api/blueprints/sync` | Tags any untagged stepping stones and links notes and questions that were added before their book. |

Notes and questions you add before their book is on your path are saved and link up automatically once you add the book. A missed UWorld question turns its stepping stone red and gets two brand-new practice questions: a twin question and an NGN mini bowtie.

## What Phase 3 added

The app itself: the **Path** map, the **Magic +** sheet and the **Readiness** rings, plus the 5-card story lessons with Quick Play.

| Endpoint | What it does |
| --- | --- |
| `GET /api/path` | Your stepping-stone map, grouped by course, in study order, with the stone to open next. |
| `POST /api/lessons/generate` | Builds a stone's 5-card lesson from your textbook chapter, your NotebookLM notes, your UWorld misses and the NCLEX/HESI blueprint. Saved and reused until one of those sources changes. |
| `POST /api/practice/attempt` | Checks a Quick Play answer on the server and saves it. Answers are never sent to the phone ahead of time. |
| `POST /api/stones/{id}/complete` | Scores the lesson's Quick Play. 80% or better masters the stone; either way the next stone opens. |
| `GET /api/readiness` | NCLEX-PN readiness %, a HESI score projection (after 20 answers), and your weakest areas with stones to review. Both are the app's estimates, not official scores. |
| `GET /api/notes/sources`, `DELETE /api/notes/sources/{id}` | Lists or removes saved notes. Removing notes rebuilds the lessons that used them. |

## Syncing a NotebookLM folder

NotebookLM has no official export API, so the app syncs a folder instead. It never uses Google cookies or logins.

1. In the app, open **Magic + > Sync a NotebookLM folder** and save an email and password.
2. Export your NotebookLM notes (study guides, briefing docs, saved notes) as PDF, markdown or text into one folder.
3. From the app folder (so it can read `.env.local`), run:

```bash
LPN_EMAIL=you@example.com node scripts/notebooklm-sync.mjs --folder ~/NotebookLM --app https://your-app-address --watch --prune
```

It asks for your password. New files are added, edited files replace their old copy (and the lessons that used them rebuild), and unchanged files are skipped. `--prune` removes notes whose file you deleted; `--watch` keeps checking every 20 seconds; `--dry-run` shows what would happen without sending anything.

Screenshots of each screen at phone size are in `docs/phase3-*.png`.

## The Android app

The Android app carries its own copy of the screens and calls your hosted web app for everything else (lessons, practice, uploads). So the web app goes online first, then you build the app on your computer.

### 1. Put the web app online

Any Next.js host works. With [Vercel](https://vercel.com): import the project, add every key from `.env.local` under **Settings > Environment Variables** (leave `NEXT_PUBLIC_API_BASE_URL` empty there), and deploy. Note the address it gives you, such as `https://lpn-masterguide.vercel.app`.

The API already accepts calls from the Android app. Nothing secret goes into the app: the Anthropic and Voyage keys stay on the server, and the build stops if one ever shows up in the app bundle.

### 2. Set up your computer (once)

1. Install [Node.js 20 or newer](https://nodejs.org) and [Android Studio](https://developer.android.com/studio). Open Android Studio once and let it finish installing the Android SDK.
2. Tell the build where Android Studio put things. On a Mac:

   ```bash
   export ANDROID_HOME="$HOME/Library/Android/sdk"
   export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
   ```

   On Windows, install [Git for Windows](https://git-scm.com/download/win), run `npm config set script-shell "C:\\Program Files\\Git\\bin\\bash.exe"` once so the build scripts run in its bash, and set `ANDROID_HOME=%LOCALAPPDATA%\Android\Sdk` and `JAVA_HOME=C:\Program Files\Android\Android Studio\jbr` in **System Properties > Environment Variables**. On Linux, use `$HOME/Android/Sdk` and Android Studio's `jbr` folder.
3. Add your web app's address to `.env.local`:

   ```bash
   NEXT_PUBLIC_API_BASE_URL=https://lpn-masterguide.vercel.app
   ```

### 3. Build and install

```bash
npm install
npm run android:apk
```

That checks your setup (with a plain-English message if something is missing), builds the screens, copies them into `android/`, and compiles `dist/LPN-MasterGuide-0.1.0-debug.apk`. To install it, either plug in your phone with **USB debugging** on and run `adb install -r dist/LPN-MasterGuide-0.1.0-debug.apk`, (`adb` is in `$ANDROID_HOME/platform-tools`), or copy the file to your phone and open it (Android asks you to allow installs from that app once).

`npm run android:open` opens the project in Android Studio instead, where the green Run button installs it on a plugged-in phone or an emulator.

### Release builds (to share the app or put it on Google Play)

```bash
npm run android:keystore   # once: makes your signing key and asks for a password
npm run android:release    # signed APK in dist/
npm run android:bundle     # signed .aab for the Google Play Console
```

The keystore is saved in `~/.lpn-masterguide/` and its settings in `android/keystore.properties` (never committed). Back up both the file and the password: every update has to be signed with the same key. For the Play Store, raise the version each time with `LPN_VERSION_CODE=2 npm run android:bundle` (the number must always go up).

### What runs on the phone

| Feature | How it works in the app |
| --- | --- |
| Snap Photo / Screenshot | Asks **Take a photo** (the phone's camera app) or **Choose from photos** (the system photo picker, up to 10, where screenshots live). No camera or storage permission is needed on current Android. |
| Listen | Reads the card aloud with the phone's own text-to-speech voice. |
| Quick Play | A short buzz for right and wrong answers, and a bigger one when a lesson is done. |
| Back button | Closes a lesson or the Magic + sheet, then goes back to the Path, then leaves the app. |
| Look | Dark status bar and splash screen that match the app, with the app icon from `assets/icon.svg`. |

To try changes on a phone without rebuilding each time, start the dev server on your Wi-Fi with its own API (`NEXT_PUBLIC_API_BASE_URL= npm run dev -- -H 0.0.0.0`), then build once with `CAP_LIVE_URL=http://<your computer's Wi-Fi address>:3000 npm run android:apk`. That debug app loads the screens live from your computer; build normally again before sharing it.

After an Android build, run `npm run build` again before `npm start`, since both builds share Next.js's working folder.

Screenshots of the Android-only screens are in `docs/phase4-*.png`.
