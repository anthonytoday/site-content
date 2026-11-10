#!/usr/bin/env python3
"""Cloudflare Web Analytics beacon gate — manual beacon must NOT be present in built pages.

Cloudflare zone has auto-install ON; the beacon is injected at the edge AFTER the build.
The built _site/ must contain ZERO manual beacon tags (no static.cloudflareinsights.com
script, no data-cf-beacon attribute, no cloudflareinsights references).

Also enforces: listed pages in _data/cf_analytics.yml carry exactly one beacon CSP meta
(from _data/csp.yml beacon key). /shop/ carries the shop key instead (SHOP60-01).

Usage: check-cf-analytics.py _site [repo_root]
"""
import os, re, sys

site = sys.argv[1] if len(sys.argv) > 1 else '_site'
root = sys.argv[2] if len(sys.argv) > 2 else '.'
cfg = open(os.path.join(root, '_data/cf_analytics.yml'), encoding='utf-8').read()
token = re.search(r'^token:\s*"([0-9a-f]{32})"\s*$', cfg, re.M).group(1)
pages = re.findall(r'^\s+-\s*"([^"]+)"\s*$', cfg, re.M)
NEVER = re.compile(r'^/(r|f|unsubscribe|thank-you|fr|go-fix-report|go|privacy|shop-preview)(/|$)|^/fr/|/(r|f|unsubscribe)/$', re.I)
# Manual beacon patterns that must NOT appear in built HTML (edge injects them).
BEACON_PATTERNS = ('static.cloudflareinsights.com', 'cloudflareinsights.com/cdn-cgi/rum', 'cloudflareinsights', 'beacon.min.js', 'data-cf-beacon')
BEACON = re.compile(r'<script\b[^>]*cloudflareinsights[^>]*>', re.I)
# 0057: the site-wide meta CSP. Only its exact beacon string is allowed on listed pages.
CSP_TAG = None
SHOP_CSP_TAG = None
csp_path = os.path.join(root, '_data/csp.yml')
if os.path.exists(csp_path):
    csp_data = open(csp_path, encoding='utf-8').read()
    m = re.search(r'^beacon:\s*"([^"]+)"\s*$', csp_data, re.M)
    if m:
        CSP_TAG = '<meta http-equiv="Content-Security-Policy" content="%s">' % m.group(1)
    m = re.search(r'^shop:\s*"([^"]+)"\s*$', csp_data, re.M)
    if m:
        SHOP_CSP_TAG = '<meta http-equiv="Content-Security-Policy" content="%s">' % m.group(1)
errs = []
if os.path.exists(csp_path) and not CSP_TAG:
    errs.append('_data/csp.yml has no beacon policy')
if len(pages) != len(set(pages)):
    errs.append('duplicate entries in include list')
for p in pages:
    if NEVER.search(p) or '?' in p or '#' in p:
        errs.append('never-allowed path in include list: %s' % p)

seen = 0
for dp, dn, fn in os.walk(site):
    for f in fn:
        if not f.endswith('.html'):
            continue
        path = os.path.join(dp, f)
        rel = '/' + os.path.relpath(path, site).replace(os.sep, '/')
        url = rel[:-len('index.html')] if rel.endswith('/index.html') or rel == '/index.html' else rel
        html = open(path, encoding='utf-8', errors='replace').read()
        listed = url in pages
        # Check for ANY manual beacon in built HTML (must be zero — edge injects)
        low = html.lower()
        hits = [b for b in BEACON_PATTERNS if b in low]
        tags = BEACON.findall(html)
        if hits or tags:
            errs.append('%s: manual beacon present in built page (%s)' % (url, ', '.join(hits) or 'script tag'))
        # CSP meta check on listed pages
        if CSP_TAG and listed:
            seen += 1
            want = SHOP_CSP_TAG if (url == '/shop/' and SHOP_CSP_TAG) else CSP_TAG
            if html.count(want) != 1:
                errs.append('%s: listed page lacks exactly one site-wide beacon CSP meta' % url)
            html = html.replace(want, '', 1)
            if re.search(r'http-equiv=["\']Content-Security-Policy', html, re.I):
                errs.append('%s: listed page has a meta CSP' % url)
            if re.search(r'http-equiv=["\']refresh', html, re.I):
                errs.append('%s: listed page is a redirect stub' % url)
missing = [p for p in pages if not os.path.exists(os.path.join(site, p.lstrip('/'), 'index.html'))]
for p in missing:
    errs.append('%s: listed but not built' % p)
for e in errs:
    print('cf-analytics: FAIL ' + e)
print('cf-analytics: %d listed page(s) with correct CSP meta; every built page has zero manual beacon' % seen if not errs else
      'cf-analytics: %d problem(s)' % len(errs))
sys.exit(1 if errs else 0)