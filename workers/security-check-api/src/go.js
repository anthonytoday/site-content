// UNUSED, NOT DEPLOYED. Reference only: L0_CEO decided on no Worker route for /go/fix-report (the static
// www.anthonytoday.com/go-fix-report/ page is primary). Not imported by index.js. Kept with L-2_Security's GFR-2 and GFR-4
// fixes so it is safe if it is ever wired up.
// Every value put in the checkout URL is allowlisted: client_reference_id ^r[0-9a-f]{24}$, utm_* ^[A-Za-z0-9_.-]{1,64}$,
// payment link ^https://buy\.stripe\.com/[A-Za-z0-9]+$ (else the hardcoded $39 link).
export const FIX_REPORT_FALLBACK_LINK = "https://buy.stripe.com/28E6oJfmMbYh27h4Kt1ZS0x";
export const FIX_REPORT_DEFAULT_UTM = "utm_source=website&utm_medium=security_check&utm_campaign=fixlist";
const DEF = [["utm_source", "website"], ["utm_medium", "security_check"], ["utm_campaign", "fixlist"]];
const UTM = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"];
const LINK_RE = /^https:\/\/buy\.stripe\.com\/[A-Za-z0-9]+$/;

export function fixReportTarget(env, search) {
  const cand = env && env.FIXLIST_PAYMENT_LINK;
  const base = cand && LINK_RE.test(cand) ? cand : FIX_REPORT_FALLBACK_LINK;
  const inq = new URLSearchParams(String(search || "")), out = new URLSearchParams();
  let has = false;
  const rid = inq.get("client_reference_id");
  if (rid && /^r[0-9a-f]{24}$/.test(rid)) out.set("client_reference_id", rid);
  for (const k of UTM) { const v = inq.get(k); if (v && /^[A-Za-z0-9_.-]{1,64}$/.test(v)) { out.set(k, v); has = true; } }
  if (!has) for (const [k, v] of DEF) out.set(k, v);
  return base + "?" + out.toString();
}

export function goFixReport(req, env, url) {
  if (req.method !== "GET" && req.method !== "HEAD") return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
  return new Response(null, { status: 302, headers: { Location: fixReportTarget(env, url.search), "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow" } });
}
