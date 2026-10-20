import { esc } from "./validate.js";
import { renderString } from "./tokens.js";
import resultHtml from "../templates/free-result.html";
import resultTxt from "../templates/free-result.txt";
import resultSubj from "../templates/free-result.subject.txt";
import fixHtml from "../templates/fixlist-delivery.html";
import fixTxt from "../templates/fixlist-delivery.txt";
import fixSubj from "../templates/fixlist-delivery.subject.txt";

// Approved templates are used exactly as delivered; only {{placeholders}} are filled (HTML-escaped in the HTML part).
export function buildResultEmail(T) {
  return { subject: renderString(resultSubj.trim(), T), html: renderString(resultHtml, T, esc), text: renderString(resultTxt, T) };
}
export function buildFixlistEmail(T) {
  return { subject: renderString(fixSubj.trim(), T), html: renderString(fixHtml, T, esc), text: renderString(fixTxt, T) };
}
export async function resendSuppressed(key, email) {
  const res = await fetch("https://api.resend.com/suppressions/" + encodeURIComponent(email), { headers: { Authorization: "Bearer " + key } });
  if (res.status === 404) return false;
  if (res.ok) return true;
  if (res.status === 401 || res.status === 403) return null; // sending-only key cannot read suppressions; Resend still blocks suppressed recipients at send time
  throw new Error("resend suppression check " + res.status);
}
export async function resendSuppress(key, email) {
  const res = await fetch("https://api.resend.com/suppressions", { method: "POST", headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" }, body: JSON.stringify({ email }) });
  return res.ok;
}
export function emailPayload(env, { to, msg, flow, unsubUrl }) {
  const body = { from: env.MAIL_FROM, to: [to], subject: msg.subject, html: msg.html, text: msg.text, tags: [{ name: "flow", value: flow }, { name: "owner", value: "website_ops" }] };
  if (unsubUrl) body.headers = { "List-Unsubscribe": "<mailto:admin@anthonytoday.com?subject=unsubscribe>, <" + unsubUrl + ">", "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" };
  return body;
}
export async function resendSend(env, body, idem) {
  const res = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: "Bearer " + env.RESEND_API_KEY, "Content-Type": "application/json", "Idempotency-Key": idem }, body: JSON.stringify(body) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error("resend send " + res.status + " " + (j.message || ""));
  return j.id;
}

// Internal notification to admin@ (separate plain email, never a bcc of the client email: no client unsubscribe link, no List-Unsubscribe).
export function internalPayload(env, { kind, sub, r, L, held, doNotEmail, leadUrl }) {
  const test = /@anthonytoday\.com$/i.test(sub.email) ? "[TEST] " : "";
  const subject = test + (kind === "fixlist"
    ? "[Security Check] Fix List purchased: " + sub.company + " | " + r.total + "/100"
    : "[Security Check] New result: " + sub.company + " | " + r.total + "/100 | Level " + r.level + " " + r.levelName);
  const lines = [
    "Name: " + sub.name, "Email: " + sub.email, "Company: " + sub.company, "Country: " + (sub.country || "n/a"),
    "Team size: " + (sub.team_size_label || sub.team_size), "Plan: " + (sub.plan_label || sub.plan), "Score: " + r.total + "/100, Level " + r.level + " " + r.levelName,
    "Critical flags: " + (r.flags.length ? r.flags.map((f) => f.label).join(", ") : "none"),
    "Client email: " + (held ? "held (real-client lock)" : kind === "fixlist" ? "Fix List email sent" : "result email sent"),
    "Do Not Email: " + (doNotEmail ? "yes" : "no"), "Leads row: " + (leadUrl || "n/a"), "Result (/r/): " + L.result,
  ];
  if (kind === "fixlist") lines.push("Fix List (/f/): " + L.fixlist_page, "Stripe session: " + (sub.stripe_session || "n/a"));
  if (kind === "fixlist" && sub.matched_by === "checkout_email") lines.push("Matched by: checkout email (client_reference_id missing or unknown). Check it is the right result.");
  return { from: env.MAIL_FROM, to: [env.INTERNAL_NOTIFY_TO || "admin@anthonytoday.com"], subject, text: lines.join("\n") + "\n",
    tags: [{ name: "flow", value: "security_check_internal" }, { name: "owner", value: "website_ops" }] };
}
