#!/usr/bin/env python3
"""Tests for check-cf-analytics.py (0060). Run after jekyll build:
python3 .github/scripts/test_check_cf_analytics.py [_site] [repo_root]

New behavior (0060): Cloudflare auto-installs beacon at the edge. Built _site
must contain ZERO manual beacon tags. Listed pages in cf_analytics.yml get
CSP meta tag from _data/csp.yml beacon key; /shop/ gets shop key.
"""
import os, re, subprocess, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
GATE = os.path.join(HERE, 'check-cf-analytics.py')
SITE = sys.argv[1] if len(sys.argv) > 1 else '_site'
ROOT = sys.argv[2] if len(sys.argv) > 2 else '.'
CFG = open(os.path.join(ROOT, '_data/cf_analytics.yml'), encoding='utf-8').read()
TOKEN = re.search(r'^token:\s*"([0-9a-f]{32})"', CFG, re.M).group(1)
# Old manual beacon tag (must NOT appear in built pages)
OLD_TAG = ('<script defer src="https://static.cloudflareinsights.com/beacon.min.js" '
       'data-cf-beacon=\'{"token": "%s"}\'></script>' % TOKEN)

def run(site, root):
    r = subprocess.run([sys.executable, GATE, site, root], capture_output=True, text=True)
    return r.returncode, r.stdout + r.stderr

def write(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    open(path, 'w', encoding='utf-8').write(text)

def fake(pages, files):
    d = tempfile.mkdtemp()
    write(os.path.join(d, 'root/_data/cf_analytics.yml'),
          'token: "%s"\npages:\n%s' % (TOKEN, ''.join('  - "%s"\n' % p for p in pages)))
    for rel, html in files.items():
        write(os.path.join(d, 'site', rel.lstrip('/'), 'index.html'), html)
    return os.path.join(d, 'site'), os.path.join(d, 'root')

def with_extra(path):
    site, root = fake([], {})
    cfg = CFG.replace('\npages:\n', '\npages:\n  - "%s"\n' % path, 1)
    write(os.path.join(root, '_data/cf_analytics.yml'), cfg)
    return run(SITE, root)

fails = 0
def check(name, ok, out):
    global fails
    print('%s %s' % ('PASS' if ok else 'FAIL', name))
    if not ok:
        fails += 1; print(out)

# (a) Manual beacon on ANY page (listed or not) must fail
site, root = fake(['/about/'], {'/about/': '<html><head>%s</head><body></body></html>' % OLD_TAG})
rc, out = run(site, root)
check('(a) manual beacon on listed page fails', rc == 1 and '/about/: manual beacon present' in out, out)

# (b) Manual beacon on unlisted page must fail
site, root = fake(['/about/'], {'/other/': '<html><head>%s</head><body></body></html>' % OLD_TAG})
rc, out = run(site, root)
check('(b) manual beacon on unlisted page fails', rc == 1 and '/other/: manual beacon present' in out, out)

# (c) Never-allowed paths in include list still fail
for name, p in (('(c)', '/go-fix-report/'), ('(d)', '/privacy/')):
    rc, out = with_extra(p)
    check('%s listing %s fails' % (name, p), rc == 1 and ('never-allowed path in include list: %s' % p) in out, out)

# (e) Clean site (no manual beacons, correct CSP meta) passes
# Need a page with the correct beacon CSP meta tag
csp_yml = open(os.path.join(ROOT, '_data/csp.yml'), encoding='utf-8').read()
m = re.search(r'^beacon:\s*"([^"]+)"\s*$', csp_yml, re.M)
BEACON_CSP = '<meta http-equiv="Content-Security-Policy" content="%s">' % m.group(1) if m else ''
if BEACON_CSP:
    site, root = fake(['/about/'], {'/about/': '<html><head>%s</head><body></body></html>' % BEACON_CSP})
    rc, out = run(site, root)
    check('(e) clean fake site with beacon CSP meta passes', rc == 0, out)

# (f) Real built _site must have zero manual beacons and correct CSP meta on listed pages
rc, out = run(SITE, ROOT)
check('(f) real built _site passes', rc == 0, out)

print('test_check_cf_analytics: %s' % ('all tests passed' if not fails else '%d failed' % fails))
sys.exit(1 if fails else 0)