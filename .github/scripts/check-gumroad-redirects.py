#!/usr/bin/env python3
"""Shop-to-Gumroad redirect gate (0043).

Fails when:
  - a destination in _data/gumroad_redirects.yml is not the store home or an exact
    https://store.anthonytoday.com/l/<permalink> URL (no query, no fragment);
  - a listed page is not built, or a built redirect page (html data-dest) is not listed;
  - data-dest, canonical, the noscript meta refresh and the visible link differ from the
    listed destination, or the refresh/link carries a query string;
  - the page's meta CSP is not exactly the one inline-script hash, or the inline script
    differs from _includes/gumroad-redirect.js;
  - any built page other than /shop/ loads gumroad.js, or /shop/ loads it other than as the one
    pinned tag (exact src, no crossorigin or integrity; gumroad.com sends no CORS header);
  - a /shop/ buy link is not an exact https://anthonytoday.gumroad.com/l/<permalink> (overlay,
    class gumroad-button) or https://store.anthonytoday.com/l/<permalink> (new tab) URL with the
    fixed ?utm_source=site&utm_medium=shop query, or a gumroad-button points anywhere else;
  - sitemap.xml lists any /shop/ URL other than /shop/ itself.
23 Oct 2026: /shop/ is a real on-site shop again (Anthony's call), so it left the redirect list.
Usage: check-gumroad-redirects.py _site [repo_root]
"""
import os, re, sys, html, base64, hashlib

site = sys.argv[1] if len(sys.argv) > 1 else '_site'
root = sys.argv[2] if len(sys.argv) > 2 else '.'
cfg = open(os.path.join(root, '_data/gumroad_redirects.yml'), encoding='utf-8').read()
STORE = re.search(r'^store:\s*"([^"]+)"', cfg, re.M).group(1)
pages = dict(re.findall(r'^\s+"(/[^"]*)":\s*"([^"]+)"\s*$', cfg, re.M))
js = open(os.path.join(root, '_includes/gumroad-redirect.js'), encoding='utf-8').read()
pin = 'sha256-' + base64.b64encode(hashlib.sha256(js.encode()).digest()).decode()
OK = re.compile(r'^https://store\.anthonytoday\.com/(l/[A-Za-z0-9_-]+)?$')
errs = []
if STORE != 'https://store.anthonytoday.com/':
    errs.append('store must be https://store.anthonytoday.com/')
for k, v in pages.items():
    if not OK.match(v):
        errs.append('%s: destination not allowed: %s' % (k, v))
SHOP = '/shop/'
GR_TAG = '<script src="https://gumroad.com/js/gumroad.js" defer></script>'
BUY_OVERLAY = re.compile(r'^https://anthonytoday\.gumroad\.com/l/[A-Za-z0-9_-]+\?utm_source=site&utm_medium=shop$')
BUY_TAB = re.compile(r'^https://store\.anthonytoday\.com/l/[A-Za-z0-9_-]+\?utm_source=site&utm_medium=shop$')
shop_html = None
built = {}
for dp, dn, fn in os.walk(site):
    for f in fn:
        if not f.endswith('.html'):
            continue
        p = os.path.join(dp, f)
        rel = '/' + os.path.relpath(p, site).replace(os.sep, '/')
        url = rel[:-len('index.html')] if rel.endswith('index.html') else rel
        s = open(p, encoding='utf-8', errors='replace').read()
        if re.search(r'gumroad\.com/js/gumroad\.js', s):
            if url != SHOP:
                errs.append('%s: loads gumroad.js' % url)
            else:
                shop_html = s
        m = re.search(r'<html[^>]*\bdata-dest="([^"]*)"', s)
        if m:
            built[url] = (html.unescape(m.group(1)), s)
for url in pages:
    if url not in built:
        errs.append('%s: listed but no redirect page built' % url)
for url, (dest, s) in sorted(built.items()):
    want = pages.get(url)
    if want is None:
        errs.append('%s: redirect page not in the allowlist' % url); continue
    if dest != want:
        errs.append('%s: data-dest %s != %s' % (url, dest, want))
    can = re.search(r'<link rel="canonical" href="([^"]*)"', s)
    ref = re.findall(r'<meta http-equiv="refresh" content="0; url=([^"]*)"', s)
    links = re.findall(r'<a href="([^"]*)"', s)
    if not can or html.unescape(can.group(1)) != want:
        errs.append('%s: canonical mismatch' % url)
    if len(ref) != 1 or html.unescape(ref[0]) != want or '<noscript><meta http-equiv="refresh"' not in s:
        errs.append('%s: noscript meta refresh must be exactly the fixed URL' % url)
    if [html.unescape(x) for x in links] != [want]:
        errs.append('%s: visible link must be exactly the fixed URL' % url)
    csp = re.search(r'<meta http-equiv="Content-Security-Policy" content="([^"]*)"', s)
    if not csp or html.unescape(csp.group(1)) != "default-src 'none'; script-src '%s'; base-uri 'none'; form-action 'none'" % pin:
        errs.append('%s: CSP is not exactly the one pinned script hash' % url)
    scripts = re.findall(r'<script\b[^>]*>(.*?)</script>', s, re.S)
    if scripts != [js]:
        errs.append('%s: inline script differs from _includes/gumroad-redirect.js' % url)
shop_buys = 0
if shop_html is not None:
    tags = re.findall(r'<script\b[^>]*gumroad\.com/js/gumroad\.js[^>]*>', shop_html)
    if tags != [GR_TAG[:-len('</script>')]] or GR_TAG not in shop_html:
        errs.append('/shop/: gumroad.js must be exactly one %s' % GR_TAG)
    # Collect every <script src>, double-, single- or un-quoted. The only external scripts
    # allowed are gumroad.js and the Cloudflare Web Analytics beacon (check-cf-analytics.py
    # pins its token and include list).
    SCRIPT_OK = {'https://gumroad.com/js/gumroad.js', 'https://static.cloudflareinsights.com/beacon.min.js'}
    for stag in re.findall(r'<script\b[^>]*>', shop_html, re.I):
        for m in re.finditer(r'\bsrc\s*=\s*(?:"([^"]*)"|\'([^\']*)\'|([^\s>]+))', stag, re.I):
            src = html.unescape(m.group(1) if m.group(1) is not None else m.group(2) if m.group(2) is not None else m.group(3)).strip()
            if src not in SCRIPT_OK:
                errs.append('/shop/: script src not allowed: %s' % src)
    for tag in re.findall(r'<a\b[^>]*>', shop_html):
        cls = re.search(r'\bclass="([^"]*)"', tag)
        cls = cls.group(1).split() if cls else []
        href = re.search(r'\bhref="([^"]*)"', tag)
        href = html.unescape(href.group(1)) if href else ''
        if 'gumroad-button' in cls:
            shop_buys += 1
            if not BUY_OVERLAY.match(href):
                errs.append('/shop/: overlay buy link not allowed: %s' % href)
        elif 'sh-buy' in cls:
            shop_buys += 1
            if not BUY_TAB.match(href) or 'target="_blank"' not in tag or 'rel="noopener"' not in tag:
                errs.append('/shop/: new-tab buy link not allowed: %s' % href)
    if shop_buys == 0:
        errs.append('/shop/: no buy links found')
sm = os.path.join(site, 'sitemap.xml')
if os.path.exists(sm):
    for loc in re.findall(r'<loc>([^<]*/shop/[^<]*)</loc>', open(sm, encoding='utf-8').read()):
        if not loc.endswith('.com/shop/'):
            errs.append('sitemap.xml lists %s' % loc)
for e in errs:
    print('gumroad-redirects: FAIL ' + e)
print('gumroad-redirects: %d redirect page(s) match the allowlist; gumroad.js only on /shop/ (%d pinned buy links); sitemap has no /shop/ subpages' % (len(built), shop_buys) if not errs else 'gumroad-redirects: %d problem(s)' % len(errs))
sys.exit(1 if errs else 0)
