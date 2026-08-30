#!/usr/bin/env python3
"""Capture Notion Marketplace listing galleries into assets/templates/<slug>/.

Notion's marketplace is a Next.js app: the card grid is client-rendered, so the
HTML is useless. The data that feeds it is served at
    /_next/data/<buildId>/en-us/@<creator>.json          (creator profile)
    /_next/data/<buildId>/en-us/templates/<slug>.json    (one listing)
buildId is read out of the profile HTML. That is the whole trick.

Each listing carries attributes.screenshots (desktop) and
attributes.mobile_screenshots (mobile), plus attributes.image /
attributes.mobile_image for the lead shot. They are written as

    assets/templates/<slug>/<slug>-g1-desktop.webp
    assets/templates/<slug>/<slug>-g1-mobile.webp

matching the 42 folders already captured. Existing files are never overwritten,
so the job is idempotent and a partial run heals itself on the next schedule.

Slugs are discovered by seeding from the profile and every folder already in
the repo, then crawling attributes.related_templates until nothing new appears.
"""
import io, json, os, re, sys, time, urllib.request

CREATOR = "anthonytoday"
ROOT = "assets/templates"
RESULT = ".github/marketplace-gallery-result.txt"
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0 Safari/537.36")

try:
    from PIL import Image
except ImportError:
    print("Pillow missing"); sys.exit(1)


def get(url, binary=False, tries=3):
    for n in range(tries):
        try:
            req = urllib.request.Request(url, headers={
                "User-Agent": UA,
                "Accept": "*/*" if binary else "application/json,text/html",
            })
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.read() if binary else r.read().decode("utf-8", "replace")
        except Exception as e:
            if n == tries - 1:
                raise
            time.sleep(2 * (n + 1))


def build_id():
    html = get("https://www.notion.com/@%s" % CREATOR)
    m = re.search(r'"buildId":"([^"]+)"', html)
    if not m:
        raise SystemExit("buildId not found in profile HTML")
    return m.group(1)


def listing(bid, slug):
    url = "https://www.notion.com/_next/data/%s/en-us/templates/%s.json" % (bid, slug)
    try:
        return json.loads(get(url)).get("pageProps", {}).get("template") or None
    except Exception:
        return None


def seed_slugs(bid):
    found = set()
    try:
        prof = json.loads(get(
            "https://www.notion.com/_next/data/%s/en-us/@%s.json" % (bid, CREATOR)
        )).get("pageProps", {})
        for key in ("pinnedTemplates", "nonPinnedTemplates"):
            for t in prof.get(key) or []:
                if t.get("slug"):
                    found.add(t["slug"])
    except Exception as e:
        print("profile fetch failed: %s" % e)
    if os.path.isdir(ROOT):
        found.update(d for d in os.listdir(ROOT) if os.path.isdir(os.path.join(ROOT, d)))

    # The repo already records marketplace URLs across pages and data files.
    # related_templates only returns UUIDs, so this is the reliable way to
    # reach listings the profile JSON hides behind its "Load more" pagination.
    pat = re.compile(r"notion\.com/templates/([a-z0-9][a-z0-9\-]{3,80})")
    for dirpath, dirnames, files in os.walk("."):
        dirnames[:] = [d for d in dirnames if d not in (".git", "_site", "node_modules", "assets")]
        for name in files:
            if not name.endswith((".html", ".json", ".yml", ".yaml", ".md")):
                continue
            try:
                with open(os.path.join(dirpath, name), encoding="utf-8", errors="ignore") as fh:
                    found.update(pat.findall(fh.read()))
            except Exception:
                pass
    return found


def shots(tpl):
    """Return aligned (desktop, mobile) pairs, lead image first."""
    a = tpl.get("attributes") or {}
    d = [x for x in ([a.get("image")] + list(a.get("screenshots") or [])) if x]
    m = [x for x in ([a.get("mobile_image")] + list(a.get("mobile_screenshots") or [])) if x]
    d = [x.get("url") if isinstance(x, dict) else x for x in d]
    m = [x.get("url") if isinstance(x, dict) else x for x in m]
    d = [x for x in d if isinstance(x, str) and x.startswith("http")]
    m = [x for x in m if isinstance(x, str) and x.startswith("http")]
    seen, dd = set(), []
    for x in d:
        if x not in seen:
            seen.add(x); dd.append(x)
    seen, mm = set(), []
    for x in m:
        if x not in seen:
            seen.add(x); mm.append(x)
    return dd, mm


def save_webp(url, path):
    if os.path.exists(path) and os.path.getsize(path) > 0:
        return "skip"
    raw = get(url, binary=True)
    if len(raw) < 500:
        raise ValueError("response too small: %d bytes" % len(raw))
    im = Image.open(io.BytesIO(raw))
    im.load()
    if im.mode in ("RGBA", "LA", "P"):
        im = im.convert("RGB")

    # Notion occasionally serves a blank white frame for a screenshot that did
    # not render. It is a valid image, so nothing downstream catches it: the
    # first run wrote one and still reported failed=0. Reject anything with no
    # tonal variation rather than commit a white rectangle.
    try:
        from PIL import ImageStat
        if max(ImageStat.Stat(im.convert("RGB")).stddev) < 2.0:
            raise ValueError("blank image: no tonal variation")
    except ImportError:
        pass

    os.makedirs(os.path.dirname(path), exist_ok=True)
    im.save(path, "WEBP", quality=86, method=5)
    return "new"


def main():
    bid = build_id()
    print("buildId %s" % bid)

    queue = sorted(seed_slugs(bid))
    print("seed slugs: %d" % len(queue))

    visited, cache = set(), {}
    for slug in queue:
        if slug in visited:
            continue
        visited.add(slug)
        tpl = listing(bid, slug)
        if tpl:
            cache[slug] = tpl

    mine = {s: t for s, t in cache.items()
            if (t.get("profile") or {}).get("username") == CREATOR}
    print("reachable listings: %d, mine: %d" % (len(cache), len(mine)))

    new = skipped = failed = 0
    lines = []
    for slug in sorted(mine):
        d, m = shots(mine[slug])
        if not d:
            lines.append("NO IMAGES %s" % slug)
            continue
        for i in range(max(len(d), len(m))):
            for kind, arr in (("desktop", d), ("mobile", m)):
                if i >= len(arr):
                    continue
                path = os.path.join(ROOT, slug, "%s-g%d-%s.webp" % (slug, i + 1, kind))
                try:
                    r = save_webp(arr[i], path)
                    if r == "new":
                        new += 1; print("new  %s" % path)
                    else:
                        skipped += 1
                except Exception as e:
                    failed += 1
                    lines.append("FAILED %s <- %s : %s" % (path, arr[i], e))
                    print(lines[-1])
                    if os.path.exists(path) and os.path.getsize(path) == 0:
                        os.remove(path)

    # Gumroad's thumbnail endpoint accepts a URL but rejects anything that is
    # not square, and every marketplace shot is 1920x1199 or 600x1200. Build a
    # 600x600 JPEG per listing, the lead desktop shot scaled to fit on white,
    # so the storefront card and the dashboard list stop showing a broken
    # image placeholder. JPEG because Gumroad rejects WebP.
    thumbs = 0
    for slug in sorted(mine):
        d, _ = shots(mine[slug])
        if not d:
            continue
        path = os.path.join(ROOT, slug, "%s-thumb.jpg" % slug)
        if os.path.exists(path) and os.path.getsize(path) > 0:
            continue
        try:
            raw = get(d[0], binary=True)
            im = Image.open(io.BytesIO(raw))
            im.load()
            im = im.convert("RGB")
            im.thumbnail((600, 600), Image.LANCZOS)
            canvas = Image.new("RGB", (600, 600), (255, 255, 255))
            canvas.paste(im, ((600 - im.width) // 2, (600 - im.height) // 2))
            os.makedirs(os.path.dirname(path), exist_ok=True)
            canvas.save(path, "JPEG", quality=88, optimize=True)
            thumbs += 1
            print("thumb %s" % path)
        except Exception as e:
            lines.append("THUMB FAILED %s : %s" % (slug, e))
            print(lines[-1])

    # The counts alone are byte-identical on any run that finds nothing, so the
    # file produced no diff, the commit step said "nothing new to commit", and a
    # job that had stopped running looked exactly like a job that found nothing.
    # Stamping the run time guarantees a diff, so the last successful run is
    # always visible in the commit history.
    summary = ("run_utc=%s listings_mine=%d new=%d already_present=%d failed=%d thumbs=%d"
               % (time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                  len(mine), new, skipped, failed, thumbs))
    print("\n" + summary)
    os.makedirs(".github", exist_ok=True)
    with open(RESULT, "w") as f:
        f.write(summary + "\n" + "\n".join(lines) + ("\n" if lines else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
