#!/usr/bin/env python3
"""Build the shared core bundle for the 2026-09-17 restructure.

Input:  assets/css/b-3788e0251b.css (the former home bundle; the header, nav,
        reset and mobile rules are extracted from it by selector)
        _css/core.css (page styles for home, cyber, notion, contact, EN and FR)
Output: assets/css/b-<sha1[:10]>.css, and every page listed in PAGES gets its
        css_bundle front-matter key rewritten to the new path. Delete the
        previous core bundle by hand after a rebuild.

Run from the repo root:  python3 _css/build_core_bundle.py
"""
import re, hashlib, os

BASE_SRC = 'assets/css/b-3788e0251b.css'
CORE = '_css/core.css'
PAGES = [
    'home.html', 'services/cyber.html', 'services/notion.html', 'pages/contact.html',
    'fr/home.html', 'fr/services/cyber.html', 'fr/services/notion.html', 'fr/pages/contact.html',
]
KEEP = re.compile(r'^(\*\{|html\{|:root|body\{|\.site-header|\.nav-item|\.sub|\.lang-switch|\.nav-toggle'
                  r'|@media\(max-width:900px\)\{\.nav-toggle|@media\(max-width:768px\)\{html,body)')

def rules(css):
    out, depth, start = [], 0, 0
    for j, ch in enumerate(css):
        if ch == '{':
            depth += 1
        elif ch == '}':
            depth -= 1
            if depth == 0:
                out.append(css[start:j + 1]); start = j + 1
    return out

def mini(c):
    c = re.sub(r'/\*.*?\*/', '', c, flags=re.S)
    c = re.sub(r'\n\s*\n', '\n', c)
    c = re.sub(r'^[ \t]+', '', c, flags=re.M)
    c = re.sub(r'\s*([{}:;,>])\s*', r'\1', c)
    c = re.sub(r';}', '}', c)
    return c.strip()

base = ''.join(r for r in rules(open(BASE_SRC, encoding='utf-8').read()) if KEEP.match(r))
out = base + '\n' + mini(open(CORE, encoding='utf-8').read())
h = hashlib.sha1(out.encode()).hexdigest()[:10]
path = 'assets/css/b-%s.css' % h
open(path, 'w', encoding='utf-8').write(out)
print('built /%s  %.1f KB' % (path, len(out) / 1024))

for page in PAGES:
    if not os.path.exists(page):
        print('skip (missing)', page); continue
    src = open(page, encoding='utf-8').read()
    new = re.sub(r'^css_bundle:.*$', 'css_bundle: /' + path, src, count=1, flags=re.M)
    if new != src:
        open(page, 'w', encoding='utf-8').write(new)
        print('css_bundle ->', page)
