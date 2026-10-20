// security-check-api: Notion Workspace Security Check backend (Cloudflare Worker, free plan).
// POST /submit, POST /industry, GET|POST /unsubscribe, POST /stripe-webhook, GET /r/:id (result page), GET /f/:id (fix list page),
// dry-run helpers: POST /test/stripe-event, GET /preview/email.
import data from "./quiz-data.json";
import freeSnapshot from "../templates/notion-free-result.blocks.json";
import fixSnapshot from "../templates/notion-fixlist.blocks.json";
import { score } from "./scoring.js";
import { validateSubmission, esc } from "./validate.js";
import { computeTokens } from "./tokens.js";
import { buildResultEmail, buildFixlistEmail, resendSuppressed, resendSuppress, emailPayload, resendSend, internalPayload } from "./email.js";
import { Notion, leadProperties, paidProperties } from "./notion.js";
import { readTree, transform, writeTree, actionRows, withFooter } from "./notion-tpl.js";
import { renderPage, renderBlocks, renderActionPlan, renderFragment, scopedCss } from "./render.js";
import { fmtDate, fmtRange } from "./tokens.js";

const enc = new TextEncoder();
const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64uStr = (s) => b64u(enc.encode(s));
const unb64u = (s) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0)));
async function hmac(key, msg) { const k = await crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); return crypto.subtle.sign("HMAC", k, enc.encode(msg)); }
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
async function sign(env, s) { return b64u(await hmac(env.SIGNING_KEY, s)).slice(0, 32); }
// Hashed email index: KV key "eh:" + HMAC-SHA256(SIGNING_KEY, lowercased email). The email itself is never a key here and never in a URL.
async function emailKey(env, email) { return "eh:" + b64u(await hmac(env.SIGNING_KEY, "eh:" + String(email || "").trim().toLowerCase())); }
const EMAIL_INDEX_TTL = 60 * 60 * 24 * 730; // same 730 days as the sub:<rid> record it points to
function safeEq(a, b) { if (typeof a !== "string" || a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; }
const isDry = (env) => env.DRY_RUN !== "0";
// Real-client lock: with DRY_RUN=0 and LIVE_FOR != "all", only TEST_SEND_ALLOWLIST addresses run for real
// (Notion writes + Resend); everyone else gets the dry-run pipeline. L0_CEO flips LIVE_FOR to "all" to go live.
const allow = (env) => (env.TEST_SEND_ALLOWLIST || "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
const locked = (env) => env.LIVE_FOR !== "all";
const liveFor = (env, email) => !isDry(env) && (!locked(env) || allow(env).includes(String(email || "").toLowerCase()));
const testPhase = (env) => isDry(env) || locked(env);
// Held: the Worker is live but this address is not allowlisted yet. Leads row is written, the email is held in KV (heldmail:<rid>).
const heldFor = (env, email) => !isDry(env) && !liveFor(env, email);
const json = (obj, status = 200, headers = {}) => new Response(JSON.stringify(obj, null, 1), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers } });
const html = (s, status = 200) => new Response(s, { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data: https://www.anthonytoday.com https://security-check.security-check-preview.pages.dev; form-action 'self'", "Referrer-Policy": "no-referrer" } });

function cors(env, req) {
  const o = req.headers.get("Origin") || "";
  const allowed = (env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
  const ok = allowed.includes(o) || (isDry(env) && /^https:\/\/[a-z0-9-]+\.(trycloudflare\.com|pages\.dev)$/.test(o)) || (testPhase(env) && /^https:\/\/([a-z0-9-]+\.)?security-check-preview\.pages\.dev$/.test(o));
  return ok ? { "Access-Control-Allow-Origin": o, "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Max-Age": "600", Vary: "Origin" } : {};
}
const nowIso = () => new Date().toISOString();
function dubaiDay() { return new Date(Date.now() + 4 * 3600e3).toISOString().slice(0, 10).replace(/-/g, ""); }

async function rateLimited(env, key, limit) {
  const k = "rl:" + key + ":" + Math.floor(Date.now() / 3600e3);
  const n = Number((await env.SC.get(k)) || 0);
  if (n >= limit) return true;
  await env.SC.put(k, String(n + 1), { expirationTtl: 3700 });
  return false;
}
async function nextSubmissionId(env) {
  const day = dubaiDay();
  const k = "cnt:" + day;
  const n = Number((await env.SC.get(k)) || 0) + 1;
  await env.SC.put(k, String(n), { expirationTtl: 3 * 86400 });
  return "SC-" + day + "-" + String(n).padStart(4, "0");
}
function newResultId() { const b = new Uint8Array(12); crypto.getRandomValues(b); return "r" + hex(b); }

// ---------- unsubscribe tokens (BASE-H2) ----------
// Opaque random token, 128 bits, URL-safe: "u1" + 22 base64url chars. KV "ut:<token>" -> { e, r, at }, written once when the
// result email is built for sending (never per click, never for dry-run previews). TTL 400 days.
// Swappable: UNSUB_BASE can point the link at another endpoint (for example L0's Supabase function) that resolves the same token.
const UNSUB_TOKEN_TTL = 60 * 60 * 24 * 400;
const UNSUB_RE = /^u1[A-Za-z0-9_-]{22}$/;
const unsubUrl = (env, token) => (env.UNSUB_BASE || env.PUBLIC_BASE + "/unsubscribe") + "?token=" + token;
async function issueUnsubToken(env, sub) {
  const b = new Uint8Array(16); crypto.getRandomValues(b);
  const token = "u1" + b64u(b);
  await env.SC.put("ut:" + token, JSON.stringify({ e: sub.email, r: sub.result_id, at: nowIso() }), { expirationTtl: UNSUB_TOKEN_TTL });
  return unsubUrl(env, token);
}
// Shared unsubscribe (L0_CEO, 20 Oct): the result email uses the same unsubscribe system as every other AnthonyToday email.
// Its token is a row in Supabase public.unsub_tokens (18 random bytes = 144 bits, 24 base64url chars, one per address, reused),
// not an HMAC, so it is minted: POST UNSUB_MINT_URL (cc-hooks /mint, Bearer UNSUB_MINT_TOKEN, a Worker secret). The address goes in
// the POST body only. Links are built here from fixed bases, never taken from the response:
//   body link        https://www.anthonytoday.com/unsubscribe/?id=<tok>&l=en   (static page; its button POSTs to the unsub function)
//   List-Unsubscribe <SB_UNSUB_BASE?id=<tok>&l=en&oc=1>                        (RFC 8058 one-click POST needs a server endpoint)
// Mint + status check share ONE 3 s deadline (SB_TIMEOUT_MS), so a send is never held up longer than that. Any failure on the mint
// -> KV u1 token (128 bits) on the Worker /unsubscribe; never a legacy token, never ?e=. Which path is used never depends on request input.
// Status (fmt=json, read-only GET) done:true means the address already unsubscribed through the shared system -> the send is skipped.
const SB_UNSUB_BASE = "https://jzmglkzmqgojjnqxoytf.supabase.co/functions/v1/unsub";
const SB_PAGE_BASE = "https://www.anthonytoday.com/unsubscribe/";
const SB_TOKEN_RE = /^[A-Za-z0-9_-]{24}$/;
const SB_MINT_URL_RE = /^https:\/\/jzmglkzmqgojjnqxoytf\.supabase\.co\/functions\/v1\/cc-hooks\/mint$/;
const SB_TIMEOUT_MS = 3000;
const sbLinks = (t) => ({ url: SB_PAGE_BASE + "?id=" + t + "&l=en", oneClick: SB_UNSUB_BASE + "?id=" + t + "&l=en&oc=1" });
const errName = (e) => (e && (e.name === "TimeoutError" || e.name === "AbortError") ? "timeout" : "failed");
async function mintSharedUnsub(env, email, signal) {
  if (!env.UNSUB_MINT_URL || !env.UNSUB_MINT_TOKEN) return { error: "not configured" };
  if (!SB_MINT_URL_RE.test(env.UNSUB_MINT_URL)) return { error: "bad mint url" };
  try {
    const res = await fetch(env.UNSUB_MINT_URL, { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + env.UNSUB_MINT_TOKEN },
      body: JSON.stringify({ email, lang: "en", source: "security-check-worker" }), signal });
    if (!res.ok) return { error: "mint " + res.status }; // status code only: the response body is never read or logged on error
    const j = await res.json().catch(() => ({}));
    const t = String((j && j.token) || "");
    return SB_TOKEN_RE.test(t) ? { token: t } : { error: "mint bad token" };
  } catch (e) { return { error: "mint " + errName(e) }; }
}
// true = already unsubscribed in the shared system, false = not, null = unknown (error/timeout: the Worker's own checks still apply)
async function sharedUnsubDone(token, signal) {
  if (!SB_TOKEN_RE.test(token)) return null;
  try {
    const res = await fetch(SB_UNSUB_BASE + "?id=" + token + "&l=en&fmt=json", { method: "GET", signal });
    if (!res.ok) return null;
    const j = await res.json().catch(() => null);
    return j && j.ok === true ? j.done === true : null;
  } catch { return null; }
}
async function unsubForSend(env, sub) {
  const signal = AbortSignal.timeout(SB_TIMEOUT_MS);
  const m = await mintSharedUnsub(env, sub.email, signal);
  if (m.token) return { ...sbLinks(m.token), via: "supabase", sharedDone: await sharedUnsubDone(m.token, signal) };
  return { url: await issueUnsubToken(env, sub), via: "kv_u1", fallback: m.error };
}
// Token of a stored (held) payload, from its own one-click header; null for u1/legacy payloads.
const sbTokenOf = (payload) => { const h = (payload && payload.headers && payload.headers["List-Unsubscribe"]) || ""; const m = h.match(/\/functions\/v1\/unsub\?id=([A-Za-z0-9_-]{24})&/); return m ? m[1] : null; };
// Worker-side unsubscribe (u1 / legacy link) -> tell the shared system too, so the other AnthonyToday emails stop as well.
// Best effort, one 3 s deadline, never blocks the confirmation. Off with UNSUB_SHARED_SYNC = "0".
// Note: the Supabase unsub function itself also sets crm_contacts.dne=1 (L0's system); the Worker never touches CRM Contacts directly.
async function syncSharedUnsub(env, email) {
  if (env.UNSUB_SHARED_SYNC === "0") return "off";
  const signal = AbortSignal.timeout(SB_TIMEOUT_MS);
  const m = await mintSharedUnsub(env, email, signal);
  if (!m.token) return m.error;
  try {
    const res = await fetch(SB_UNSUB_BASE + "?l=en&fmt=json", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "id=" + m.token, signal });
    return res.ok ? "ok" : "unsub " + res.status;
  } catch (e) { return "unsub " + errName(e); }
}
// Legacy tokens (base64 JSON of the email + HMAC) already sit in inboxes. Accepted read-only until LEGACY_UNSUB_UNTIL (default 30 Apr 2027); never issued again.
const legacyUnsubOpen = (env) => Date.now() < Date.parse(env.LEGACY_UNSUB_UNTIL || "2027-04-30T00:00:00Z");
async function resolveUnsubToken(env, token) {
  if (UNSUB_RE.test(token)) { const v = await env.SC.get("ut:" + token, "json"); return v && v.e ? { e: v.e, r: v.r, kind: "token" } : null; }
  if (!legacyUnsubOpen(env)) return null;
  const [p, s] = token.split(".");
  if (!p || !s || !safeEq(s, await sign(env, "u:" + p))) return null;
  try { const v = JSON.parse(unb64u(p)); return v && typeof v.e === "string" ? { e: v.e, r: v.r, kind: "legacy" } : null; } catch { return null; }
}
// j***@d***.com
function maskEmail(e) {
  const [u, d] = String(e).split("@"); if (!d) return "***";
  const parts = d.split("."); const tld = parts.length > 1 ? "." + parts[parts.length - 1] : "";
  return (u[0] || "") + "***@" + (parts[0][0] || "") + "***" + tld;
}
async function links(env, sub) {
  const base = env.PUBLIC_BASE;
  const t = await sign(env, "r:" + sub.result_id);
  return {
    result: base + "/r/" + sub.result_id + "?t=" + t,
    fixlist_page: base + "/f/" + sub.result_id + "?t=" + (await sign(env, "f:" + sub.result_id)),
    fixlist: env.FIXLIST_PAYMENT_LINK + "?client_reference_id=" + sub.result_id,
    unsub: unsubUrl(env, "preview"), // placeholder for previews; the real token is minted only when an email is built for sending (issueUnsubToken)
    maturity_base: env.MATURITY_IMG_BASE || "https://www.anthonytoday.com",
  };
}

async function templateBlocks(env, kind) {
  const id = kind === "free" ? env.NOTION_FREE_RESULT_TEMPLATE_ID : env.NOTION_FIXLIST_TEMPLATE_ID;
  if (!env.NOTION_TOKEN || !id) return { blocks: kind === "free" ? freeSnapshot : fixSnapshot, source: "snapshot (template as of 19 Oct 2026, 11:34 am UAE)" };
  const ck = "tpl:" + id;
  const cached = await env.SC.get(ck, "json");
  if (cached) return { blocks: cached, source: "notion template (cached)" };
  try {
    const blocks = await readTree(new Notion(env.NOTION_TOKEN), id);
    await env.SC.put(ck, JSON.stringify(blocks), { expirationTtl: 3600 });
    return { blocks, source: "notion template (live)" };
  } catch (e) { return { blocks: kind === "free" ? freeSnapshot : fixSnapshot, source: "snapshot (template read failed: " + String(e.message).slice(0, 80) + ")" }; }
}

// ---------- submit ----------
async function handleSubmit(req, env, ctx, h) {
  const len = Number(req.headers.get("Content-Length") || 0);
  if (len > 8000) return json({ ok: false, error: "too_large" }, 413, h);
  let body;
  try { body = JSON.parse(await req.text()); } catch { return json({ ok: false, error: "bad_json" }, 400, h); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return json({ ok: false, error: "bad_json" }, 400, h);
  if (body.website) return json({ ok: true }, 200, h); // honeypot
  const ip = req.headers.get("CF-Connecting-IP") || "0";
  if (await rateLimited(env, "ip:" + ip, Number(env.RATE_PER_IP_HOUR || 20))) return json({ ok: false, error: "rate_limited" }, 429, h);
  const v = validateSubmission(data, body);
  if (!v.ok) {
    // Diagnostic record of the rejected shape (no name, email or company), so a client-side bug can be traced.
    const shape = { at: nowIso(), fields: v.errors, origin: req.headers.get("Origin") || "", ua: (req.headers.get("User-Agent") || "").slice(0, 160),
      team_size: body.team_size, role: body.role, plan: body.plan, country: typeof body.country === "string" ? body.country.slice(0, 60) : typeof body.country,
      source: body.source, consent: body.consent, email_ok: typeof body.email === "string" && body.email.includes("@"), answers: body.answers, keys: Object.keys(body).slice(0, 20) };
    await env.SC.put("rej:" + Date.now() + ":" + Math.random().toString(36).slice(2, 6), JSON.stringify(shape), { expirationTtl: 14 * 86400 }).catch(() => {});
    return json({ ok: false, error: "invalid", fields: v.errors }, 400, h);
  }
  const sub = v.value;
  if (await rateLimited(env, "em:" + sub.email, 12)) return json({ ok: false, error: "rate_limited" }, 429, h);
  const r = score(data, sub.answers, sub.team_size);
  const prevRid = await env.SC.get("email:" + sub.email);
  const prev = prevRid ? await env.SC.get("sub:" + prevRid, "json") : null;
  Object.assign(sub, { result_id: newResultId(), submission_id: await nextSubmissionId(env), submitted_at: nowIso(), quiz_version: data.version,
    retake_count: prev ? (prev.retake_count || 0) + 1 : 0, previous_total: prev ? prev.result.total : null, dry_run: !liveFor(env, sub.email), held: heldFor(env, sub.email), unsubscribed: !!(prev && prev.unsubscribed) });
  sub.result = r;
  await env.SC.put("sub:" + sub.result_id, JSON.stringify(sub), { expirationTtl: 60 * 60 * 24 * 730 });
  await env.SC.put("email:" + sub.email, sub.result_id, { expirationTtl: 60 * 60 * 24 * 730 });
  await env.SC.put(await emailKey(env, sub.email), sub.result_id, { expirationTtl: EMAIL_INDEX_TTL });
  const L = await links(env, sub);
  const pipeline = runSubmitPipeline(env, sub, r, L);
  const view = { total: r.total, level: r.level, levelName: r.levelName, domains: r.domains.map(({ id, name, score, level, levelName }) => ({ id, name, score, level, levelName })),
    flags: r.flags.map((f) => ({ label: f.label, q: "Q" + f.question.slice(1), headline: f.headline })), topRisks: r.topRisks.map((x) => ({ title: x.title, critical: x.critical })) };
  const out = { ok: true, resultId: sub.result_id, submissionId: sub.submission_id, result: view, resultUrl: L.result, fixlistUrl: L.fixlist, industryToken: await sign(env, "i:" + sub.result_id) };
  try { const w = await webResult(env, { ...sub }, "free"); out.resultHtml = renderFragment(w.title, w.blocks, w.extra); out.resultCss = scopedCss(); } catch (e) { out.resultHtmlError = String(e.message || e).slice(0, 200); }
  out.held = sub.held; out.emailStatus = !sub.consent ? "no_consent" : sub.held ? "held" : isDry(env) ? "preview" : "sending";
  if (sub.dry_run || (testPhase(env) && liveFor(env, sub.email))) { out.dryRun = isDry(env); out.testLive = !sub.dry_run; out.log = await pipeline; out.previews = { resultPage: L.result, email: env.PUBLIC_BASE + "/preview/email?rid=" + sub.result_id + "&t=" + (await sign(env, "p:" + sub.result_id)) }; }
  else ctx.waitUntil(pipeline);
  return json(out, 200, h);
}

// Internal notification to admin@ (free result incl. held, and every Fix List purchase). Never blocks the client flow.
async function notifyInternal(env, kind, sub, r, L, idem) {
  if (isDry(env) || !env.RESEND_API_KEY) return { dry: true };
  if (env.INTERNAL_NOTIFY === "off") return { skipped: "INTERNAL_NOTIFY=off (test runs)" };
  const leadUrl = sub.lead_page_id ? "https://www.notion.so/" + sub.lead_page_id.replace(/-/g, "") : null;
  const lab = (list, v) => (list.find((o) => o.value === v) || {}).label || v;
  sub = { ...sub, team_size_label: lab(data.profile.team_size, sub.team_size), plan_label: lab(data.profile.plan, sub.plan) };
  const payload = internalPayload(env, { kind, sub, r, L, held: !!sub.held, doNotEmail: !!sub.edu || !!sub.unsubscribed, leadUrl });
  const id = await resendSend(env, payload, idem);
  return { resendId: id, subject: payload.subject, tags: payload.tags };
}
async function runSubmitPipeline(env, sub, r, L) {
  const log = [];
  const dry = sub.dry_run;
  const step = async (name, fn) => { try { const res = await fn(); log.push({ step: name, ok: true, ...(res || {}) }); return res; } catch (e) { log.push({ step: name, ok: false, error: String(e.message || e).slice(0, 300) }); return null; } };
  const T = computeTokens(data, sub, r, L, "free");
  T.result_id = sub.result_id; T.unsubscribe_url = L.unsub;
  const notion = env.NOTION_TOKEN ? new Notion(env.NOTION_TOKEN) : null;
  let notionUrl = null;
  // 1. Free Result page in Notion (internal copy in the one-pager; the client opens the Worker-rendered link, see report).
  await step("notion_free_result_page", async () => {
    const tpl = await templateBlocks(env, "free");
    const blocks = withFooter(transform(tpl.blocks, T));
    if (dry || !notion) return { dry: true, template: tpl.source, blocks: blocks.length, parent: env.NOTION_RESULTS_PARENT_ID || "(unset)" };
    const page = await notion.call("POST", "/pages", { parent: { page_id: env.NOTION_RESULTS_PARENT_ID }, icon: { type: "emoji", emoji: "🛡️" }, properties: { title: { title: [{ type: "text", text: { content: "Free Result: " + sub.company + " (" + sub.submission_id + ")" } }] } } });
    await writeTree(notion, page.id, blocks);
    notionUrl = page.url;
    sub.notion_result_page = page.url;
    return { pageUrl: page.url, template: tpl.source };
  });
  // 2. Lead upsert in Security Check Leads (only DB this Worker writes).
  await step("notion_leads_upsert", async () => {
    const props = leadProperties(data, sub, r, notionUrl || L.result);
    if ((dry && !sub.held) || !notion || !env.NOTION_CRM_DB_ID) return { dry: true, db: env.NOTION_CRM_DB_ID ? "set" : "(unset)", properties: Object.fromEntries(Object.entries(props).map(([k, v]) => [k, v.select ? v.select && v.select.name : v.status ? v.status.name : v.multi_select ? v.multi_select.map((x) => x.name) : v.checkbox !== undefined ? v.checkbox : v.number !== undefined ? v.number : v.email || v.url || (v.title || v.rich_text || [])[0]?.text.content])) };
    const res = await notion.upsertLead(env.NOTION_CRM_DB_ID, sub.email, props);
    sub.lead_page_id = res.id;
    return res;
  });
  // 3. Command Center (Supabase) ingest, if L0_CEO provides an endpoint.
  await step("command_center_ingest", async () => {
    const payload = { type: "security_check.submission", submission_id: sub.submission_id, result_id: sub.result_id, submitted_at: sub.submitted_at, quiz_version: sub.quiz_version,
      name: sub.name, email: sub.email, company: sub.company, team_size: sub.team_size, role: sub.role, plan: sub.plan, country: sub.country, source: sub.source,
      consent: sub.consent, edu: sub.edu, marketing_ok: sub.consent && !sub.edu && !sub.unsubscribed, answers: sub.answers, total: r.total, level: r.level,
      domains: Object.fromEntries(r.domains.map((d) => [d.id, d.score])), flags: r.flags.map((f) => f.label), retake_count: sub.retake_count, previous_total: sub.previous_total };
    if (dry || !env.CC_INGEST_URL) return { dry: true, endpoint: env.CC_INGEST_URL ? "set" : "(unset)", payloadKeys: Object.keys(payload).length };
    const res = await fetch(env.CC_INGEST_URL, { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + env.CC_INGEST_TOKEN }, body: JSON.stringify(payload) });
    if (!res.ok) throw new Error("cc ingest " + res.status);
    return { status: res.status };
  });
  // 4. Result email via Resend (suppressions respected; consent required).
  await step("resend_result_email", async () => {
    // Mint the unsubscribe token only for an email that may really go out (live send or held for replay), never for dry previews.
    let unsub = L.unsub, oneClick = null, unsubVia = "preview", sharedDone = null;
    if (!isDry(env) && sub.consent && !sub.unsubscribed && (!dry || sub.held)) { const u = await unsubForSend(env, sub); unsub = u.url; oneClick = u.oneClick || null; sharedDone = u.sharedDone ?? null; unsubVia = u.via + (u.fallback ? " (" + u.fallback + ")" : ""); T.unsubscribe_url = unsub; }
    sub.unsub_via = unsubVia;
    if (sharedDone === true) { sub.unsubscribed = true; sub.unsub_shared = true; }
    const msg = buildResultEmail(T);
    const payload = emailPayload(env, { to: sub.email, msg, flow: "security_check_result", unsubUrl: unsub, oneClickUrl: oneClick });
    await env.SC.put("mail:" + sub.result_id, JSON.stringify(payload), { expirationTtl: (sub.held ? 60 : 7) * 86400 });
    if (!sub.consent) return { skipped: "no consent" };
    if (sub.unsubscribed) return { skipped: sub.unsub_shared ? "unsubscribed (shared system)" : "unsubscribed" };
    if (sub.held) { await env.SC.put("heldmail:" + sub.result_id, JSON.stringify({ at: nowIso(), idem: "sc-result-" + sub.result_id }), { expirationTtl: 60 * 86400 }); return { held: true, subject: msg.subject, to: sub.email, note: "real-client lock: email held, replay from KV heldmail:" + sub.result_id }; }
    if (dry || !env.RESEND_API_KEY) return { dry: true, subject: msg.subject, to: sub.email, tags: payload.tags, headers: payload.headers };
    if (await env.SC.get("unsub:" + sub.email)) return { skipped: "unsubscribed (worker record)" };
    const sup = await resendSuppressed(env.RESEND_API_KEY, sub.email);
    if (sup) return { skipped: "resend suppression" };
    const id = await resendSend(env, payload, "sc-result-" + sub.result_id);
    sub.score_email_sent = true; sub.resend_result_id = id;
    return { resendId: id, suppressionCheck: sup === null ? "unavailable (key lacks suppression read)" : "not suppressed", tags: payload.tags, headers: Object.keys(payload.headers || {}) };
  });
  await step("internal_notify", () => notifyInternal(env, "result", sub, r, L, "sc-int-result-" + sub.result_id));
  await env.SC.put("sub:" + sub.result_id, JSON.stringify({ ...sub, log }), { expirationTtl: 60 * 60 * 24 * 730 });
  return log;
}

// Replay held result emails once an address is live (lock lifted, or allowlisted): send the stored email, set Leads Stage to "Result sent".
async function replayHeld(env) {
  const done = [];
  const list = await env.SC.list({ prefix: "heldmail:", limit: 50 });
  for (const k of list.keys) {
    const rid = k.name.slice(9); const sub = await env.SC.get("sub:" + rid, "json"); const payload = await env.SC.get("mail:" + rid, "json");
    if (!sub || !payload) { done.push({ rid, skipped: "missing data" }); continue; }
    if (!liveFor(env, sub.email)) { done.push({ rid, skipped: "still locked" }); continue; }
    try {
      const sbt = sbTokenOf(payload);
      if (sbt && (await sharedUnsubDone(sbt, AbortSignal.timeout(SB_TIMEOUT_MS))) === true) { sub.unsubscribed = true; sub.unsub_shared = true; }
      if (!(await env.SC.get("unsub:" + sub.email)) && !sub.unsubscribed) sub.resend_result_id = await resendSend(env, payload, "sc-result-" + rid);
      if (env.NOTION_TOKEN && env.NOTION_CRM_DB_ID) { const n = new Notion(env.NOTION_TOKEN); const lead = await n.findLead(env.NOTION_CRM_DB_ID, sub.email); if (lead) await n.call("PATCH", "/pages/" + lead.id, { properties: { Stage: { status: { name: "Result sent" } } } }); }
      sub.held = false; await env.SC.put("sub:" + rid, JSON.stringify(sub), { expirationTtl: 60 * 60 * 24 * 730 }); await env.SC.delete(k.name);
      done.push({ rid, sent: sub.resend_result_id || "skipped (unsubscribed)" });
    } catch (e) { done.push({ rid, error: String(e.message).slice(0, 120) }); }
  }
  return json({ ok: true, processed: done.length, done });
}

// ---------- pages served by the Worker (signed links) ----------
// Web-only adjustments to the filled template (the Notion page keeps the full wording):
// PM web line for the Action Plan intro, no reference to the Notion Timeline tab, no repeated sub-line, Title Case labels.
const PLAN_WEB_LINE = "Start with the Phase 1 actions this week. Each action below shows its priority and the steps to do it, grouped by phase.";
const plainOf = (b) => ((b[b.type] || {}).rich_text || []).map((x) => (x.text ? x.text.content : x.plain_text || "")).join("");
function webVariant(list) {
  const out = [];
  for (const b of list) {
    const t = plainOf(b);
    if (b.type === "paragraph" && /^Items are ordered by impact/.test(t)) { out.push({ type: "paragraph", paragraph: { rich_text: [{ type: "text", text: { content: PLAN_WEB_LINE } }] } }); continue; }
    if (b.type === "paragraph" && /^Phase 1 and Phase 2 are dated/.test(t)) continue;
    if (b.type === "bulleted_list_item" && /^Compared With Other Teams/.test(t) && b.children) { const kid = b.children.map(plainOf).join(" "); if (/30 or more teams/.test(kid) && /30 or more teams/.test(t)) b.children = undefined; }
    const rtx = (b[b.type] || {}).rich_text;
    if (rtx) rtx.forEach((x) => { if (x.text && /What's working:/.test(x.text.content)) x.text.content = x.text.content.replace("What's working:", "What's Working:"); });
    if (b.children) b.children = webVariant(b.children);
    out.push(b);
  }
  // Drop a heading that has nothing under it (up to the next heading of the same or higher level).
  const lvl = (b) => (/^heading_[1-4]$/.test(b.type) ? Number(b.type.slice(-1)) : 0);
  return out.filter((b, i) => {
    const L = lvl(b); if (!L || b.children && b.children.length) return true;
    for (let j = i + 1; j < out.length; j++) { const M = lvl(out[j]); if (M && M <= L) return false; if (!M) return true; if (M > L) return true; }
    return false;
  });
}
async function handleResultPage(env, rid, t, kind) {
  if (!/^r[0-9a-f]{24}$/.test(rid) || !safeEq(t || "", await sign(env, (kind === "free" ? "r:" : "f:") + rid))) return html("<p>Link not valid.</p>", 404);
  const sub = await env.SC.get("sub:" + rid, "json");
  if (!sub) return html("<p>Result not found.</p>", 404);
  if (kind === "fix" && !sub.paid && !sub.dry_run) return html("<p>Your Fix List is being prepared. Check your inbox.</p>", 404);
  const w = await webResult(env, sub, kind);
  const banner = sub.dry_run && isDry(env) ? "DRY-RUN PREVIEW. Template source: " + w.source + ". Nothing was created in Notion and no email was sent." : null;
  return html(renderPage(w.title, w.blocks, banner, w.extra));
}
// /r/ and /f/ content. The quiz page's on-screen result uses the same blocks (renderFragment), so the two always match.
async function webResult(env, sub, kind) {
  // Re-score from the stored answers so older results show the current level bands and names.
  sub.result = score(data, sub.answers, sub.team_size);
  const L = await links(env, sub);
  const T = computeTokens(data, sub, sub.result, L, kind === "free" ? "free" : "fixlist");
  const tpl = await templateBlocks(env, kind === "free" ? "free" : "fix");
  const blocks = webVariant(withFooter(transform(tpl.blocks, T), true));
  const extra = kind === "fix" ? { actionDbHtml: renderActionPlan(actionRows(data, sub.result, sub.paid_at || sub.submitted_at, sub.plan), fmtRange) } : {};
  return { title: kind === "free" ? "Free Security Check Result" : "Security Check Fix List", blocks, extra, source: tpl.source };
}

async function handlePreviewEmail(env, url) {
  const rid = url.searchParams.get("rid") || "", t = url.searchParams.get("t") || "";
  if (!/^r[0-9a-f]{24}$/.test(rid) || !safeEq(t, await sign(env, "p:" + rid))) return html("<p>Link not valid.</p>", 404);
  const kind = url.searchParams.get("kind") === "fixlist" ? "fix" : "mail";
  const p = await env.SC.get(kind + ":" + rid, "json");
  if (!p) return html("<p>No email rendered for this result" + (kind === "fix" ? " (run the test payment first)" : "") + ".</p>", 404);
  const hdr = '<div style="font:13px -apple-system,sans-serif;background:#f3f4f6;padding:12px 16px;border-radius:8px;margin-bottom:16px"><b>DRY-RUN EMAIL PREVIEW (not sent)</b><br>From: ' + esc(p.from) + "<br>To: " + esc(p.to.join(", ")) + "<br>Subject: " + esc(p.subject) +
    "<br>Tags: " + esc(p.tags.map((x) => x.name + "=" + x.value).join(", ")) + (p.headers ? "<br>List-Unsubscribe: " + esc(p.headers["List-Unsubscribe"]) + "<br>List-Unsubscribe-Post: " + esc(p.headers["List-Unsubscribe-Post"]) : "<br>(no List-Unsubscribe: transactional)") + "</div>";
  return new Response("<!doctype html><meta charset=utf-8><meta name=robots content=noindex><div style=\"max-width:640px;margin:24px auto;font:15px/1.55 -apple-system,sans-serif\">" + hdr + p.html + "<hr><pre style=\"white-space:pre-wrap;font-size:13px\">" + esc(p.text) + "</pre></div>",
    { headers: { "Content-Type": "text/html; charset=utf-8", "X-Robots-Tag": "noindex", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'" } });
}

// ---------- industry (optional, after result) ----------
async function handleIndustry(req, env, h) {
  let b; try { b = await req.json(); } catch { return json({ ok: false }, 400, h); }
  const rid = String(b.resultId || "");
  if (!/^r[0-9a-f]{24}$/.test(rid) || !safeEq(String(b.token || ""), await sign(env, "i:" + rid))) return json({ ok: false }, 403, h);
  if (!data.profile.industry.some((o) => o.value === b.industry)) return json({ ok: false, error: "invalid" }, 400, h);
  const sub = await env.SC.get("sub:" + rid, "json");
  if (!sub) return json({ ok: false }, 404, h);
  sub.industry = b.industry;
  await env.SC.put("sub:" + rid, JSON.stringify(sub), { expirationTtl: 60 * 60 * 24 * 730 });
  // Leads DB has no Industry column; industry goes to the Command Center record only.
  if (!isDry(env) && env.CC_INGEST_URL) await fetch(env.CC_INGEST_URL, { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + env.CC_INGEST_TOKEN }, body: JSON.stringify({ type: "security_check.industry", result_id: rid, industry: b.industry }) }).catch(() => {});
  return json({ ok: true, dryRun: isDry(env) }, 200, h);
}

// ---------- unsubscribe (signed per-lead link + RFC 8058 one-click) ----------
async function handleUnsubscribe(req, env, url) {
  const token = (url.searchParams.get("token") || "").slice(0, 600);
  if (!UNSUB_RE.test(token) && SB_TOKEN_RE.test(token)) {
    // A shared-system token on the Worker host (never issued here, but harmless): GET -> the www page (no side effects), POST -> forward.
    if (req.method === "GET") return new Response(null, { status: 302, headers: { Location: sbLinks(token).url, "Cache-Control": "no-store" } });
    let ok = false;
    try { const res = await fetch(SB_UNSUB_BASE + "?l=en&fmt=json", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "id=" + token, signal: AbortSignal.timeout(SB_TIMEOUT_MS) }); ok = res.ok; } catch {}
    return ok ? html(page("<h2>You're unsubscribed</h2><p>You will not get these emails anymore.</p>"), 200) : html(page("<p>This link is not valid. Reply \"unsubscribe\" to the email and I will stop follow-ups.</p>"), 400);
  }
  const info = await resolveUnsubToken(env, token);
  if (!info) return html(page("<p>This link is not valid. Reply \"unsubscribe\" to the email and I will stop follow-ups.</p>"), 400);
  if (req.method === "GET") return html(page("<h2>Unsubscribe</h2><p>Stop Security Check follow-up emails to <b>" + esc(maskEmail(info.e)) + "</b>?</p><form method=\"post\" action=\"/unsubscribe?token=" + encodeURIComponent(token) + "\"><button style=\"padding:10px 18px;font-size:15px\">Confirm unsubscribe</button></form>"));
  const log = [];
  const rid = await env.SC.get("email:" + info.e);
  for (const id of new Set([rid, info.r].filter(Boolean))) { const sub = await env.SC.get("sub:" + id, "json"); if (sub) { sub.unsubscribed = true; await env.SC.put("sub:" + id, JSON.stringify(sub), { expirationTtl: 60 * 60 * 24 * 730 }); } }
  await env.SC.put("unsub:" + info.e, nowIso());
  if (liveFor(env, info.e)) {
    if (env.RESEND_API_KEY) log.push(["resend_suppression", await resendSuppress(env.RESEND_API_KEY, info.e).catch(() => false)]);
    if (env.NOTION_TOKEN && env.NOTION_CRM_DB_ID) { try { const n = new Notion(env.NOTION_TOKEN); const lead = await n.findLead(env.NOTION_CRM_DB_ID, info.e); if (lead) await n.call("PATCH", "/pages/" + lead.id, { properties: { "Do Not Email": { checkbox: true } } }); log.push(["leads_do_not_email", !!lead]); } catch (e) { log.push(["leads_do_not_email", false]); } }
    log.push(["shared_unsubscribe", await syncSharedUnsub(env, info.e)]);
    await env.SC.put("unsublog:" + info.e, JSON.stringify({ at: nowIso(), log }), { expirationTtl: 60 * 60 * 24 * 30 });
    if (env.CC_INGEST_URL) await fetch(env.CC_INGEST_URL, { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + env.CC_INGEST_TOKEN }, body: JSON.stringify({ type: "security_check.unsubscribe", email: info.e, at: nowIso() }) }).catch(() => {});
  }
  return html(page("<h2>You're unsubscribed</h2><p>No more Security Check follow-ups will be sent to <b>" + esc(maskEmail(info.e)) + "</b>." + (!liveFor(env, info.e) ? " (Dry-run: recorded in the Worker only.)" : "") + "</p>"), 200);
}
const page = (b) => "<!doctype html><meta charset=utf-8><meta name=viewport content=\"width=device-width,initial-scale=1\"><meta name=robots content=noindex><title>Unsubscribe</title><div style=\"max-width:520px;margin:60px auto;font:16px/1.6 -apple-system,sans-serif;color:#051C2C;padding:0 20px\">" + b + "</div>";

// ---------- Stripe ----------
async function verifyStripe(env, raw, sigHeader) {
  if (!env.STRIPE_WEBHOOK_SECRET || !sigHeader) return false;
  const parts = Object.fromEntries(sigHeader.split(",").map((kv) => kv.split("=")).filter((x) => x.length === 2 && x[0] === "t"));
  const v1s = sigHeader.split(",").filter((kv) => kv.startsWith("v1=")).map((kv) => kv.slice(3));
  const ts = Number(parts.t);
  if (!ts || Math.abs(Date.now() / 1000 - ts) > 300) return false;
  const expected = hex(await hmac(env.STRIPE_WEBHOOK_SECRET, ts + "." + raw));
  return v1s.some((v) => safeEq(v, expected));
}
async function handleStripe(req, env, ctx, testMode) {
  const raw = await req.text();
  if (!testMode && !(await verifyStripe(env, raw, req.headers.get("Stripe-Signature")))) return json({ ok: false, error: "bad_signature" }, 400);
  let ev; try { ev = JSON.parse(raw); } catch { return json({ ok: false }, 400); }
  if (ev.type !== "checkout.session.completed") return json({ ok: true, ignored: ev.type });
  const s = ev.data && ev.data.object;
  if (!s || !isFixlistSession(env, s)) return json({ ok: true, ignored: "offer not fixlist" });
  if (s.payment_status && s.payment_status !== "paid") return json({ ok: true, ignored: "payment_status " + s.payment_status });
  const sid = String(s.id || "");
  if (!/^cs_(test|live)_[A-Za-z0-9]+$/.test(sid)) return json({ ok: false, error: "bad_session" }, 400);
  if (await env.SC.get("stripe:" + sid)) return json({ ok: true, duplicate: true });
  await env.SC.put("stripe:" + sid, nowIso(), { expirationTtl: 60 * 60 * 24 * 400 });
  const ref = cleanRef(s.client_reference_id);
  let sub = /^r[0-9a-f]{24}$/.test(ref) ? await env.SC.get("sub:" + ref, "json") : null;
  let matchedBy = sub ? "client_reference_id" : null;
  const buyer = checkoutEmail(s);
  let reason = sub ? null : "no_match";
  let multiAlert = null;
  if (!sub && buyer) {
    const m = await resultForEmail(env, buyer);
    if (m.sub && (!m.multiple || multiMatchPolicy(env) === "latest_and_alert")) { sub = m.sub; matchedBy = m.multiple ? "checkout_email_latest_of_" + m.count : "checkout_email"; reason = null; if (m.multiple) multiAlert = m; }
    else reason = m.multiple ? "multiple_matches" : m.reason;
  }
  if (!sub) return await handleOrphan(env, ctx, s, sid, ref, buyer, testMode, reason);
  if (multiAlert) {
    // Several results, all owned by the checkout email: deliver the latest (below) and tell admin@ to check it.
    const rec = { session: sid, reason: "multiple_matches_delivered_latest", delivered: sub.result_id, candidates: multiAlert.ids, ref, email: buyer, amount: (s.amount_total || 0) / 100, currency: s.currency || null, at: nowIso() };
    const w = sendOrphanAlert(env, rec, testMode);
    if (testMode) await w; else ctx.waitUntil(w);
  }
  sub.matched_by = matchedBy;
  const rid = sub.result_id;
  const dry = !liveFor(env, sub.email);
  if (dry && !testMode) await env.SC.put("held:" + sid, raw, { expirationTtl: 60 * 60 * 24 * 60 }); // real payment held by the client lock: replay once live
  if (testMode && !/^cs_test_/.test(sid)) return json({ ok: false, error: "test path takes cs_test_ sessions only" }, 400);
  const p = runFixlistPipeline(env, sub, s, dry);
  if (testMode || dry) return json({ ok: true, dryRun: dry, resultId: rid, log: await p, previews: { fixListPage: (await links(env, sub)).fixlist_page, email: env.PUBLIC_BASE + "/preview/email?kind=fixlist&rid=" + rid + "&t=" + (await sign(env, "p:" + rid)) } });
  ctx.waitUntil(p);
  return json({ ok: true });
}
// Fix List offer check. Primary: Payment Link metadata copied to the session (offer=fixlist; verified read-only on
// plink_1US9EnQ1Ll6EnCUKqtFqIhCG and its sessions, 20 Oct 2026). Backup if metadata is ever missing: payment link id + 3900 USD.
function isFixlistSession(env, s) {
  if (s.metadata && s.metadata.offer === "fixlist") return true;
  const plink = env.FIXLIST_PAYMENT_LINK_ID;
  return !!plink && s.payment_link === plink && s.amount_total === 3900 && String(s.currency || "").toLowerCase() === "usd";
}
// client_reference_id allowlist: a result id (r + 24 hex) or a site fallback code (scfb1_...). Anything else is dropped, never echoed.
function cleanRef(v) { const x = String(v || ""); return /^r[0-9a-f]{24}$/.test(x) || /^scfb1_[0-9x]{3}_[a-dnx]{1,30}_[0-9a-f]{8}$/.test(x) ? x : x ? "(invalid)" : ""; }
function checkoutEmail(s) {
  const e = String((s.customer_details && s.customer_details.email) || s.customer_email || "").trim().toLowerCase();
  return e.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : "";
}
// Result for the checkout email, by exact match (trimmed, lowercased) on the email stored with the result. KV only: no Notion, no CRM Contacts.
// Lookup: hashed index first, then the legacy plaintext "email:" key (written by /submit before this change, expires within 730 days).
// Only results whose stored email equals the checkout email count. "Multiple" = the email has retaken the check, or the two index keys
// point at different results. Delivery always goes to sub.email, the email that owns the result.
async function resultForEmail(env, email) {
  const ids = new Set();
  for (const k of [await emailKey(env, email), "email:" + email]) { const v = await env.SC.get(k); if (v && /^r[0-9a-f]{24}$/.test(v)) ids.add(v); }
  const subs = [];
  for (const id of ids) { const x = await env.SC.get("sub:" + id, "json"); if (x && String(x.email || "").trim().toLowerCase() === email) subs.push(x); }
  if (!subs.length) return { reason: "no_match" };
  subs.sort((a, b) => String(b.submitted_at || "").localeCompare(String(a.submitted_at || "")));
  const count = Math.max(subs.length, 1 + Math.max(...subs.map((x) => x.retake_count || 0)));
  return { sub: subs[0], multiple: count > 1, count, ids: subs.map((x) => x.result_id) };
}
// Several matches (all owned by the checkout email): "latest_and_alert" (default, L0_CEO 20 Oct) delivers the latest result and alerts admin@;
// "alert_only" delivers nothing and alerts. Zero matches is always alert-only. One-line revert: set MULTI_MATCH_POLICY = "alert_only".
const MULTI_MATCH_POLICY_DEFAULT = "latest_and_alert";
const multiMatchPolicy = (env) => (env.MULTI_MATCH_POLICY === "alert_only" || env.MULTI_MATCH_POLICY === "latest_and_alert" ? env.MULTI_MATCH_POLICY : MULTI_MATCH_POLICY_DEFAULT);
// No result delivered: keep the record and alert admin@ by Resend. Always 200 so Stripe stops retrying.
async function handleOrphan(env, ctx, s, sid, ref, buyer, testMode, reason) {
  const rec = { session: sid, reason: reason || "no_match", ref, email: buyer || null, amount: (s.amount_total || 0) / 100, currency: s.currency || null, at: nowIso() };
  await env.SC.put("orphan:" + sid, JSON.stringify(rec), { expirationTtl: 60 * 60 * 24 * 400 });
  const work = sendOrphanAlert(env, rec, testMode);
  if (testMode) return json({ ok: true, orphan: true, alert: await work });
  ctx.waitUntil(work);
  return json({ ok: true, orphan: true });
}
// Admin alert (admin@ only, existing sending-only Resend key, never throws). Result stored on "orphan:<sid>".
async function sendOrphanAlert(env, rec, testMode) {
  const payload = orphanPayload(env, rec);
  const out = {};
  try {
    if (testMode || isDry(env) || !env.RESEND_API_KEY) out.alert = { dry: true, to: payload.to, subject: payload.subject };
    else if (env.INTERNAL_NOTIFY === "off") out.alert = { skipped: "INTERNAL_NOTIFY=off" };
    else out.alert = { resendId: await resendSend(env, payload, "orphan-alert:" + rec.session) };
  } catch (e) { out.alert = { error: String(e.message || e).slice(0, 200) }; }
  try { await env.SC.put("orphan:" + rec.session, JSON.stringify({ ...rec, alert: out }), { expirationTtl: 60 * 60 * 24 * 400 }); } catch (e) { out.kv = "error"; }
  return out;
}
function orphanPayload(env, rec) {
  const delivered = rec.reason === "multiple_matches_delivered_latest";
  const lines = [
    delivered ? "A Fix List payment matched " + rec.candidates.length + "+ Security Check results for the checkout email (all owned by that email). The latest (" + rec.delivered + ") was delivered automatically. Please check it is the right one: website-ops/resilience/stripe-fixlist-runbook.md"
      : rec.reason === "multiple_matches" ? "A Fix List payment matched more than one Security Check result for the checkout email. Nothing was sent (MULTI_MATCH_POLICY=alert_only). Pick the right result and deliver by hand: website-ops/resilience/stripe-fixlist-runbook.md"
      : "A Fix List payment did not match any Security Check result. Nothing was sent. Deliver it by hand: website-ops/resilience/stripe-fixlist-runbook.md",
    "Reason: " + rec.reason, "Stripe session: " + rec.session, "Amount: " + rec.amount + " " + String(rec.currency || "").toUpperCase(),
    "Checkout email: " + (rec.email || "n/a"), "client_reference_id: " + (rec.ref || "none") + (/^scfb1_/.test(rec.ref) ? " (site fallback answer code, decode with the runbook)" : ""),
    ...(rec.candidates ? ["Matching results: " + rec.candidates.join(", ")] : []), "At: " + rec.at,
  ];
  const suffix = delivered ? "delivered latest, please check" : rec.reason === "multiple_matches" ? "multiple matches, not delivered" : "no match, not delivered";
  return { from: env.MAIL_FROM, to: [env.INTERNAL_NOTIFY_TO || "admin@anthonytoday.com"], subject: "[ORPHAN $39] " + suffix + " " + rec.session.slice(0, 20), text: lines.join("\n") + "\n",
    tags: [{ name: "flow", value: "security_check_internal" }, { name: "owner", value: "website_ops" }] };
}
async function runFixlistPipeline(env, sub, s, dry) {
  const log = [];
  const step = async (name, fn) => { try { const res = await fn(); log.push({ step: name, ok: true, ...(res || {}) }); return res; } catch (e) { log.push({ step: name, ok: false, error: String(e.message || e).slice(0, 300) }); return null; } };
  sub.paid = true; sub.paid_at = nowIso(); sub.stripe_session = s.id; sub.amount_paid = (s.amount_total || 0) / 100;
  await env.SC.put("sub:" + sub.result_id, JSON.stringify(sub), { expirationTtl: 60 * 60 * 24 * 730 });
  const L = await links(env, sub);
  sub.result = score(data, sub.answers, sub.team_size); // current bands
  const T = computeTokens(data, sub, sub.result, L, "fixlist");
  const notion = env.NOTION_TOKEN ? new Notion(env.NOTION_TOKEN) : null;
  let fixUrl = L.fixlist_page, viewsLog = null;
  await step("notion_fixlist_page", async () => {
    const tpl = await templateBlocks(env, "fix");
    const blocks = withFooter(transform(tpl.blocks, T));
    const rows = actionRows(data, sub.result, sub.paid_at, sub.plan);
    if (dry || !notion) return { dry: true, template: tpl.source, blocks: blocks.length, actionRows: rows.length };
    const pg = await notion.call("POST", "/pages", { parent: { page_id: env.NOTION_RESULTS_PARENT_ID }, icon: { type: "emoji", emoji: "🛡️" }, properties: { title: { title: [{ type: "text", text: { content: "Fix List: " + sub.company + " (" + sub.submission_id + ")" } }] } } });
    await writeTree(notion, pg.id, blocks, { actionDb: async (parentId) => {
      const tds = await notion.call("GET", "/data_sources/" + env.NOTION_FIXLIST_ACTION_DS_ID);
      const props = {};
      for (const [k, v] of Object.entries(tds.properties)) { const t = v.type; if (t === "relation" || t === "rollup" || t === "formula") continue; props[k] = { [t]: t === "select" ? { options: v.select.options.map((o) => ({ name: o.name, color: o.color })) } : {} }; }
      const db = await notion.call("POST", "/databases", { parent: { type: "page_id", page_id: parentId }, is_inline: true, title: [{ type: "text", text: { content: "Top 3 Risk Fixes" } }], initial_data_source: { properties: props } });
      const ds = db.data_sources[0].id;
      for (const x of rows) await notion.call("POST", "/pages", { parent: { type: "data_source_id", data_source_id: ds }, properties: {
        Action: { title: [{ type: "text", text: { content: x.action } }] }, Impact: { rich_text: x.impact ? [{ type: "text", text: { content: x.impact } }] : [] }, Domain: { select: { name: x.domain } }, Phase: { select: { name: x.phase } },
        Priority: { select: { name: x.priority } }, ...(x.owner ? { "Owner Role": { select: { name: x.owner } } } : {}), ...(x.start ? { Start: { date: { start: x.start } }, End: { date: { start: x.end } } } : {}) },
        children: [{ type: "heading_2", heading_2: { rich_text: [{ type: "text", text: { content: "How" } }] } }, { type: "paragraph", paragraph: { rich_text: [{ type: "text", text: { content: x.how } }] } },
          ...(x.planNote ? [{ type: "paragraph", paragraph: { rich_text: [{ type: "text", text: { content: "Plan note: " + x.planNote } }] } }] : []),
          ...(x.source ? [{ type: "paragraph", paragraph: { rich_text: [{ type: "text", text: { content: "Source: Notion help", link: { url: x.source } } }] } }] : [])] });
      // Views do not carry over (new database = one default table view). Recreate the template's 3 views via the Views API.
      try { viewsLog = await recreateViews(env, db.id, ds); } catch (e) { viewsLog = { ok: false, error: String(e.message).slice(0, 200) }; }
    } });
    sub.notion_fixlist_page = pg.url;
    return { pageUrl: pg.url, actionRows: rows.length, views: viewsLog };
  });
  await step("notion_leads_paid", async () => {
    if (dry || !notion || !env.NOTION_CRM_DB_ID) return { dry: true, set: { "Fix List Paid": true, "Stripe Session": s.id, Stage: "Fix List paid" } };
    const lead = await notion.findLead(env.NOTION_CRM_DB_ID, sub.email);
    if (!lead) throw new Error("lead not found for paid result");
    await notion.call("PATCH", "/pages/" + lead.id, { properties: paidProperties(s.id) });
    return { leadPage: lead.id };
  });
  await step("resend_fixlist_email", async () => {
    const msg = buildFixlistEmail({ ...T, fixlist_url: fixUrl });
    const payload = emailPayload(env, { to: sub.email, msg, flow: "fixlist_delivery" });
    await env.SC.put("fix:" + sub.result_id, JSON.stringify(payload), { expirationTtl: 7 * 86400 });
    if (dry || !env.RESEND_API_KEY) return { dry: true, subject: msg.subject, to: sub.email, tags: payload.tags };
    if ((await resendSuppressed(env.RESEND_API_KEY, sub.email)) === true) return { skipped: "resend suppression (transactional not sent; alert)" };
    const id = await resendSend(env, payload, "sc-fixlist-" + s.id);
    sub.resend_fixlist_id = id;
    return { resendId: id, tags: payload.tags };
  });
  await step("command_center_paid", async () => {
    if (dry || !env.CC_INGEST_URL) return { dry: true };
    const res = await fetch(env.CC_INGEST_URL, { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + env.CC_INGEST_TOKEN }, body: JSON.stringify({ type: "security_check.paid", result_id: sub.result_id, email: sub.email, stripe_session: s.id, amount: sub.amount_paid, paid_at: sub.paid_at }) });
    return { status: res.status };
  });
  await step("internal_notify", () => notifyInternal(env, "fixlist", { ...sub, held: dry }, sub.result, L, "sc-int-fix-" + s.id));
  await env.SC.put("sub:" + sub.result_id, JSON.stringify({ ...sub, fixlog: log }), { expirationTtl: 60 * 60 * 24 * 730 });
  return log;
}

// Template views of the Fix List action DB (66ef028b...): By Prio, Timeline, By Phase. Views API needs Notion-Version 2026-03-11.
async function recreateViews(env, dbId, dsId) {
  const v = new Notion(env.NOTION_TOKEN, "2026-03-11");
  const dsx = await v.call("GET", "/data_sources/" + dsId);
  const id = (n) => dsx.properties[n].id;
  const vis = (names) => names.map((n) => ({ property_id: id(n), visible: true }));
  const group = (n) => ({ type: "select", property_id: id(n), sort: { type: "manual" }, hide_empty_groups: true });
  const specs = [
    { name: "By Prio", type: "table", sorts: [{ property: "Start", direction: "ascending" }], configuration: { type: "table", properties: vis(["Action", "Domain", "Phase", "Owner Role", "Impact", "Status"]), group_by: group("Priority") } },
    { name: "Timeline", type: "timeline", sorts: [{ property: "Priority", direction: "ascending" }], configuration: { type: "timeline", date_property_id: id("Start"), end_date_property_id: id("End"), properties: vis(["Action", "Domain", "Owner Role", "Status"]), show_table: false } },
    { name: "By Phase", type: "table", sorts: [{ property: "Priority", direction: "ascending" }], configuration: { type: "table", properties: vis(["Action", "Domain", "Priority", "Owner Role", "Start", "End", "Status"]), group_by: group("Phase") } },
  ];
  const existing = await v.call("GET", "/views?database_id=" + dbId);
  const def = existing.results && existing.results[0];
  const made = [];
  if (def) { await v.call("PATCH", "/views/" + def.id, { name: specs[0].name, sorts: specs[0].sorts, configuration: specs[0].configuration }); made.push(specs[0].name + " (default view updated)"); }
  for (const sp of def ? specs.slice(1) : specs) { await v.call("POST", "/views", { database_id: dbId, data_source_id: dsId, ...sp }); made.push(sp.name); }
  return { ok: true, views: made };
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const h = cors(env, req);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: h });
    try {
      if (url.pathname === "/" || url.pathname === "/health") return json({ service: "security-check-api", version: data.version, dryRun: isDry(env), liveFor: isDry(env) ? "none" : locked(env) ? "allowlist" : "all", notion: !!env.NOTION_TOKEN, resend: !!env.RESEND_API_KEY, stripe: !!env.STRIPE_WEBHOOK_SECRET, leadsDb: !!env.NOTION_CRM_DB_ID });
      if (url.pathname === "/submit" && req.method === "POST") return await handleSubmit(req, env, ctx, h);
      if (url.pathname === "/industry" && req.method === "POST") return await handleIndustry(req, env, h);
      if (url.pathname === "/unsubscribe" && (req.method === "GET" || req.method === "POST")) return await handleUnsubscribe(req, env, url);
      if (url.pathname === "/stripe-webhook" && req.method === "POST") return await handleStripe(req, env, ctx, false);
      if (url.pathname === "/test/stripe-event" && req.method === "POST") {
        if (!testPhase(env) || !env.TEST_TOKEN || !safeEq(req.headers.get("X-Test-Token") || "", env.TEST_TOKEN)) return json({ ok: false }, 403);
        return await handleStripe(req, env, ctx, true);
      }
      if (url.pathname === "/preview/email" && req.method === "GET") return await handlePreviewEmail(env, url);
      if (url.pathname === "/admin/replay-held" && req.method === "POST") {
        if (!env.TEST_TOKEN || !safeEq(req.headers.get("X-Test-Token") || "", env.TEST_TOKEN)) return json({ ok: false }, 403);
        return await replayHeld(env);
      }
      const m = url.pathname.match(/^\/(r|f)\/([a-z0-9]+)$/);
      if (m && req.method === "GET") return await handleResultPage(env, m[2], url.searchParams.get("t"), m[1] === "r" ? "free" : "fix");
      return json({ ok: false, error: "not_found" }, 404, h);
    } catch (e) {
      console.error(e && e.stack);
      return json({ ok: false, error: "server_error" }, 500, h);
    }
  },
};
