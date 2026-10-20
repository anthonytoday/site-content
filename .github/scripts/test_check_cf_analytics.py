#!/usr/bin/env python3
"""Tests for check-cf-analytics.py (0042, CFA-02/03). Run after jekyll build:
python3 .github/scripts/test_check_cf_analytics.py [_site] [repo_root]"""
import os, re, subprocess, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
GATE = os.path.join(HERE, 'check-cf-analytics.py')
SITE = sys.argv[1] if len(sys.argv) > 1 else '_site'
ROOT = sys.argv[2] if len(sys.argv) > 2 else '.'
CFG = open(os.path.join(ROOT, '_data/cf_analytics.yml'), encoding='utf-8').read()
TOKEN = re.search(r'^token:\s*"([0-9a-f]{32})"', CFG, re.M).group(1)
TAG = ('<script defer src="https://static.cloudflareinsights.com/beacon.min.js" '
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

ok_page = '<html><head>%s</head><body></body></html>' % TAG
site, root = fake(['/about/'], {'/about/': ok_page,
    '/r/': '<html><head>%s</head></html>' % TAG.replace('static.cloudflareinsights.com', 'static.CloudflareInsights.com')})
rc, out = run(site, root)
check('(a) mixed-case static.CloudflareInsights.com on unlisted /r/ fails', rc == 1 and '/r/: beacon present' in out, out)

for name, p in (('(b)', '/go-fix-report/'), ('(c)', '/privacy/')):
    rc, out = with_extra(p)
    check('%s listing %s fails' % (name, p), rc == 1 and ('never-allowed path in include list: %s' % p) in out, out)

site2, root2 = fake(['/about/'], {'/about/': ok_page, '/other/': '<html></html>'})
rc, out = run(site2, root2)
check('(e) clean fake site passes', rc == 0, out)

rc, out = run(SITE, ROOT)
check('(d) real list on the built _site passes', rc == 0, out)
print('test_check_cf_analytics: %s' % ('all tests passed' if not fails else '%d failed' % fails))
sys.exit(1 if fails else 0)
