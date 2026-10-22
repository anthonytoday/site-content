#!/usr/bin/env python3
"""Cloudflare Web Analytics beacon gate (0042).

Fails when:
  - a beacon appears on any built page not in the explicit include list
    (_data/cf_analytics.yml pages), including /r/, /f/, /unsubscribe/,
    /thank-you/, /fr/ and any page with a meta CSP;
  - a listed page is missing, has no beacon, has a meta CSP, is a redirect
    stub, or matches a never-allowed path;
  - a beacon uses another host, another token, inline code, or appears twice;
  - (0057) a listed page lacks exactly one site-wide beacon CSP meta from _data/csp.yml
    (beacon key), or an unlisted page carries it. That one exact meta is the only meta
    CSP a listed page may have, and it is removed before the beacon checks above.
Usage: check-cf-analytics.py _site [repo_root]
"""
import os, re, sys

site = sys.argv[1] if len(sys.argv) > 1 else '_site'
root = sys.argv[2] if len(sys.argv) > 2 else '.'
cfg = open(os.path.join(root, '_data/cf_analytics.yml'), encoding='utf-8').read()
token = re.search(r'^token:\s*"([0-9a-f]{32})"\s*$', cfg, re.M).group(1)
pages = re.findall(r'^\s+-\s*"([^"]+)"\s*$', cfg, re.M)
NEVER = re.compile(r'^/(r|f|unsubscribe|thank-you|fr|go-fix-report|go|privacy|shop-preview)(/|$)|^/fr/|/(r|f|unsubscribe)/$', re.I)
# CFA-02: any of these on an unlisted page fails (matched on html.lower()).
BEACON_PATTERNS = ('static.cloudflareinsights.com', 'cloudflareinsights.com/cdn-cgi/rum', 'cloudflareinsights', 'beacon.min.js', 'data-cf-beacon')
BEACON = re.compile(r'<script\b[^>]*cloudflareinsights[^>]*>', re.I)
OK_TAG = ('<script defer src="https://static.cloudflareinsights.com/beacon.min.js" '
          'data-cf-beacon=\'{"token": "%s"}\'>' % token)
# 0057: the site-wide meta CSP. Only its exact beacon string is allowed on listed pages.
CSP_TAG = None
csp_path = os.path.join(root, '_data/csp.yml')
if os.path.exists(csp_path):
    m = re.search(r'^beacon:\s*"([^"]+)"\s*$', open(csp_path, encoding='utf-8').read(), re.M)
    if m:
        CSP_TAG = '<meta http-equiv="Content-Security-Policy" content="%s">' % m.group(1)
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
        if CSP_TAG and listed:
            if html.count(CSP_TAG) != 1:
                errs.append('%s: listed page lacks exactly one site-wide beacon CSP meta' % url)
            html = html.replace(CSP_TAG, '', 1)
        tags = BEACON.findall(html)
        low = html.lower()
        mentions = low.count('cloudflareinsights')
        hits = [b for b in BEACON_PATTERNS if b in low]
        if listed:
            seen += 1
            if len(tags) != 1 or tags[0] != OK_TAG or mentions != 1:
                errs.append('%s: expected exactly one pinned beacon, found %d tag(s)' % (url, len(tags)))
            if re.search(r'http-equiv=["\']Content-Security-Policy', html, re.I):
                errs.append('%s: listed page has a meta CSP' % url)
            if re.search(r'http-equiv=["\']refresh', html, re.I):
                errs.append('%s: listed page is a redirect stub' % url)
        elif hits or tags:
            errs.append('%s: beacon present on a page that is not in the include list (%s)' % (url, ', '.join(hits) or 'script tag'))
missing = [p for p in pages if not os.path.exists(os.path.join(site, p.lstrip('/'), 'index.html'))]
for p in missing:
    errs.append('%s: listed but not built' % p)
for e in errs:
    print('cf-analytics: FAIL ' + e)
print('cf-analytics: %d listed page(s) with the pinned beacon; every other page has none' % seen if not errs else
      'cf-analytics: %d problem(s)' % len(errs))
sys.exit(1 if errs else 0)
