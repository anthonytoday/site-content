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
