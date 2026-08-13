#!/usr/bin/env python3
"""
Extract gallery image URLs from Etsy listing pages and download them into
assets/etsy/<slug>/ folders. Idempotent: skips files that already exist.
Strategy per listing: plain HTTP first, then headless Chrome (real DOM),
then the reader proxy. Writes index.json per folder and a summary to
.github/etsy-extract-result.txt.
"""
import json
import os
import re
import subprocess
import time
import urllib.request

REPO = os.environ.get("GITHUB_WORKSPACE", os.getcwd())
CFG = os.path.join(REPO, "assets", "etsy", "listings.json")
RESULT = os.path.join(REPO, ".github", "etsy-extract-result.txt")

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}

IMG_RE = re.compile(r"https://i\.etsystatic\.com/[A-Za-z0-9_\-/\.]+?\.(?:jpg|jpeg|png|webp)", re.I)
SIZE_RE = re.compile(r"il_\d+x\d+\.")
KEEP = ("il_570xN", "il_794xN", "il_1588xN", "il_fullxfull", "il_300x300", "il_340x270")


def fetch_http(url, tries=2, timeout=30):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers=HEADERS)
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read()
        except Exception as e:
            print(f"  http attempt {i+1} failed: {e}")
            time.sleep(3)
    return None


def fetch_browser(url, timeout=90):
    """Render the page with headless Chrome and return the serialized DOM."""
    for binary in ("google-chrome", "google-chrome-stable", "chromium", "chromium-browser"):
        try:
            out = subprocess.run(
                [binary, "--headless=new", "--disable-gpu", "--no-sandbox",
                 "--disable-dev-shm-usage", "--virtual-time-budget=15000",
                 "--dump-dom", url],
                capture_output=True, timeout=timeout)
            if out.returncode == 0 and out.stdout:
                return out.stdout
        except FileNotFoundError:
            continue
        except Exception as e:
            print(f"  browser fetch failed ({binary}): {e}")
            return None
    return None


def fetch_reader(url):
    return fetch_http("https://r.jina.ai/" + url, tries=1, timeout=120)


def extract_image_urls(raw):
    html = raw.decode("utf-8", "ignore").replace("\\u002F", "/").replace("\\/", "/")
    best = {}
    for u in IMG_RE.findall(html):
        if not any(k in u for k in KEEP):
            continue
        full = SIZE_RE.sub("il_fullxfull.", u).split("?")[0]
        best[full.split("/")[-1]] = full
    return list(best.values())


def main():
    listings = json.load(open(CFG))
    lines = []
    total_new = 0
    for item in listings:
        slug, url = item["slug"], item["url"]
        folder = os.path.join(REPO, "assets", "etsy", slug)
        os.makedirs(folder, exist_ok=True)
        print(f"== {slug}", flush=True)
        data = fetch_http(url)
        if not data or b"etsystatic" not in data:
            print("  http blocked/empty, trying headless browser")
            data = fetch_browser(url)
        if not data or b"etsystatic" not in data:
            print("  browser blocked/empty, trying reader proxy")
            data = fetch_reader(url)
        urls = extract_image_urls(data) if data else []
        saved, present, pairs = 0, 0, []
        for u in urls:
            name = u.split("/")[-1]
            dest = os.path.join(folder, name)
            pairs.append({"file": name, "url": u})
            if os.path.exists(dest):
                present += 1
                continue
            content = fetch_http(u, tries=2, timeout=60)
            if content and len(content) > 1000:
                with open(dest, "wb") as f:
                    f.write(content)
                saved += 1
                time.sleep(0.3)
        with open(os.path.join(folder, "index.json"), "w") as f:
            json.dump({"slug": slug, "source": url, "images": pairs}, f, indent=2)
        line = f"{slug}: found={len(urls)} downloaded={saved} already_present={present}"
        print(line, flush=True)
        lines.append(line)
        total_new += saved
        time.sleep(1)
    with open(RESULT, "w") as f:
        f.write("\n".join(lines) + f"\ntotal_new={total_new}\n")


if __name__ == "__main__":
    main()
