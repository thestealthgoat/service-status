#!/bin/bash
# Build the signed, notarized "Service Status Installer.pkg" (one installer for Intel and Apple Silicon).
#
#   tools/build_installer.sh [electron version]        e.g. tools/build_installer.sh 45.2.1
#
# Needs on this Mac: Node (~/.local/node), `npm install --no-save @electron/packager@20.3.0`, the Developer ID
# Application + Installer certificates in the login keychain (with Apple's Developer ID G2 intermediate), and the
# notary login saved as keychain profile "service-status" (xcrun notarytool store-credentials). No passwords here.
# Stops at the first failure. Output: dist/<version>/Service Status Installer.pkg
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.local/node/bin:$PATH"
ELECTRON="${1:-45.2.1}"
VER=$(node -p "require('./src/package.json').version")
OUT="dist/$VER"
PROFILE="service-status"
APP_ID=$(security find-identity -v -p codesigning | grep -m1 "Developer ID Application:" | awk '{print $2}')
PKG_ID=$(security find-identity -v | grep -m1 "Developer ID Installer:" | awk '{print $2}')
[ -n "$APP_ID" ] && [ -n "$PKG_ID" ] || { echo "Developer ID Application/Installer certificate missing or not trusted"; exit 1; }
xcrun notarytool history --keychain-profile "$PROFILE" >/dev/null || { echo "notary profile '$PROFILE' not working"; exit 1; }

notarize() {   # notarize a file (zip or pkg); print Apple's log and stop if it isn't Accepted
  local out id status
  out=$(xcrun notarytool submit "$1" --keychain-profile "$PROFILE" --wait --output-format json)
  id=$(printf '%s' "$out" | python3 -c "import json,sys;print(json.load(sys.stdin)['id'])")
  status=$(printf '%s' "$out" | python3 -c "import json,sys;print(json.load(sys.stdin)['status'])")
  echo "   notarization $status"
  if [ "$status" != "Accepted" ]; then xcrun notarytool log "$id" --keychain-profile "$PROFILE"; exit 1; fi
}

if [ "${SKIP_PACKAGE:-}" != "1" ]; then
  echo "== package + sign (Electron $ELECTRON)"
  rm -rf "$OUT"; node tools/package_app.mjs "$OUT" "$APP_ID" "$ELECTRON"
fi
for a in x64 arm64; do
  APP="$OUT/Service Status-darwin-$a/Service Status.app"
  codesign --verify --deep --strict "$APP" || { echo "$a app isn't properly signed"; exit 1; }
  if xcrun stapler validate "$APP" >/dev/null 2>&1; then
    echo "== $a app already notarized and stapled"
  else
    echo "== notarize the $a app"
    ditto -c -k --keepParent "$APP" "$OUT/app-$a.zip"
    notarize "$OUT/app-$a.zip"; rm -f "$OUT/app-$a.zip"
    xcrun stapler staple "$APP" >/dev/null && echo "   stapled"
  fi
  echo "== $a package"
  R="$OUT/root-$a"; rm -rf "$R"; mkdir -p "$R"; ditto "$APP" "$R/Service Status.app"
  pkgbuild --analyze --root "$R" "$OUT/comp-$a.plist" >/dev/null
  plutil -replace 0.BundleIsRelocatable -bool NO "$OUT/comp-$a.plist"
  chmod 755 installer/pkg/scripts/postinstall
  pkgbuild --root "$R" --component-plist "$OUT/comp-$a.plist" --install-location /Applications \
    --scripts installer/pkg/scripts --identifier "app.servicestatus.$a" --version "$VER" "$OUT/$a.pkg" >/dev/null
done
echo "== signed installer"
sed "/<pkg-ref/ s/version=\"[0-9.]*\"/version=\"$VER\"/" installer/pkg/distribution.xml > "$OUT/distribution.xml"   # package versions only, not the XML header
PKG="$OUT/Service Status Installer.pkg"
productbuild --distribution "$OUT/distribution.xml" --resources installer/pkg/resources --package-path "$OUT" \
  --sign "$PKG_ID" --timestamp "$PKG" >/dev/null
echo "== notarize the installer"
notarize "$PKG"
xcrun stapler staple "$PKG" >/dev/null && echo "   stapled"
echo "== Apple's checks"
spctl -a -vv -t install "$PKG"
pkgutil --check-signature "$PKG" | head -4
xcrun stapler validate "$PKG"
rm -rf "$OUT"/root-* "$OUT"/comp-*.plist "$OUT"/x64.pkg "$OUT"/arm64.pkg "$OUT/distribution.xml"
ls -lh "$PKG"
