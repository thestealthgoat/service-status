#!/usr/bin/env python3
"""Promote the Beta version to Stable: everyone (not just computers set to Updates → Beta) gets it.

    python3 tools/promote.py

Copies update/beta.json over update/latest.json. Refuses when Beta isn't newer than Stable. Commit and push after.
"""
import json, pathlib, sys
ROOT = pathlib.Path(__file__).resolve().parent.parent
beta, stable = ROOT / 'update' / 'beta.json', ROOT / 'update' / 'latest.json'
ver = lambda v: tuple(int(x) for x in str(v).split('.'))
if not beta.exists():
    sys.exit('Nothing on Beta: publish with  python3 tools/publish_update.py <version> "notes" --beta  first.')
b, s = json.loads(beta.read_text()), json.loads(stable.read_text())
if ver(b['version']) <= ver(s['version']):
    sys.exit(f"Beta {b['version']} isn't newer than Stable {s['version']}: nothing to promote.")
if set(b.get('files') or {}) != {'server.js', 'index.html'}:
    sys.exit('Beta feed is missing files; not promoting.')
stable.write_text(beta.read_text())
print(f"Stable is now {b['version']} (was {s['version']}). Commit and push update/latest.json.")
