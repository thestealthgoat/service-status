#!/usr/bin/env python3
"""Publish a new app-code version for the built-in updater.

    python3 tools/publish_update.py 2.0.1 "What changed"

Copies src/server.js + src/index.html into update/files/<version>/ and rewrites update/latest.json
with their SHA-256 checksums. Commit and push; every installed copy picks it up within 6 hours
(or right away from Service Status > Check for Updates…) and uses it after its next restart.
Changes to main.js, package.json or Electron need a new installer: also set "min_shell" to that version.
"""
import hashlib, json, pathlib, shutil, sys
ROOT = pathlib.Path(__file__).resolve().parent.parent
RAW = 'https://raw.githubusercontent.com/thestealthgoat/service-status/main/'
ver, notes = sys.argv[1], (sys.argv[2] if len(sys.argv) > 2 else '')
min_shell = sys.argv[3] if len(sys.argv) > 3 else '2.0.0'
out = ROOT / 'update' / 'files' / ver
out.mkdir(parents=True, exist_ok=True)
files = {}
import subprocess
for f in ('server.js', 'index.html'):
    shutil.copyfile(ROOT / 'src' / f, out / f)
# older Android/iPhone browsers don't understand ?. and ?? -- ship the page's script rewritten for them
try:
    subprocess.run(['node', str(ROOT / 'tools' / 'compat.js'), str(ROOT / 'src' / 'index.html'), str(out / 'index.html')], check=True)
except Exception as e:
    print('WARNING: compat step skipped (' + str(e) + ') -- shipping the page as written', file=sys.stderr)
# checksums are taken AFTER the compat step so they match the files actually shipped
for f in ('server.js', 'index.html'):
    files[f] = {'url': RAW + f'update/files/{ver}/{f}', 'sha256': hashlib.sha256((out / f).read_bytes()).hexdigest()}
if set(files) != {'server.js', 'index.html'}:
    sys.exit('ERROR: update feed would be missing files: ' + str(sorted(files)))
latest = {'version': ver, 'min_shell': min_shell, 'notes': notes, 'files': files}
(ROOT / 'update' / 'latest.json').write_text(json.dumps(latest, indent=2) + '\n')
print(json.dumps(latest, indent=2))
