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
    if im.mode in ("RGBA", "LA", "P"):
        im = im.convert("RGB")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    im.save(path, "WEBP", quality=86, method=5)
    return "new"


def main():
    bid = build_id()
    print("buildId %s" % bid)

    queue = sorted(seed_slugs(bid))
    print("seed slugs: %d" % len(queue))

    visited, cache = set(), {}
    while queue:
        slug = queue.pop(0)
        if slug in visited:
            continue
        visited.add(slug)
        tpl = listing(bid, slug)
        if not tpl:
            continue
        cache[slug] = tpl
        for rel in ((tpl.get("attributes") or {}).get("related_templates") or []):
            rs = rel.get("slug") if isinstance(rel, dict) else rel
            if isinstance(rs, str) and rs not in visited:
                queue.append(rs)

    mine = {s: t for s, t in cache.items()
            if ((t.get("profile") or {}).get("slug") == CREATOR
                or (t.get("creator") or {}).get("slug") == CREATOR)}
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

    summary = ("listings_mine=%d new=%d already_present=%d failed=%d"
               % (len(mine), new, skipped, failed))
    print("\n" + summary)
    os.makedirs(".github", exist_ok=True)
    with open(RESULT, "w") as f:
        f.write(summary + "\n" + "\n".join(lines) + ("\n" if lines else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
