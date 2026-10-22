#!/usr/bin/env python3
"""Check meta-CSP hash pins in built pages.

For every built HTML page that carries <meta http-equiv="Content-Security-Policy">, every inline <script>
and <style> body must have its sha256 listed in script-src / style-src, and every hash listed must belong
to an inline block (no stale pins). A page can carry more than one meta CSP (0057: the site-wide policy from
_data/csp.yml comes first, then the page's own pinned policy); the browser enforces all of them, so every
one is checked, not just the first. Pages without 'unsafe-inline' in style-src must have no style="" attributes
in the static HTML.

Usage: python3 .github/scripts/check-csp-hash.py [site_dir] [page ...]
"""
import base64
import hashlib
import os
import re
import sys

SITE = sys.argv[1] if len(sys.argv) > 1 else "_site"
ONLY = sys.argv[2:]
META_RE = re.compile(r'<meta http-equiv="Content-Security-Policy" content="([^"]+)"', re.I)
BLOCK_RE = re.compile(r"<(script|style)\b([^>]*)>(.*?)</\1>", re.I | re.S)


def h(body):
    return "sha256-" + base64.b64encode(hashlib.sha256(body.encode("utf-8")).digest()).decode()


def directive(csp, name):
    for part in csp.split(";"):
        bits = part.strip().split()
        if bits and bits[0] == name:
            return bits[1:]
    return None


def main():
    failures, checked = [], 0
    for dirpath, _, files in os.walk(SITE):
        for name in files:
            if not name.endswith(".html"):
                continue
            path = os.path.join(dirpath, name)
            rel = os.path.relpath(path, SITE)
            if ONLY and rel not in ONLY:
                continue
            text = open(path, encoding="utf-8").read()
            metas = META_RE.findall(text)
            if not metas:
                continue
            checked += 1
            for raw in metas:
                check_policy(rel, text, raw.replace("&#39;", "'"), failures)
            print("csp-hash: %s ok? %s" % (rel, not any(f.startswith(rel + ":") for f in failures)))
    print("csp-hash: %d page(s) with a meta CSP checked" % checked)
    if failures:
        print("\nCSP HASH FAILURES:")
        for f in failures:
            print(" - " + f)
        return 1
    return 0


def check_policy(rel, text, csp, failures):
    for kind in ("script", "style"):
        allowed = directive(csp, kind + "-src") or directive(csp, "default-src") or []
        pins = {x.strip("'") for x in allowed if x.strip("'").startswith("sha256-")}
        seen = set()
        for tag, attrs, body in BLOCK_RE.findall(text):
            if tag.lower() != kind or (kind == "script" and "src=" in attrs):
                continue
            if kind == "script" and re.search(r'type="application/(ld\+)?json"', attrs):
                continue
            hv = h(body)
            seen.add(hv)
            if hv not in pins and "'unsafe-inline'" not in allowed:
                failures.append("%s: inline %s %s not in %s-src" % (rel, kind, hv, kind))
        for p in pins - seen:
            failures.append("%s: stale %s-src pin %s (no matching inline block)" % (rel, kind, p))
    style_src = directive(csp, "style-src") or []
    if "'unsafe-inline'" not in style_src and re.search(r'\sstyle="', text):
        failures.append("%s: style= attribute present but style-src has no 'unsafe-inline'" % rel)


if __name__ == "__main__":
    sys.exit(main())
