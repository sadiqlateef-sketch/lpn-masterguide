#!/usr/bin/env bash
# Builds the LPN MasterGuide Android app.
#
#   npm run android:apk       debug APK you can install on your own phone
#   npm run android:release   signed release APK (needs scripts/android-keystore.sh first)
#   npm run android:bundle    signed release .aab for the Google Play Store
#
# Needs: Node 20+, JDK 21, and the Android SDK (Android Studio installs both). The screens are bundled
# into the app and talk to your hosted web app at NEXT_PUBLIC_API_BASE_URL. No secret key is ever put
# in the app: the build stops if one shows up in the bundle.
set -euo pipefail

MODE="${1:-debug}"
case "$MODE" in
  debug | release | bundle) ;;
  *)
    echo "Usage: scripts/android-build.sh [debug|release|bundle]" >&2
    exit 2
    ;;
esac

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

fail() {
  echo "" >&2
  echo "✖ $1" >&2
  shift
  for line in "$@"; do echo "  $line" >&2; done
  exit 1
}
step() { echo "" && echo "▸ $1"; }

# Load the same env files Next.js reads, so the checks below see the same values the build uses.
# Values already set in the shell win, like they do for Next.js.
load_env_file() {
  local line key value
  while IFS= read -r line || [ -n "$line" ]; do
    line="${line%$'\r'}"
    case "$line" in '' | '#'*) continue ;; esac
    line="${line#export }"
    key="${line%%=*}"
    value="${line#*=}"
    [[ "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || continue
    case "$value" in
      \"*\") value="${value:1:${#value}-2}" ;;
      \'*\') value="${value:1:${#value}-2}" ;;
    esac
    [ -n "${!key+x}" ] || export "$key=$value"
  done < "$1"
}
for f in .env.production.local .env.local .env.production .env; do
  if [ -f "$f" ]; then load_env_file "$f"; fi
done

step "Checking your setup"

[ -d node_modules ] || fail "Packages aren't installed." "Run: npm install"

if ! command -v java > /dev/null 2>&1; then
  fail "Java isn't installed." \
    "Install Android Studio (it includes Java), then set JAVA_HOME to its JDK, for example:" \
    "  macOS:   export JAVA_HOME=\"/Applications/Android Studio.app/Contents/jbr/Contents/Home\"" \
    "  Windows: set JAVA_HOME=C:\\Program Files\\Android\\Android Studio\\jbr" \
    "  Linux:   export JAVA_HOME=\$HOME/android-studio/jbr"
fi
JAVA_MAJOR="$(java -version 2>&1 | sed -n 's/.*version "\([0-9]*\).*/\1/p' | head -1)"
if [ -n "$JAVA_MAJOR" ] && [ "$JAVA_MAJOR" -lt 21 ]; then
  fail "Java $JAVA_MAJOR is too old; the Android build needs Java 21." \
    "Point JAVA_HOME at Android Studio's bundled JDK (see docs/SETUP.md, Android app)."
fi

SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
if [ -z "$SDK" ] && [ -f android/local.properties ]; then
  SDK="$(sed -n 's/^sdk\.dir=//p' android/local.properties | sed 's/\\:/:/g; s/\\\\/\\/g')"
fi
if [ -z "$SDK" ]; then
  for guess in "$HOME/Library/Android/sdk" "$HOME/Android/Sdk" "${LOCALAPPDATA:-}/Android/Sdk"; do
    if [ -d "$guess" ]; then SDK="$guess"; break; fi
  done
fi
[ -n "$SDK" ] && [ -d "$SDK" ] || fail "The Android SDK wasn't found." \
  "Install Android Studio and open its SDK Manager once, then set ANDROID_HOME, for example:" \
  "  macOS:   export ANDROID_HOME=\$HOME/Library/Android/sdk" \
  "  Linux:   export ANDROID_HOME=\$HOME/Android/Sdk" \
  "  Windows: set ANDROID_HOME=%LOCALAPPDATA%\\Android\\Sdk"
export ANDROID_HOME="$SDK"
export ANDROID_SDK_ROOT="$SDK"

[ -n "${NEXT_PUBLIC_SUPABASE_URL:-}" ] && [ -n "${NEXT_PUBLIC_SUPABASE_ANON_KEY:-}" ] ||
  fail "NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY aren't set." "Add them to .env.local (see docs/SETUP.md)."

if [ -n "${CAP_LIVE_URL:-}" ]; then
  echo "  Live reload: the app will load screens from $CAP_LIVE_URL"
  [ "$MODE" = "debug" ] || fail "CAP_LIVE_URL is for debug builds only." "Unset it before a release build."
else
  API="${NEXT_PUBLIC_API_BASE_URL:-}"
  [ -n "$API" ] || fail "NEXT_PUBLIC_API_BASE_URL isn't set." \
    "Set it to your hosted web app, for example https://lpn-masterguide.vercel.app" \
    "(the phone calls that address for lessons, practice and uploads)."
  case "$API" in
    https://*) ;;
    *) fail "NEXT_PUBLIC_API_BASE_URL must start with https:// (got $API)." ;;
  esac
fi

if [ "$MODE" != "debug" ]; then
  if [ -z "${LPN_KEYSTORE_PATH:-}" ] && [ ! -f android/keystore.properties ]; then
    fail "No release signing key yet." "Run once: npm run android:keystore" "Then keep the keystore file and its passwords somewhere safe; every update must be signed with it."
  fi
fi

step "Building the app screens (MOBILE_BUILD=1)"
rm -rf out
MOBILE_BUILD=1 npx next build

step "Checking the bundle for secret keys"
for name in ANTHROPIC_API_KEY SUPABASE_SERVICE_ROLE_KEY VOYAGE_API_KEY OPENAI_API_KEY; do
  value="${!name:-}"
  if [ -n "$value" ] && grep -rqF -- "$value" out; then
    rm -rf out
    fail "$name ended up in the app bundle. The build was stopped and deleted." \
      "Server keys must never use the NEXT_PUBLIC_ prefix or be imported by a screen."
  fi
done
echo "  No server keys found in the bundle."

step "Copying the screens and plugins into the Android project"
npx cap sync android

step "Compiling with Gradle"
# The app's version shown in Android settings follows package.json unless LPN_VERSION_NAME is set.
VERSION="$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' package.json | head -1)"
export LPN_VERSION_NAME="${LPN_VERSION_NAME:-$VERSION}"
cd android
chmod +x gradlew
case "$MODE" in
  debug) ./gradlew --no-daemon assembleDebug ;;
  release) ./gradlew --no-daemon assembleRelease ;;
  bundle) ./gradlew --no-daemon bundleRelease ;;
esac
cd "$ROOT"

mkdir -p dist
case "$MODE" in
  debug) SRC=android/app/build/outputs/apk/debug/app-debug.apk; DEST="dist/LPN-MasterGuide-$VERSION-debug.apk" ;;
  release) SRC=android/app/build/outputs/apk/release/app-release.apk; DEST="dist/LPN-MasterGuide-$VERSION.apk" ;;
  bundle) SRC=android/app/build/outputs/bundle/release/app-release.aab; DEST="dist/LPN-MasterGuide-$VERSION.aab" ;;
esac
[ -f "$SRC" ] || fail "Gradle finished but $SRC is missing." "If this was a release build, check the signing passwords in android/keystore.properties."
cp "$SRC" "$DEST"

echo ""
echo "✔ Built $DEST"
if [ "$MODE" = "bundle" ]; then
  echo "  Upload it in the Google Play Console under Release > Production (or Internal testing)."
else
  echo "  Install on a phone plugged in with USB debugging on:  adb install -r \"$DEST\""
  echo "  Or copy the file to the phone and open it (allow installs from this source when asked)."
fi
