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

async function links(env, sub) {
  const base = env.PUBLIC_BASE;
  const t = await sign(env, "r:" + sub.result_id);
  const ut = b64uStr(JSON.stringify({ e: sub.email, r: sub.result_id }));
  return {
    result: base + "/r/" + sub.result_id + "?t=" + t,
    fixlist_page: base + "/f/" + sub.result_id + "?t=" + (await sign(env, "f:" + sub.result_id)),
    fixlist: env.FIXLIST_PAYMENT_LINK + "?client_reference_id=" + sub.result_id,
    unsub: base + "/unsubscribe?token=" + ut + "." + (await sign(env, "u:" + ut)),
    maturity_base: env.MATURITY_IMG_BASE || "https://www.anthonytoday.com",
  };
}

async function templateBlocks(env, kind) {
  const id = kind === "free" ? env.NOTION_FREE_RESULT_TEMPLATE_ID : env.NOTION_FIXLIST_TEMPLATE_ID;
  if (!env.NOTION_TOKEN || !id) return { blocks: kind === "free" ? freeSnapshot : fixSnapshot, source: "snapshot (19 Oct 2026, 9:45 am UAE)" };
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
    const msg = buildResultEmail(T);
    const payload = emailPayload(env, { to: sub.email, msg, flow: "security_check_result", unsubUrl: L.unsub });
    await env.SC.put("mail:" + sub.result_id, JSON.stringify(payload), { expirationTtl: (sub.held ? 60 : 7) * 86400 });
    if (!sub.consent) return { skipped: "no consent" };
    if (sub.unsubscribed) return { skipped: "unsubscribed" };
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
  const token = url.searchParams.get("token") || "";
  const [p, s] = token.split(".");
  if (!p || !s || !safeEq(s, await sign(env, "u:" + p))) return html(page("<p>This link is not valid. Reply \"unsubscribe\" to the email and I will stop follow-ups.</p>"), 400);
  let info; try { info = JSON.parse(unb64u(p)); } catch { return html(page("<p>This link is not valid.</p>"), 400); }
  if (req.method === "GET") return html(page("<h2>Unsubscribe</h2><p>Stop Security Check follow-up emails to <b>" + esc(info.e) + "</b>?</p><form method=\"post\" action=\"/unsubscribe?token=" + esc(token) + "\"><button style=\"padding:10px 18px;font-size:15px\">Confirm unsubscribe</button></form>"));
  const log = [];
  const rid = await env.SC.get("email:" + info.e);
  for (const id of new Set([rid, info.r].filter(Boolean))) { const sub = await env.SC.get("sub:" + id, "json"); if (sub) { sub.unsubscribed = true; await env.SC.put("sub:" + id, JSON.stringify(sub), { expirationTtl: 60 * 60 * 24 * 730 }); } }
  await env.SC.put("unsub:" + info.e, nowIso());
  if (liveFor(env, info.e)) {
    if (env.RESEND_API_KEY) log.push(["resend_suppression", await resendSuppress(env.RESEND_API_KEY, info.e).catch(() => false)]);
    if (env.NOTION_TOKEN && env.NOTION_CRM_DB_ID) { try { const n = new Notion(env.NOTION_TOKEN); const lead = await n.findLead(env.NOTION_CRM_DB_ID, info.e); if (lead) await n.call("PATCH", "/pages/" + lead.id, { properties: { "Do Not Email": { checkbox: true } } }); log.push(["leads_do_not_email", !!lead]); } catch (e) { log.push(["leads_do_not_email", false]); } }
    await env.SC.put("unsublog:" + info.e, JSON.stringify({ at: nowIso(), log }), { expirationTtl: 60 * 60 * 24 * 30 });
    if (env.CC_INGEST_URL) await fetch(env.CC_INGEST_URL, { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + env.CC_INGEST_TOKEN }, body: JSON.stringify({ type: "security_check.unsubscribe", email: info.e, at: nowIso() }) }).catch(() => {});
  }
  return html(page("<h2>You're unsubscribed</h2><p>No more Security Check follow-ups will be sent to <b>" + esc(info.e) + "</b>." + (!liveFor(env, info.e) ? " (Dry-run: recorded in the Worker only.)" : "") + "</p>"), 200);
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
  if (!s || !s.metadata || s.metadata.offer !== "fixlist") return json({ ok: true, ignored: "offer not fixlist" });
  if (s.payment_status && s.payment_status !== "paid") return json({ ok: true, ignored: "payment_status " + s.payment_status });
  const sid = String(s.id || "");
  if (!/^cs_(test|live)_[A-Za-z0-9]+$/.test(sid)) return json({ ok: false, error: "bad_session" }, 400);
  if (await env.SC.get("stripe:" + sid)) return json({ ok: true, duplicate: true });
  await env.SC.put("stripe:" + sid, nowIso(), { expirationTtl: 60 * 60 * 24 * 400 });
  const rid = String(s.client_reference_id || "");
  const sub = /^r[0-9a-f]{24}$/.test(rid) ? await env.SC.get("sub:" + rid, "json") : null;
  if (!sub) { await env.SC.put("orphan:" + sid, JSON.stringify({ rid, email: s.customer_details && s.customer_details.email, at: nowIso() })); return json({ ok: true, orphan: true }); }
  const dry = !liveFor(env, sub.email);
  if (dry && !testMode) await env.SC.put("held:" + sid, raw, { expirationTtl: 60 * 60 * 24 * 60 }); // real payment held by the client lock: replay once live
  if (testMode && !/^cs_test_/.test(sid)) return json({ ok: false, error: "test path takes cs_test_ sessions only" }, 400);
  const p = runFixlistPipeline(env, sub, s, dry);
  if (testMode || dry) return json({ ok: true, dryRun: dry, resultId: rid, log: await p, previews: { fixListPage: (await links(env, sub)).fixlist_page, email: env.PUBLIC_BASE + "/preview/email?kind=fixlist&rid=" + rid + "&t=" + (await sign(env, "p:" + rid)) } });
  ctx.waitUntil(p);
  return json({ ok: true });
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
