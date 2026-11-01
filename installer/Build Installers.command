#!/bin/bash
# Builds "Service Status Installer.pkg" on a Mac with Apple's own tools (codesign, pkgbuild, productbuild).
# One installer for Intel and Apple Silicon. Safe to re-run.
set -e
cd "$(dirname "$0")"
echo "== checking files"
cat x64.part_* > x64.zip
cat arm64.part_* > arm64.zip
shasum -a 256 -c SHA256SUMS
rm -rf work && mkdir -p work/x64 work/arm64
unzip -q x64.zip -d work/x64
unzip -q arm64.zip -d work/arm64
for a in x64 arm64; do
  APP="work/$a/Service Status.app"
  if [ -f app.asar ] && [ -f asar_hash.txt ]; then      # latest app code
    read OLD NEW < asar_hash.txt
    cp app.asar "$APP/Contents/Resources/app.asar"
    sed -i '' "s/$OLD/$NEW/" "$APP/Contents/Info.plist"
    grep -q "$NEW" "$APP/Contents/Info.plist" && echo "   $a: latest app code in"
  fi
  echo "== signing $a"
  xattr -cr "$APP"
  codesign --force --deep --sign - "$APP"
  codesign --verify --deep --strict "$APP" && echo "   signature OK"
  R="work/root_$a"; mkdir -p "$R"; ditto "$APP" "$R/Service Status.app"
  pkgbuild --analyze --root "$R" "work/comp_$a.plist" >/dev/null
  plutil -replace 0.BundleIsRelocatable -bool NO "work/comp_$a.plist"
  chmod 755 pkg/scripts/postinstall
  pkgbuild --root "$R" --component-plist "work/comp_$a.plist" --install-location /Applications \
    --scripts pkg/scripts --identifier "app.servicestatus.$a" --version 2.0.0 "work/$a.pkg" >/dev/null
  echo "   $a package built"
done
echo "== building the installer"
rm -f "Service Status Installer.pkg"
productbuild --distribution pkg/distribution.xml --resources pkg/resources --package-path work "Service Status Installer.pkg" >/dev/null
pkgutil --expand "Service Status Installer.pkg" work/check >/dev/null && echo "   installer checks out"
rm -rf work x64.zip arm64.zip
echo "== DONE"
ls -lh "Service Status Installer.pkg"
open -R "Service Status Installer.pkg"
