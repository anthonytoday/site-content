#!/usr/bin/env python3
"""
Extract gallery image URLs from Etsy listing pages and download them into
assets/etsy/<slug>/ folders. Idempotent: skips listings whose folder already
has 5+ image files, and skips individual files that exist.

Per listing, tries an ordered set of fetch strategies (direct HTTP, Google
Translate proxy, CORS proxies, headless Chrome, reader proxy). The first
strategy that returns page content containing etsystatic image URLs is moved
to the front of the list, so later listings reuse what works. Aborts early
after 3 consecutive listings with zero images found (uniform IP-level block).

Writes index.json per folder and appends progress to
.github/etsy-extract-result.txt after EVERY listing.
"""
import json
import os
import re
import subprocess
import time
import urllib.parse
import urllib.request

REPO = os.environ.get("GITHUB_WORKSPACE", os.getcwd())
CFG = os.path.join(REPO, "assets", "etsy", "listings.json")
RESULT = os.path.join(REPO, ".github", "etsy-extract-result.txt")

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}

IMG_RE = re.compile(
    r"https://(?:i\.etsystatic\.com|i-etsystatic-com\.translate\.goog)/[A-Za-z0-9_\-/\.]+?\.(?:jpg|jpeg|png|webp)",
    re.I,
)
SIZE_RE = re.compile(r"il_\d+x\d+\.")
KEEP = ("il_570xN", "il_794xN", "il_1588xN", "il_fullxfull", "il_300x300", "il_340x270")


def fetch_http(url, tries=1, timeout=20):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers=HEADERS)
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read()
        except Exception as e:
            print(f"    http failed: {type(e).__name__}", flush=True)
    return None


def fetch_direct(url):
    return fetch_http(url)


def fetch_translate(url):
    p = urllib.parse.urlsplit(url)
    host = p.netloc.replace("www.", "").replace(".", "-")
    t = f"https://{host}.translate.goog{p.path}?_x_tr_sl=auto&_x_tr_tl=en&_x_tr_hl=en"
    return fetch_http(t, timeout=30)


def fetch_codetabs(url):
    return fetch_http("https://api.codetabs.com/v1/proxy?quest=" + urllib.parse.quote(url, safe=""), timeout=30)


def fetch_corsproxy(url):
    return fetch_http("https://corsproxy.io/?url=" + urllib.parse.quote(url, safe=""), timeout=30)


def fetch_allorigins(url):
    return fetch_http("https://api.allorigins.win/raw?url=" + urllib.parse.quote(url, safe=""), timeout=30)


def fetch_browser(url, timeout=60):
    for binary in ("google-chrome", "google-chrome-stable", "chromium", "chromium-browser"):
        try:
            out = subprocess.run(
                [binary, "--headless=new", "--disable-gpu", "--no-sandbox",
                 "--disable-dev-shm-usage", "--virtual-time-budget=12000",
                 "--dump-dom", url],
                capture_output=True, timeout=timeout)
            if out.returncode == 0 and out.stdout:
                return out.stdout
        except FileNotFoundError:
            continue
        except Exception as e:
            print(f"    browser failed ({binary}): {e}", flush=True)
            return None
    return None


def fetch_reader(url):
    return fetch_http("https://r.jina.ai/" + url, timeout=90)


STRATEGIES = [
    ("direct", fetch_direct),
    ("translate", fetch_translate),
    ("codetabs", fetch_codetabs),
    ("corsproxy", fetch_corsproxy),
    ("allorigins", fetch_allorigins),
    ("chrome", fetch_browser),
    ("reader", fetch_reader),
]


def extract_image_urls(raw):
    html = raw.decode("utf-8", "ignore").replace("\\u002F", "/").replace("\\/", "/")
    best = {}
    for u in IMG_RE.findall(html):
        if not any(k in u for k in KEEP):
            continue
        u = u.replace("https://i-etsystatic-com.translate.goog", "https://i.etsystatic.com")
        full = SIZE_RE.sub("il_fullxfull.", u).split("?")[0]
        best[full.split("/")[-1]] = full
    return list(best.values())


def main():
    listings = json.load(open(CFG))
    with open(RESULT, "w") as f:
        f.write(f"started={time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}\n")
    total_new = 0
    zero_streak = 0
    order = list(STRATEGIES)
    for item in listings:
        slug, url = item["slug"], item["url"]
        folder = os.path.join(REPO, "assets", "etsy", slug)
        os.makedirs(folder, exist_ok=True)
        existing = [f for f in os.listdir(folder) if f.lower().endswith((".jpg", ".jpeg", ".png", ".webp"))]
        if len(existing) >= 5:
            line = f"{slug}: already_complete files={len(existing)}"
            print(line, flush=True)
            with open(RESULT, "a") as f:
                f.write(line + "\n")
            continue
        print(f"== {slug}", flush=True)
        data, used = None, None
        for name, fn in order:
            print(f"  trying {name}", flush=True)
            data = fn(url)
            if data and b"etsystatic" in data:
                used = name
                break
            data = None
        if used and order[0][0] != used:
            order = [s for s in order if s[0] != used]
            order.insert(0, (used, dict(STRATEGIES)[used]))
        urls = extract_image_urls(data) if data else []
        saved, present, pairs = 0, 0, []
        for u in urls:
            name = u.split("/")[-1]
            dest = os.path.join(folder, name)
            pairs.append({"file": name, "url": u})
            if os.path.exists(dest):
                present += 1
                continue
            content = fetch_http(u, tries=2, timeout=45)
            if content and len(content) > 1000:
                with open(dest, "wb") as f:
                    f.write(content)
                saved += 1
                time.sleep(0.3)
        with open(os.path.join(folder, "index.json"), "w") as f:
            json.dump({"slug": slug, "source": url, "via": used, "images": pairs}, f, indent=2)
        line = f"{slug}: via={used} found={len(urls)} downloaded={saved} already_present={present}"
        print(line, flush=True)
        with open(RESULT, "a") as f:
            f.write(line + "\n")
        total_new += saved
        zero_streak = zero_streak + 1 if not urls else 0
        if zero_streak >= 3:
            stop = "aborting: all fetch strategies blocked on 3 consecutive listings"
            print(stop, flush=True)
            with open(RESULT, "a") as f:
                f.write(stop + "\n")
            break
        time.sleep(1)
    with open(RESULT, "a") as f:
        f.write(f"total_new={total_new}\n")


if __name__ == "__main__":
    main()
