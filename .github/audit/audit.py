#!/usr/bin/env python3
"""External security, speed and function audit of the three sites.

Writes everything under results/ and prints nothing sensitive to the log.
"""
import json, os, re, statistics, subprocess, sys, time, urllib.request, xml.etree.ElementTree as ET
from urllib.parse import urlparse

OUT = sys.argv[1] if len(sys.argv) > 1 else "results"
LH_RUNS = int(os.environ.get("LH_RUNS", "3"))
os.makedirs(OUT, exist_ok=True)
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36 site-audit"

SITES = {
    "anthonytoday": {
        "origin": "https://www.anthonytoday.com",
        "apex": "anthonytoday.com",
        "lh": ["/", "/notion/", "/flashcards/", "/start/"],
        "extra_hosts": ["check.anthonytoday.com", "store.anthonytoday.com", "links.anthonytoday.com"],
    },
    "moneywithai": {
        "origin": "https://moneywithai.net",
        "apex": "moneywithai.net",
        "lh": ["/", "/bots/", "/bots/account-health/", "/use-cases/"],
        "extra_hosts": ["mirror.moneywithai.net"],
    },
    "inmycal": {
        "origin": "https://inmycal.com",
        "apex": "inmycal.com",
        "lh": ["/", "/football/", "/f1/", "/ufc/"],
        "extra_hosts": ["mirror.inmycal.com"],
    },
}
# Files that must not be served (expected 404) plus the public plumbing files (expected 200).
PROBES = ["/.git/HEAD", "/.env", "/package.json", "/wrangler.jsonc", "/_config.yml", "/README.md",
          "/.well-known/security.txt", "/robots.txt", "/sitemap.xml", "/llms.txt", "/this-page-does-not-exist-xyz/"]
SEC_HEADERS = ["strict-transport-security", "content-security-policy", "content-security-policy-report-only",
               "x-content-type-options", "x-frame-options", "referrer-policy", "permissions-policy",
               "cross-origin-opener-policy", "cross-origin-resource-policy", "cross-origin-embedder-policy",
               "x-robots-tag", "server", "x-powered-by", "via", "x-github-request-id", "set-cookie",
               "cache-control", "cf-cache-status", "age", "content-encoding", "alt-svc", "link", "vary",
               "access-control-allow-origin", "report-to", "nel", "x-xss-protection", "content-type"]


def sh(cmd, timeout=120):
    try:
        return subprocess.run(cmd, shell=isinstance(cmd, str), capture_output=True, text=True, timeout=timeout).stdout
    except Exception as e:
        return f"ERR {e}"


def curl_head(url, extra=""):
    """GET (not HEAD) and return status, final url and headers of the last response."""
    raw = sh(f"curl -sS -o /dev/null -D - --compressed -A '{UA}' -H 'Accept-Encoding: br, gzip' --max-time 25 {extra} '{url}'", 40)
    blocks = [b for b in re.split(r"\r?\n\r?\n", raw.strip()) if b.strip()]
    last = blocks[-1] if blocks else ""
    lines = last.splitlines()
    status = lines[0] if lines else "NO RESPONSE"
    headers = {}
    for ln in lines[1:]:
        if ":" in ln:
            k, v = ln.split(":", 1)
            k = k.strip().lower()
            headers[k] = (headers[k] + " || " + v.strip()) if k in headers else v.strip()
    return status, headers


def timing(url, n=5):
    fmt = "%{http_code} %{time_namelookup} %{time_connect} %{time_appconnect} %{time_starttransfer} %{time_total} %{size_download} %{http_version}"
    rows = []
    for _ in range(n):
        out = sh(f"curl -sS -o /dev/null -w '{fmt}' -A '{UA}' -H 'Accept-Encoding: br, gzip' --max-time 25 '{url}'", 40).split()
        if len(out) == 8:
            rows.append(out)
        time.sleep(0.4)
    if not rows:
        return {"error": "no timing"}
    med = lambda i: round(statistics.median(float(r[i]) for r in rows) * 1000)
    return {"code": rows[-1][0], "dns_ms": med(1), "connect_ms": med(2), "tls_ms": med(3), "ttfb_ms": med(4),
            "total_ms": med(5), "bytes_br": int(rows[-1][6]), "http": rows[-1][7], "runs": len(rows)}


def sitemap_urls(origin, cap=2000):
    seen, todo, urls = set(), [origin + "/sitemap.xml"], []
    while todo and len(urls) < cap:
        sm = todo.pop(0)
        if sm in seen:
            continue
        seen.add(sm)
        try:
            req = urllib.request.Request(sm, headers={"User-Agent": UA})
            data = urllib.request.urlopen(req, timeout=30).read()
            root = ET.fromstring(data)
        except Exception:
            continue
        ns = "{http://www.sitemaps.org/schemas/sitemap/0.9}"
        for s in root.findall(f"{ns}sitemap/{ns}loc"):
            todo.append(s.text.strip())
        for u in root.findall(f"{ns}url/{ns}loc"):
            urls.append(u.text.strip())
    return urls


def crawl(urls):
    bad, codes = [], {}
    for u in urls:
        out = sh(f"curl -sS -o /dev/null -w '%{{http_code}}' -A '{UA}' --max-time 25 '{u}'", 40).strip()
        codes[out] = codes.get(out, 0) + 1
        if out != "200":
            bad.append([u, out])
        time.sleep(0.12)
    return {"total": len(urls), "codes": codes, "non_200": bad[:60]}


def third_party(origin, path):
    html = sh(f"curl -sS --compressed -A '{UA}' --max-time 25 '{origin}{path}'", 40)
    hosts = {}
    for tag, attr in re.findall(r"<(script|link|img|iframe|source)[^>]*?\s(?:src|href)=\"(https?://[^\"]+)\"", html, re.I):
        h = urlparse(attr).netloc
        if h and h not in origin:
            hosts.setdefault(tag.lower(), set()).add(h)
    inline_scripts = len(re.findall(r"<script(?![^>]*\ssrc=)[^>]*>", html, re.I))
    ext_scripts = re.findall(r"<script[^>]*\ssrc=\"(https?://[^\"]+)\"[^>]*>", html, re.I)
    no_sri = [s for s in ext_scripts if "integrity=" not in s]
    return {"hosts": {k: sorted(v) for k, v in hosts.items()}, "inline_scripts": inline_scripts,
            "html_bytes_uncompressed": len(html.encode()), "ext_scripts": len(ext_scripts),
            "preload_links": len(re.findall(r"rel=\"preload\"", html)), "img_without_lazy": len(re.findall(r"<img(?![^>]*loading=)[^>]*>", html, re.I))}


def tls(host):
    res = {}
    for v in ["tls1", "tls1_1", "tls1_2", "tls1_3"]:
        out = sh(f"echo | timeout 12 openssl s_client -connect {host}:443 -servername {host} -{v} -cipher 'DEFAULT@SECLEVEL=0' 2>&1", 20)
        res[v] = "accepted" if re.search(r"Protocol\s*:\s*TLS|New, TLS", out) and "Cipher is (NONE)" not in out and "alert" not in out.lower() else "refused"
    cert = sh(f"echo | openssl s_client -connect {host}:443 -servername {host} 2>/dev/null | openssl x509 -noout -issuer -enddate -ext subjectAltName 2>/dev/null", 20)
    res["cert"] = " ".join(cert.split())[:400]
    return res


def dns(apex):
    q = lambda t, n: " | ".join(sh(f"dig +short {t} {n} @1.1.1.1", 20).split("\n")).strip(" |")
    dout = sh(f"dig +dnssec A {apex} @1.1.1.1", 20)
    ad = "ad" in dout.split("flags:")[1].split(";")[0].split() if "flags:" in dout else False
    return {"caa": q("CAA", apex), "ds": q("DS", apex), "dnssec_validated": ad, "mx": q("MX", apex),
            "spf": [t for t in q("TXT", apex).split(" | ") if "spf1" in t], "dmarc": q("TXT", "_dmarc." + apex),
            "mta_sts": q("TXT", "_mta-sts." + apex), "tls_rpt": q("TXT", "_smtp._tls." + apex),
            "aaaa": q("AAAA", apex), "https_rr": q("HTTPS", apex)}


def observatory(host):
    try:
        req = urllib.request.Request(f"https://observatory-api.mdn.mozilla.net/api/v2/scan?host={host}", method="POST", headers={"User-Agent": UA})
        d = json.loads(urllib.request.urlopen(req, timeout=60).read())
        return {k: d.get(k) for k in ["grade", "score", "tests_passed", "tests_failed", "scanned_at", "error"]}
    except Exception as e:
        return {"error": str(e)[:200]}


def hsts_preload(apex):
    out = {}
    for ep in ["status", "preloadable"]:
        try:
            d = json.loads(urllib.request.urlopen(f"https://hstspreload.org/api/v2/{ep}?domain={apex}", timeout=30).read())
            out[ep] = d.get("status") if ep == "status" else {"errors": [e.get("code") for e in d.get("errors", [])], "warnings": [w.get("code") for w in d.get("warnings", [])]}
        except Exception as e:
            out[ep] = str(e)[:120]
    return out


def lighthouse(url, tag):
    runs = []
    for i in range(LH_RUNS):
        path = f"/tmp/lh-{tag}-{i}.json"
        sh(f"npx -y lighthouse@12 '{url}' --quiet --output=json --output-path={path} --only-categories=performance,accessibility,best-practices,seo --chrome-flags='--headless=new --no-sandbox --disable-gpu'", 240)
        try:
            r = json.load(open(path))
        except Exception:
            continue
        a = r["audits"]
        g = lambda k: a.get(k, {}).get("numericValue")
        console = [(it.get("source"), (it.get("description") or "")[:220]) for it in a.get("errors-in-console", {}).get("details", {}).get("items", [])]
        failed = [it.get("url") for it in a.get("network-requests", {}).get("details", {}).get("items", []) if (it.get("statusCode") or 0) >= 400 or it.get("statusCode") == -1]
        runs.append({"perf": round(r["categories"]["performance"]["score"] * 100), "a11y": round(r["categories"]["accessibility"]["score"] * 100),
                     "bp": round(r["categories"]["best-practices"]["score"] * 100), "seo": round(r["categories"]["seo"]["score"] * 100),
                     "fcp": g("first-contentful-paint"), "lcp": g("largest-contentful-paint"), "tbt": g("total-blocking-time"), "cls": g("cumulative-layout-shift"),
                     "si": g("speed-index"), "bytes": g("total-byte-weight"), "requests": len(a.get("network-requests", {}).get("details", {}).get("items", [])),
                     "console": console, "failed": failed,
                     "opps": sorted([(k, round(v.get("numericValue") or 0)) for k, v in a.items() if v.get("details", {}).get("type") == "opportunity" and (v.get("numericValue") or 0) > 50], key=lambda x: -x[1])[:6],
                     "failing_bp": [k for k in ["csp-xss", "is-on-https", "inspector-issues", "errors-in-console", "deprecations", "third-party-cookies", "valid-source-maps", "has-hsts", "origin-isolation", "clickjacking-mitigation", "trusted-types-xss"] if a.get(k, {}).get("score") not in (1, None)],
                     "failing_a11y": [k for k, v in a.items() if v.get("score") == 0 and k in {x["id"] for x in r["categories"]["accessibility"]["auditRefs"]}][:10]})
    if not runs:
        return {"error": "lighthouse failed"}
    runs.sort(key=lambda x: x["perf"])
    med = runs[len(runs) // 2]
    med["perf_all"] = [x["perf"] for x in runs]
    return med


report = {"started": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "runner_ip_country": sh("curl -s --max-time 10 https://ipinfo.io/country").strip(), "sites": {}}
for name, s in SITES.items():
    o, apex = s["origin"], s["apex"]
    host = urlparse(o).netloc
    r = {}
    r["headers_home"] = dict(zip(["status", "headers"], curl_head(o + "/")))
    r["headers_home"]["headers"] = {k: v for k, v in r["headers_home"]["headers"].items() if k in SEC_HEADERS}
    r["headers_asset_sample"] = {}
    r["redirects"] = {}
    for u in [f"http://{apex}/", f"https://{apex}/", f"http://www.{apex}/", f"https://www.{apex}/", f"{o}/notion", f"{o}/football"]:
        out = sh(f"curl -sS -o /dev/null -w '%{{http_code}} %{{redirect_url}}' -A '{UA}' --max-time 20 '{u}'", 30).strip()
        r["redirects"][u] = out
    r["probes"] = {}
    for p in PROBES:
        out = sh(f"curl -sS -o /tmp/probe -w '%{{http_code}} %{{content_type}} %{{size_download}}' -A '{UA}' --max-time 20 '{o}{p}'", 30).strip()
        r["probes"][p] = out
    r["timing"] = {p: timing(o + p) for p in s["lh"]}
    r["third_party_home"] = third_party(o, "/")
    r["tls"] = tls(host)
    r["dns"] = dns(apex)
    r["observatory"] = observatory(host)
    r["hsts_preload"] = hsts_preload(apex)
    r["extra_hosts"] = {}
    for h in s["extra_hosts"]:
        st, hd = curl_head(f"https://{h}/")
        r["extra_hosts"][h] = {"status": st, "hsts": hd.get("strict-transport-security"), "robots": hd.get("x-robots-tag"), "server": hd.get("server"), "csp": (hd.get("content-security-policy") or "")[:80]}
    urls = sitemap_urls(o)
    r["sitemap_count"] = len(urls)
    r["crawl"] = crawl(urls)
    # asset headers: first css/js referenced by home
    home = sh(f"curl -sS --compressed -A '{UA}' --max-time 25 '{o}/'", 40)
    assets = re.findall(r"(?:href|src)=\"(/[^\"]+\.(?:css|js|woff2|webp|png|jpg|svg))\"", home)[:4]
    for a in assets:
        st, hd = curl_head(o + a)
        st2, hd2 = curl_head(o + a)
        r["headers_asset_sample"][a] = {"status": st, "cache-control": hd.get("cache-control"), "cf-cache-status": [hd.get("cf-cache-status"), hd2.get("cf-cache-status")], "content-encoding": hd2.get("content-encoding")}
    # html cache behaviour: two hits on the same page
    c = []
    for _ in range(3):
        st, hd = curl_head(o + "/")
        c.append([hd.get("cf-cache-status"), hd.get("age"), hd.get("cache-control")])
        time.sleep(1)
    r["html_cache"] = c
    report["sites"][name] = r
    json.dump(report, open(f"{OUT}/report.json", "w"), indent=1)

# Lighthouse last (slowest)
for name, s in SITES.items():
    report["sites"][name]["lighthouse"] = {}
    for p in s["lh"]:
        report["sites"][name]["lighthouse"][p] = lighthouse(s["origin"] + p, name + re.sub(r"\W", "_", p))
        json.dump(report, open(f"{OUT}/report.json", "w"), indent=1)

report["finished"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
json.dump(report, open(f"{OUT}/report.json", "w"), indent=1)
print("audit done")
