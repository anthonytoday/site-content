#!/usr/bin/env python3
"""Build-gate CSP sync check (0061).

1. Recompute sha256 of every inline JS <script> in _site (skips src= and JSON/LD types).
2. Fail if any hash is missing from: each meta CSP on that page, AND the committed header file.
3. Fail on inline event-handler attributes (on*=) and javascript: URLs (hashes do not cover them
   without 'unsafe-hashes').
4. Fail if any of default/beacon/shop in _data/csp.yml has a script-src hash set that differs
   from the header file; fail if script_hashes: (when present) differs from the header file;
   fail if the header: key in csp.yml does not exactly equal the header file.
5. Warn on header hashes that no built page uses (stale).
6. Optional --live URL: compare live Content-Security-Policy header to the file (read-only GET).
   Non-blocking while Cloudflare still serves Report-Only: prints WARN, does not fail the step.

Usage:
  check-csp-sync.py _site _data/csp.yml security/csp-header.txt
  check-csp-sync.py _site _data/csp.yml security/csp-header.txt --live https://www.anthonytoday.com/
"""
import base64
import hashlib
import os
import re
import sys
import urllib.request

SCRIPT = re.compile(r"<script\b([^>]*)>(.*?)</script>", re.I | re.S)
META = re.compile(r'<meta http-equiv="Content-Security-Policy" content="([^"]+)"', re.I)
HANDLER = re.compile(r"<[a-z][^>]*\son[a-z]+\s*=", re.I)
JSURL = re.compile(r'(href|src|action)\s*=\s*["\']\s*javascript:', re.I)
def h(b):
    return "sha256-" + base64.b64encode(hashlib.sha256(b.encode("utf-8")).digest()).decode()


def hashes(p):
    for part in p.split(";"):
        t = part.split()
        if t and t[0] == "script-src":
            return {x.strip("'") for x in t[1:] if "sha256-" in x}
    return set()


def main(a):
    if len(a) < 3:
        print("csp-sync: usage: check-csp-sync.py _site _data/csp.yml security/csp-header.txt [--live URL]", file=sys.stderr)
        return 2
    site, yml, hdr = a[:3]
    live = a[a.index("--live") + 1] if "--live" in a else None
    header = open(hdr, encoding="utf-8").read().strip()
    H = hashes(header)
    fails = []
    used = set()
    yml_text = open(yml, encoding="utf-8").read()

    # header: key in csp.yml must exactly equal the committed file (single source of truth).
    hm = re.search(r'^header:\s*"([^"]+)"\s*$', yml_text, re.M)
    if not hm:
        fails.append("csp.yml: missing header: \"...\" key")
    else:
        yheader = hm.group(1).replace("&#39;", "'")
        if yheader != header:
            fails.append("csp.yml header: value != %s (regenerate with generate-csp-header.py)" % hdr)

    # script_hashes: list (optional but preferred) must equal the header hash set.
    # Only count hashes under a script_hashes: block: take consecutive list items after that key.
    sh_block = re.search(r'^script_hashes:\s*\n((?:[ \t]*-[^\n]*\n)+)', yml_text, re.M)
    if sh_block:
        listed = re.findall(r'sha256-[A-Za-z0-9+/=]+', sh_block.group(1))
        listed_set = set(listed)
        if listed_set != H:
            fails.append(
                "csp.yml script_hashes differ from header file (+%d/-%d)"
                % (len(listed_set - H), len(H - listed_set))
            )

    # Meta policies must share the header's script-src hash set.
    for k, v in re.findall(r'^(default|beacon|shop):\s*"([^"]+)"\s*$', yml_text, re.M):
        s = hashes(v.replace("&#39;", "'"))
        if s != H:
            fails.append(
                "csp.yml:%s script-src hashes differ from header file (+%d/-%d)"
                % (k, len(s - H), len(H - s))
            )

    pages = 0
    for dp, _, fs in os.walk(site):
        for f in fs:
            if not f.endswith(".html"):
                continue
            rel = os.path.relpath(os.path.join(dp, f), site)
            t = open(os.path.join(dp, f), encoding="utf-8").read()
            pages += 1
            metas = [hashes(m.replace("&#39;", "'")) for m in META.findall(t)]
            inline_count = 0
            for attrs, body in SCRIPT.findall(t):
                if "src=" in attrs.lower() or re.search(r'type="application/(ld\+)?json"', attrs, re.I):
                    continue
                inline_count += 1
                hv = h(body)
                used.add(hv)
                if hv not in H:
                    fails.append("%s: inline script %s missing from header file" % (rel, hv))
                if not metas:
                    fails.append("%s: inline script present but page has no meta CSP" % rel)
                for i, m in enumerate(metas):
                    if hv not in m:
                        fails.append("%s: inline script %s missing from meta #%d" % (rel, hv, i + 1))
            if HANDLER.search(t):
                fails.append("%s: inline on* event handler present" % rel)
            if JSURL.search(t):
                fails.append("%s: javascript: URL present" % rel)

    stale = H - used
    print(
        "csp-sync: %d pages, %d distinct inline hashes, header has %d, %d stale"
        % (pages, len(used), len(H), len(stale))
    )
    for s in sorted(stale):
        print("csp-sync: WARN stale header hash", s)
    if live:
        try:
            r = urllib.request.urlopen(
                urllib.request.Request(live, method="HEAD", headers={"User-Agent": "csp-sync"}),
                timeout=20,
            )
            lv = (r.headers.get("Content-Security-Policy") or "").strip()
            # Also accept Report-Only while enforcing is not yet live.
            if not lv:
                lv = (r.headers.get("Content-Security-Policy-Report-Only") or "").strip()
                if lv:
                    print("csp-sync: WARN live serves Content-Security-Policy-Report-Only (enforcing header not live yet)")
            if lv != header:
                # Non-blocking until the enforcing header is live in Cloudflare.
                print("csp-sync: WARN live CSP at %s != header file (non-blocking until enforcing)" % live)
            else:
                print("csp-sync: live CSP at %s matches header file" % live)
        except Exception as e:
            print("csp-sync: WARN --live check failed: %s" % e)
    for f in fails:
        print("csp-sync: FAIL", f)
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
