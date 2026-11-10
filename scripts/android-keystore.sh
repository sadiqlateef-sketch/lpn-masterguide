#!/usr/bin/env bash
# Creates the private key that signs release builds, and android/keystore.properties pointing at it.
# Run once. Back up the .jks file and the password: Android only installs an update if it is signed
# with the same key, so losing it means students have to uninstall and reinstall.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STORE_DIR="${LPN_KEYSTORE_DIR:-$HOME/.lpn-masterguide}"
STORE="$STORE_DIR/lpn-masterguide-release.jks"
PROPS="$ROOT/android/keystore.properties"
ALIAS="lpn-masterguide"

command -v keytool > /dev/null 2>&1 || {
  echo "✖ keytool wasn't found. It comes with Java; set JAVA_HOME to Android Studio's JDK and add \$JAVA_HOME/bin to PATH." >&2
  exit 1
}
if [ -f "$STORE" ]; then
  echo "✖ $STORE already exists. Keep using it; making a new key would break updates." >&2
  echo "  To point the build at it again, create $PROPS with storeFile, storePassword, keyAlias and keyPassword." >&2
  exit 1
fi

read -r -s -p "Choose a keystore password (at least 6 characters): " PASSWORD
echo
read -r -s -p "Type it again: " CONFIRM
echo
[ "$PASSWORD" = "$CONFIRM" ] || { echo "✖ The passwords didn't match." >&2; exit 1; }
[ "${#PASSWORD}" -ge 6 ] || { echo "✖ The password must be at least 6 characters." >&2; exit 1; }

mkdir -p "$STORE_DIR"
chmod 700 "$STORE_DIR"
keytool -genkeypair -v -keystore "$STORE" -alias "$ALIAS" -keyalg RSA -keysize 4096 -validity 10000 \
  -storepass "$PASSWORD" -keypass "$PASSWORD" -dname "CN=LPN MasterGuide, O=LPN MasterGuide, C=US"
chmod 600 "$STORE"

umask 077
cat > "$PROPS" << PROPS
storeFile=$STORE
storePassword=$PASSWORD
keyAlias=$ALIAS
keyPassword=$PASSWORD
PROPS

echo ""
echo "✔ Release key saved to $STORE"
echo "  Signing settings saved to android/keystore.properties (git ignores it)."
echo "  Back up the .jks file and your password now, e.g. to a password manager."
