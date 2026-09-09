#!/usr/bin/env python3
"""Apply a deterministic change spec to a repo checkout. Same script runs locally and in CI.

Usage: apply.py <repo_dir> <spec.json> [<spec.json> ...]

Spec: JSON list of ops, applied in order. Every op must match exactly or the run aborts
(nothing is written for a failing op; earlier ops stay applied, so run on a clean tree).
  {"op":"replace","path":"fr/home.html","old":"...","new":"...","count":1}
      old must occur exactly `count` times (default 1); all occurrences replaced.
  {"op":"replace_all","path":"assets/css/b-x.css","old":"#6B7280","new":"#5C6875","min":1,"ci":true}
      replace every occurrence (case-insensitive when ci); at least `min` matches required.
  {"op":"rehash_bundle","path":"assets/css/b-546283131b.css"}
      compute sha1(content)[:10], git mv to assets/css/b-<hash>.css, and rewrite every
      reference to the old filename in *.html, *.yml, *.py, *.md under the repo (skipping
      _site and .git). Run AFTER the bundle's content edits.
  {"op":"delete","path":"..."}  git rm the file.
"""
import hashlib, json, os, re, subprocess, sys

repo = os.path.abspath(sys.argv[1]); os.chdir(repo)
SKIP = {"_site", ".git", "node_modules"}

def read(p): return open(p, encoding="utf-8").read()
def write(p, s): open(p, "w", encoding="utf-8").write(s)

def walk_text():
    for dp, dn, fn in os.walk("."):
        dn[:] = [d for d in dn if d not in SKIP]
        for f in fn:
            if f.endswith((".html", ".yml", ".yaml", ".py", ".md", ".txt", ".xml", ".json", ".css")):
                yield os.path.normpath(os.path.join(dp, f))

log = []
for spec in sys.argv[2:]:
    for i, op in enumerate(json.load(open(spec, encoding="utf-8"))):
        kind = op["op"]; p = op.get("path")
        if kind == "replace":
            s = read(p); n = s.count(op["old"]); want = op.get("count", 1)
            if n != want: sys.exit(f"{spec}[{i}] {p}: expected {want} match(es) of old, found {n}")
            write(p, s.replace(op["old"], op["new"])); log.append(f"replace {p} x{n}")
        elif kind == "replace_all":
            s = read(p)
            if op.get("ci"):
                pat = re.compile(re.escape(op["old"]), re.I); n = len(pat.findall(s)); s2 = pat.sub(op["new"], s)
            else:
                n = s.count(op["old"]); s2 = s.replace(op["old"], op["new"])
            if n < op.get("min", 1): sys.exit(f"{spec}[{i}] {p}: expected at least {op.get('min',1)} match(es), found {n}")
            write(p, s2); log.append(f"replace_all {p} x{n}")
        elif kind == "rehash_bundle":
            b = open(p, "rb").read(); h = hashlib.sha1(b).hexdigest()[:10]
            newp = os.path.join(os.path.dirname(p), f"b-{h}.css")
            if newp == p: log.append(f"rehash {p}: unchanged"); continue
            subprocess.run(["git", "mv", p, newp], check=True)
            old_name, new_name = os.path.basename(p), os.path.basename(newp); refs = 0
            for f in walk_text():
                if f == newp: continue
                s = read(f)
                if old_name in s:
                    write(f, s.replace(old_name, new_name)); refs += s.count(old_name)
            log.append(f"rehash {old_name} -> {new_name}, {refs} reference(s) updated")
        elif kind == "delete":
            subprocess.run(["git", "rm", "-q", p], check=True); log.append(f"delete {p}")
        else:
            sys.exit(f"{spec}[{i}]: unknown op {kind}")
for l in log: print(l)
print(f"applied {len(log)} ops")
