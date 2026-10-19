// GET /go/fix-report: server-side 302 to the $39 checkout (FIXLIST_PAYMENT_LINK), so attribution works with or without JavaScript.
// The incoming query string is passed through unchanged (client_reference_id, any utm_*). Default UTMs are added only when
// no utm_* parameter is present. They are the existing $39 checkout UTMs from pages/security-check.html (withUtm).
export const FIX_REPORT_DEFAULT_UTM = "utm_source=website&utm_medium=security_check&utm_campaign=fixlist";
export const FIX_REPORT_FALLBACK_LINK = "https://buy.stripe.com/28E6oJfmMbYh27h4Kt1ZS0x";

export function fixReportTarget(env, search) {
  const base = (env && env.FIXLIST_PAYMENT_LINK) || FIX_REPORT_FALLBACK_LINK;
  let q = String(search || "").replace(/^\?/, "");
  if (!/(^|&)utm_[a-z]+=/i.test(q)) q = (q ? q + "&" : "") + FIX_REPORT_DEFAULT_UTM;
  return base + "?" + q;
}

export function goFixReport(req, env, url) {
  if (req.method !== "GET" && req.method !== "HEAD") return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
  return new Response(null, { status: 302, headers: { Location: fixReportTarget(env, url.search), "Cache-Control": "no-store", "Referrer-Policy": "no-referrer-when-downgrade", "X-Robots-Tag": "noindex, nofollow" } });
}
