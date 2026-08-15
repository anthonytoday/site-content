#!/usr/bin/env python3
"""Site build gate. Runs in CI on every push to main and mirrors the local
pre-push checks, so web edits and bot commits cannot publish breakage
silently. Prints a summary line, then every failure, and exits non-zero on
any failure.

Usage: python3 .github/scripts/gate.py [site_dir] [source_dir]
"""
import datetime
import json
import os
import re
import sys

SITE = sys.argv[1] if len(sys.argv) > 1 else "_site"
SRC = sys.argv[2] if len(sys.argv) > 2 else "."

LD_RE = re.compile(r'<script type="application/ld\+json">(.*?)</script>', re.S)
STRAY_RE = re.compile(r'(?:src|href|alt)="[^"\n]*"/\s')
STUB_MARK = '<meta http-equiv="refresh"'
FR_OVERRIDE = 'html[lang="fr"] h1'
DASHES = ("\u2013", "\u2014")  # en dash, em dash: house style forbids both

failures = []
notes = []


def read(path):
    with open(path, encoding="utf-8") as fh:
        return fh.read()


def walk(root, suffix):
    for dirpath, _, files in os.walk(root):
        for name in files:
            if name.endswith(suffix):
                yield os.path.join(dirpath, name)


def front_matter(path):
    """Tiny flat-key parser: enough for permalink/lang/alt_url, no yaml dep."""
    try:
        head = read(path)[:4000]
    except (UnicodeDecodeError, OSError):
        return {}
    if not head.startswith("---"):
        return {}
    end = head.find("\n---", 3)
    if end == -1:
        return {}
    out = {}
    for line in head[3:end].splitlines():
        m = re.match(r"^([a-z_]+):\s*(\S.*?)\s*$", line)
        if m:
            out[m.group(1)] = m.group(2).strip('"').strip("'")
    return out


# ---- 1. Built pages: footer coverage, JSON-LD validity, stray-slash attrs,
# ----    French typography override, house-style dashes
built = list(walk(SITE, ".html"))
content_pages = footed = ld_blocks = 0
for path in sorted(built):
    text = read(path)
    if STUB_MARK in text:
        continue  # redirect stub: intentionally no footer, no schema
    content_pages += 1
    rel = os.path.relpath(path, SITE)
    if "<footer" in text:
        footed += 1
    else:
        failures.append("no <footer>: %s" % rel)
    for i, block in enumerate(LD_RE.findall(text), 1):
        try:
            json.loads(block)
            ld_blocks += 1
        except ValueError as e:
            failures.append("invalid JSON-LD block %d in %s: %s" % (i, rel, e))
    m = STRAY_RE.search(text)
    if m:
        failures.append("stray '/' after an attribute in %s: %r" % (rel, m.group(0)))
    if rel.split(os.sep)[0] == "fr" and FR_OVERRIDE not in text:
        failures.append("FR page missing the typography override: %s" % rel)
    for dash in DASHES:
        if dash in text:
            failures.append("en/em dash in %s" % rel)
            break

# ---- 2. alt_url reciprocity across language twins (source front matter)
pages = {}
skip_dirs = (".git", "_site", "_includes", "_layouts", "_data", "assets", ".github")
for path in walk(SRC, ".html"):
    rel = os.path.relpath(path, SRC)
    if rel.split(os.sep)[0] in skip_dirs:
        continue
    fm = front_matter(path)
    if fm.get("permalink"):
        pages[fm["permalink"]] = (fm.get("alt_url"), rel)
twins = 0
for permalink, (alt, rel) in sorted(pages.items()):
    if not alt:
        continue
    twins += 1
    target = pages.get(alt)
    if target is None:
        failures.append("alt_url of %s points at missing page %s" % (rel, alt))
    elif target[0] != permalink:
        failures.append("alt_url not reciprocal: %s <-> %s" % (rel, alt))

# ---- 3. security.txt: both locations present, identical, not expiring soon
sec_bodies = []
for rel in (os.path.join(".well-known", "security.txt"), "security.txt"):
    p = os.path.join(SITE, rel)
    if os.path.exists(p):
        sec_bodies.append(read(p).strip())
    else:
        failures.append("missing built file: %s" % rel)
if len(sec_bodies) == 2 and sec_bodies[0] != sec_bodies[1]:
    failures.append("security.txt copies differ between /.well-known/ and the legacy path")
exp = None
if sec_bodies:
    m = re.search(r"^Expires:\s*(\S+)", sec_bodies[0], re.M)
    if m:
        try:
            exp = datetime.datetime.strptime(m.group(1), "%Y-%m-%dT%H:%M:%S.%fZ")
        except ValueError:
            failures.append("security.txt Expires not parseable: %s" % m.group(1))
    else:
        failures.append("security.txt has no Expires line")
if exp is not None:
    days = (exp - datetime.datetime.utcnow()).days
    if days < 14:
        failures.append("security.txt expires in %d days; renew it" % days)

# ---- 4. Identity-leak guard (only when the PRIVATE_NAME secret exists)
private_name = os.environ.get("PRIVATE_NAME", "").strip()
if not private_name:
    notes.append("PRIVATE_NAME secret not set; identity-leak check skipped")
else:
    leaks = 0
    for path in walk(SRC, ""):
        rel = os.path.relpath(path, SRC)
        parts = rel.split(os.sep)
        if parts[0] in (".git", "_site", "node_modules"):
            continue
        try:
            text = read(path)
        except (UnicodeDecodeError, OSError):
            continue  # binary asset
        if private_name.lower() not in text.lower():
            continue
        if parts[0] == "redirects":
            continue  # agreed carve-out: the noindex /go/ stubs
        for line in text.splitlines():
            if private_name.lower() in line.lower() and "linkedin.com/in/" not in line:
                failures.append("identity leak outside carve-outs: %s" % rel)
                leaks += 1
                break
    if leaks == 0:
        notes.append("identity-leak check passed")

# ---- report
print("gate: %d/%d content pages footed, %d JSON-LD blocks valid, %d language twins checked"
      % (footed, content_pages, ld_blocks, twins))
for note in notes:
    print("note: " + note)
if failures:
    print("\nGATE FAILURES:")
    for f in failures:
        print(" - " + f)
    sys.exit(1)
print("gate: all checks passed")
