#!/usr/bin/env python3
"""Site optimisation pass. Idempotent: safe to run on every push.

Four jobs, each reported with counts so the run log is auditable:

  1. meta      apply the description and title overrides in
               .github/data/meta_overrides.json, keyed by permalink
  1b. strayslash repair <img src="x"/ width="1"> tags left by an earlier
               dimension pass; this exact shape is what gate.py rejects
  2. imgdims   add width and height to <img> tags whose src is a local
               /assets/ file, so the browser reserves layout before decode
  3. images    downscale oversized gallery JPGs to MAX_W and re-encode them
               as WebP, rewrite every reference, then drop the JPG once
               nothing points at it. Covers and thumbnails are left as JPG
               because they are the og:image and not every social scraper
               renders WebP.
  4. css       delete hashed CSS bundles that no page references

Usage: python3 .github/scripts/optimise.py [--dry-run]
"""
import json
import os
import re
import sys

DRY = "--dry-run" in sys.argv
ROOT = os.getcwd()
MAX_W = 2000          # generous for a 2x lightbox, still a third of 3000px
WEBP_QUALITY = 82
SKIP_DIRS = {".git", "_site", "node_modules", ".github"}
TEXT_EXT = (".html", ".yml", ".yaml", ".json", ".md", ".txt", ".xml")
# never converted: these are og:image targets, and some social scrapers
# still refuse WebP
KEEP_JPG = re.compile(r"(^cover\.|-thumb\.|^thumb\.)", re.I)

log = []


def walk(root=".", exts=None):
    for dp, dn, fn in os.walk(root):
        dn[:] = [d for d in dn if d not in SKIP_DIRS]
        for n in fn:
            if exts is None or n.lower().endswith(exts):
                yield os.path.join(dp, n)


def read(p):
    with open(p, encoding="utf-8") as fh:
        return fh.read()


def write(p, t):
    if DRY:
        return
    with open(p, "w", encoding="utf-8") as fh:
        fh.write(t)


def front_matter(t):
    if not t.startswith("---"):
        return None, None, None
    end = t.find("\n---", 3)
    if end == -1:
        return None, None, None
    return t[:4], t[4:end], t[end:]


def get_key(fm, key):
    m = re.search(r"^%s:\s*(\S.*?)\s*$" % key, fm, re.M)
    return m.group(1).strip('"').strip("'") if m else None


# ---------------------------------------------------------------- 1. meta
def job_meta():
    path = ".github/data/meta_overrides.json"
    if not os.path.exists(path):
        log.append("meta: no override file, skipped")
        return
    ov = json.loads(read(path))
    desc, titles = ov.get("description", {}), ov.get("title", {})
    changed = 0
    for p in walk(".", (".html",)):
        rel = os.path.relpath(p, ROOT)
        if rel.split(os.sep)[0] in ("_layouts", "_includes", "_offline", "redirects"):
            continue
        t = read(p)
        head, fm, rest = front_matter(t)
        if fm is None:
            continue
        link = get_key(fm, "permalink")
        if not link:
            continue
        new = fm
        for key, table in (("description", desc), ("title", titles)):
            if link in table:
                val = table[link].replace('"', "'")
                if re.search(r"^%s:\s*.*$" % key, new, re.M):
                    new = re.sub(r"^%s:\s*.*$" % key, '%s: "%s"' % (key, val), new, count=1, flags=re.M)
                else:
                    new = new.rstrip() + '\n%s: "%s"' % (key, val)
        if new != fm:
            write(p, head + new + rest)
            changed += 1
    log.append("meta: rewrote front matter on %d pages" % changed)


# ---------------------------------------------------------- 1b. strayslash
STRAY = re.compile(r'((?:src|href|alt)="[^"\n]*")/(\s)')


def job_strayslash():
    """Repair <img src="x"/ width="1"> tags.

    A previous dimension pass appended width and height after the closing
    slash of a self closing tag, leaving the slash stranded in the middle.
    gate.py rejects exactly this shape, which is why the build gate has been
    failing. Idempotent: a clean tree reports zero.
    """
    files = fixed = 0
    for p in walk(".", (".html",)):
        if os.path.relpath(p, ROOT).split(os.sep)[0] in ("_site",):
            continue
        t = read(p)
        n = len(STRAY.findall(t))
        if not n:
            continue
        write(p, STRAY.sub(r"\1\2", t))
        files += 1; fixed += n
    log.append("strayslash: repaired %d malformed tags across %d pages" % (fixed, files))


# ------------------------------------------------------------- 2. imgdims
def job_imgdims():
    from PIL import Image
    tag_re = re.compile(r"<img\b[^>]*>")
    changed = fixed = 0
    for p in walk(".", (".html",)):
        rel = os.path.relpath(p, ROOT)
        if rel.split(os.sep)[0] in ("_offline", "redirects"):
            continue
        t = read(p)
        out, last, hits = [], 0, 0
        for m in tag_re.finditer(t):
            tag = m.group(0)
            if "width=" in tag and "height=" in tag:
                continue
            src = re.search(r'src="(/assets/[^"]+)"', tag)
            if not src:
                continue
            f = src.group(1).lstrip("/")
            if not os.path.exists(f):
                continue
            try:
                w, h = Image.open(f).size
            except Exception:
                continue
            new = tag[:-1].rstrip()
            if new.endswith("/"):          # self closing: drop the slash so it
                new = new[:-1].rstrip()    # cannot end up mid tag
            if "width=" not in new:
                new += ' width="%d"' % w
            if "height=" not in new:
                new += ' height="%d"' % h
            new += ">"
            out.append(t[last:m.start()]); out.append(new); last = m.end(); hits += 1
        if hits:
            out.append(t[last:])
            write(p, "".join(out))
            changed += 1; fixed += hits
    log.append("imgdims: added width/height to %d <img> tags across %d pages" % (fixed, changed))


# -------------------------------------------------------------- 3. images
def job_images():
    from PIL import Image
    targets = []
    for p in walk("assets", (".jpg", ".jpeg")):
        name = os.path.basename(p)
        if KEEP_JPG.search(name):
            continue
        targets.append(p)
    if not targets:
        log.append("images: nothing to convert")
        return

    saved_before = saved_after = 0
    made = []
    for p in targets:
        stem = p.rsplit(".", 1)[0]
        webp = stem + ".webp"
        before = os.path.getsize(p)
        if not os.path.exists(webp):
            try:
                im = Image.open(p).convert("RGB")
            except Exception:
                continue
            w, h = im.size
            if w > MAX_W:
                im = im.resize((MAX_W, round(h * MAX_W / w)), Image.LANCZOS)
            if not DRY:
                im.save(webp, "WEBP", quality=WEBP_QUALITY, method=6)
        if not os.path.exists(webp):
            continue
        after = os.path.getsize(webp) if not DRY else before
        if after >= before:
            # conversion did not pay off, keep the JPG and drop the WebP
            if not DRY and os.path.exists(webp):
                os.remove(webp)
            continue
        saved_before += before; saved_after += after
        made.append((p, webp))

    # rewrite every reference from the JPG to the WebP
    swap = {"/" + p.replace(os.sep, "/"): "/" + w.replace(os.sep, "/") for p, w in made}
    swap.update({p.replace(os.sep, "/"): w.replace(os.sep, "/") for p, w in made})
    rewritten = 0
    for f in walk(".", TEXT_EXT):
        rel = os.path.relpath(f, ROOT)
        if rel.startswith(".github"):
            continue
        t = read(f); o = t
        for a, b in swap.items():
            if a in t:
                t = t.replace(a, b)
        if t != o:
            write(f, t); rewritten += 1

    # delete a JPG only when nothing anywhere still points at it
    blob = ""
    for f in walk(".", TEXT_EXT):
        if os.path.relpath(f, ROOT).startswith(".github"):
            continue
        blob += read(f)
    removed = freed = 0
    for p, _ in made:
        ref = p.replace(os.sep, "/")
        if ref in blob or "/" + ref in blob:
            continue
        freed += os.path.getsize(p)
        if not DRY:
            os.remove(p)
        removed += 1
    log.append("images: %d converted (%.1f MB -> %.1f MB), %d files rewritten, %d JPGs removed (%.1f MB freed)" % (
        len(made), saved_before / 1048576, saved_after / 1048576, rewritten, removed, freed / 1048576))


# ----------------------------------------------------------------- 4. css
def job_css():
    used = set()
    for p in walk(".", (".html",)):
        t = read(p)
        used.update(re.findall(r"/assets/css/([A-Za-z0-9._-]+\.css)", t))
    removed = freed = 0
    for f in sorted(os.listdir("assets/css")):
        if f in used:
            continue
        freed += os.path.getsize(os.path.join("assets/css", f))
        if not DRY:
            os.remove(os.path.join("assets/css", f))
        removed += 1
    log.append("css: removed %d unreferenced bundles (%.1f KB)" % (removed, freed / 1024))


if __name__ == "__main__":
    job_meta()
    job_strayslash()
    job_imgdims()
    job_images()
    job_css()
    print("optimise%s" % (" (dry run)" if DRY else ""))
    for line in log:
        print("  " + line)
