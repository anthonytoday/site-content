// Unit test for the Worker /go/fix-report 302 (src/go.js). Run: node go-fix-report.test.mjs
import { goFixReport, fixReportTarget, FIX_REPORT_DEFAULT_UTM } from "../../workers/security-check-api/src/go.js";
const LINK = "https://buy.stripe.com/28E6oJfmMbYh27h4Kt1ZS0x"; const env = { FIXLIST_PAYMENT_LINK: LINK };
let fails = 0; const ok = (c, l) => { console.log((c ? "PASS " : "FAIL ") + l); if (!c) fails++; };
const run = (qs, method = "GET") => { const u = new URL("https://x.workers.dev/go/fix-report" + qs); return goFixReport(new Request(u, { method }), env, u); };
ok(FIX_REPORT_DEFAULT_UTM === "utm_source=website&utm_medium=security_check&utm_campaign=fixlist", "default UTMs are the existing $39 checkout values");
let r = run("?client_reference_id=test&utm_source=x");
ok(r.status === 302 && r.headers.get("Location") === LINK + "?client_reference_id=test&utm_source=x", "rid + own utm: passed through, no defaults");
r = run("?client_reference_id=r0123456789abcdef01234567");
ok(r.headers.get("Location") === LINK + "?client_reference_id=r0123456789abcdef01234567&" + FIX_REPORT_DEFAULT_UTM, "rid only: kept, defaults added");
r = run("");
ok(r.headers.get("Location") === LINK + "?" + FIX_REPORT_DEFAULT_UTM, "no query: defaults only");
ok(r.headers.get("Cache-Control") === "no-store", "no-store");
r = run("?client_reference_id=test", "HEAD"); ok(r.status === 302, "HEAD 302");
r = run("", "POST"); ok(r.status === 405, "POST 405");
ok(fixReportTarget({}, "?a=1").startsWith(LINK + "?a=1&"), "fallback link when var unset");
if (fails) { console.log(fails + " failing"); process.exit(1); } else console.log("all passed");
