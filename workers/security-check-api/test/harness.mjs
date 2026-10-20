// Shared test harness: bundles src/index.js with esbuild, fake KV, stubbed fetch, Stripe signatures.
import { execFileSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import data from "../src/quiz-data.json" with { type: "json" };

const here = dirname(fileURLToPath(import.meta.url));
const ESBUILD = process.env.ESBUILD || "esbuild";
const out = join(mkdtempSync(join(tmpdir(), "scwh-")), "worker.mjs");
execFileSync(ESBUILD, [join(here, "../src/index.js"), "--bundle", "--format=esm", "--platform=neutral", "--loader:.html=text", "--loader:.txt=text", "--outfile=" + out], { stdio: "pipe" });
export const worker = (await import(out)).default;

export const SECRET = "whsec_test_only", SIGNING_KEY = "test-signing-key";
export const kv = () => { const m = new Map(); return { m, get: async (k, t) => { const v = m.get(k); return v == null ? null : t === "json" ? JSON.parse(v) : v; }, put: async (k, v) => { m.set(k, v); }, delete: async (k) => { m.delete(k); } }; };
export const baseEnv = (extra = {}) => ({ SC: kv(), ALLOWED_ORIGINS: "https://www.anthonytoday.com", STRIPE_WEBHOOK_SECRET: SECRET, SIGNING_KEY, DRY_RUN: "1", PUBLIC_BASE: "https://w.example", MAIL_FROM: "A <admin@anthonytoday.com>",
  FIXLIST_PAYMENT_LINK: "https://buy.stripe.com/28E6oJfmMbYh27h4Kt1ZS0x", FIXLIST_PAYMENT_LINK_ID: "plink_1US9EnQ1Ll6EnCUKqtFqIhCG", ...extra });
export const calls = [];
globalThis.fetch = async (url, init = {}) => { calls.push({ url: String(url), body: init.body ? String(init.body) : "" }); if (/^https:\/\/api\.resend\.com\/suppressions\//.test(String(url))) return new Response("{}", { status: 404 }); return new Response(JSON.stringify({ id: "re_fake", results: [], object: "list" }), { status: 200, headers: { "Content-Type": "application/json" } }); };
export const ctx = () => { const w = []; return { w, waitUntil: (p) => w.push(p), passThroughOnException() {} }; };
export const sig = (raw, secret = SECRET, t = Math.floor(Date.now() / 1000)) => "t=" + t + ",v1=" + createHmac("sha256", secret).update(t + "." + raw).digest("hex");
export const eh = (email) => "eh:" + createHmac("sha256", SIGNING_KEY).update("eh:" + email).digest("base64url");
export const session = (o = {}) => ({ id: "cs_live_" + Math.random().toString(36).slice(2, 12), object: "checkout.session", payment_status: "paid", amount_total: 3900, currency: "usd",
  payment_link: "plink_1US9EnQ1Ll6EnCUKqtFqIhCG", metadata: { offer: "fixlist", funnel: "security_check", channel: "site" }, customer_details: { email: "buyer@example.com" }, ...o });
export async function post(env, s, sigOverride) {
  const raw = JSON.stringify({ id: "evt_1", type: "checkout.session.completed", data: { object: s } });
  const c = ctx();
  const res = await worker.fetch(new Request("https://w.example/stripe-webhook", { method: "POST", body: raw, headers: { "Stripe-Signature": sigOverride ?? sig(raw), "Content-Type": "application/json" } }), env, c);
  await Promise.allSettled(c.w);
  return { status: res.status, j: await res.json() };
}

export let RID = "";
// Seed through the real /submit path (dry run), so the hashed eh: index write is exercised too.
export async function seed(env, email, opts = {}) {
  const body = { name: "Test", company: "TestCo", email, team_size: "5-10", role: "owner", plan: data.profile.plan[0].value, country: data.profile.country[0].value ?? data.profile.country[0], consent: true,
    answers: Object.fromEntries(data.questions.map((q) => [q.id, "B"])) };
  const res = await worker.fetch(new Request("https://w.example/submit", { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json", Origin: "https://www.anthonytoday.com", "CF-Connecting-IP": "1.2.3." + Math.floor(Math.random() * 200) } }), env, ctx());
  const j = await res.json(); assert.equal(res.status, 200, "submit " + JSON.stringify(j).slice(0, 200));
  RID = j.resultId;
  assert.equal(env.SC.m.get(eh(email)), RID, "hashed email index written on submit");
  assert.ok(![...env.SC.m.keys()].some((k) => k.startsWith("eh:") && k.includes("@")), "hashed key has no email");
  assert.equal(env.SC.m.get("email:" + email), undefined, "P1-06: submit writes no plaintext email: key");
  // Legacy = a record from before the hashed index (P1-06): only the plaintext email: key exists.
  if (opts.legacy) { env.SC.m.delete(eh(email)); env.SC.m.set("email:" + email, RID); }
  return RID;
}
export const results = { n: 0 };
export const t = async (name, fn) => { try { await fn(); results.n++; console.log("PASS", name); } catch (e) { console.log("FAIL", name, "\n ", e.message); process.exitCode = 1; } };
