#!/usr/bin/env python3
"""Rebuild the CSS bundle for the EN long-form offer page.

The site ships one hashed stylesheet per page type (assets/css/b-<hash>.css).
EN and FR previously shared a bundle; the v2 rewrite adds styles to EN only,
so EN gets its own bundle and FR keeps the existing one untouched.

Run from the repo root:  python3 _css/build_offer_bundle.py
"""
import re, hashlib, os, sys, yaml

PAGE  = 'services/investor-ready-sprint.html'
EXTRA = '_css/offer-long.css'

def mini(c):
    c = re.sub(r'/\*.*?\*/', '', c, flags=re.S)
    c = re.sub(r'\n\s*\n', '\n', c)
    c = re.sub(r'^[ \t]+', '', c, flags=re.M)
    c = re.sub(r'\s*([{}:;,>])\s*', r'\1', c)
    c = re.sub(r';}', '}', c)
    return c.strip()

src = open(PAGE, encoding='utf-8').read()
m   = re.match(r'^---\n(.*?)\n---\n(.*)$', src, re.S)
fm_text, body = m.group(1), m.group(2)
fm  = yaml.safe_load(fm_text)

base_href = fm['css_bundle']
base = open(base_href.lstrip('/'), encoding='utf-8').read()
extra = mini(open(EXTRA, encoding='utf-8').read())

# already-appended? strip the previous extra block so the script is idempotent
marker = '.osum{'
if marker in base:
    sys.exit('base bundle already contains offer styles; point css_bundle back at the shared '
             'FR bundle before re-running')

out  = base.rstrip('\n') + '\n' + extra
h    = hashlib.sha1(out.encode()).hexdigest()[:10]
path = 'assets/css/b-%s.css' % h
open(path, 'w', encoding='utf-8').write(out)

new_fm = re.sub(r'css_bundle:.*', 'css_bundle: /%s' % path, fm_text)
assert yaml.safe_load(new_fm)['css_bundle'] == '/' + path
open(PAGE, 'w', encoding='utf-8').write('---\n' + new_fm + '\n---\n' + body)

print('base   %s  %.1f KB' % (base_href, len(base)/1024))
print('extra  %s  %.1f KB minified' % (EXTRA, len(extra)/1024))
print('built  /%s  %.1f KB' % (path, len(out)/1024))
print('css_bundle rewritten on', PAGE)
