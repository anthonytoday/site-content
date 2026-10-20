// P1-06 tests: hashed eh: index is read first with the plaintext email: fallback; new writes go to eh: only; email: is never deleted.
// Run: ESBUILD=<path to esbuild> node test/p106.test.mjs  (no network: fetch is stubbed)
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import data from "../src/quiz-data.json" with { type: "json" };
import { worker, baseEnv, ctx, t, results, eh, seed, post, session, SIGNING_KEY } from "./harness.mjs";

const LIVE = { DRY_RUN: "0", LIVE_FOR: "all", RESEND_API_KEY: "re_test_only", UNSUB_SHARED_SYNC: "0" };
async function submit(env, email) {
  const body = { name: "Jo", company: "Co", email, team_size: "5-10", role: "owner", plan: data.profile.plan[0].value, country: data.profile.country[0].value ?? data.profile.country[0], consent: true,
    answers: Object.fromEntries(data.questions.map((q) => [q.id, "B"])) };
  const c = ctx();
  const res = await worker.fetch(new Request("https://w.example/submit", { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json", Origin: "https://www.anthonytoday.com", "CF-Connecting-IP": "7.7.7." + Math.floor(Math.random() * 200) } }), env, c);
  await Promise.allSettled(c.w); assert.equal(res.status, 200); return (await res.json()).resultId;
}
const legacyRecord = (env, email, rid) => { env.SC.m.delete(eh(email)); env.SC.m.set("email:" + email, rid); };
const b64u = (s) => Buffer.from(s).toString("base64url");
const legacyToken = (email, rid) => { const p = b64u(JSON.stringify({ e: email, r: rid })); return p + "." + createHmac("sha256", SIGNING_KEY).update("u:" + p).digest("base64url").slice(0, 32); };
const unsub = (env, tok, method) => worker.fetch(new Request("https://w.example/unsubscribe?token=" + tok, { method }), env, ctx());
const sub = (env, rid) => JSON.parse(env.SC.m.get("sub:" + rid));

await t("submit writes the eh: index only: no email: key, no index key contains an email", async () => {
  const env = baseEnv(); const rid = await submit(env, "  New.Person@Example.COM ");
  assert.equal(env.SC.m.get(eh("new.person@example.com")), rid, "eh: key on the trimmed, lowercased email");
  assert.ok(![...env.SC.m.keys()].some((k) => k.startsWith("email:")), "no plaintext email: key");
  assert.ok(![...env.SC.m.keys()].some((k) => (k.startsWith("eh:") || k.startsWith("sub:")) && k.includes("@")));
});
await t("retake of a legacy-only record: prev found via the email: fallback, retake_count 1, unsubscribed carried over, new write eh: only, email: untouched", async () => {
  const env = baseEnv(); const old = await submit(env, "legacy@example.com"); legacyRecord(env, "legacy@example.com", old);
  const s = sub(env, old); s.unsubscribed = true; env.SC.m.set("sub:" + old, JSON.stringify(s));
  const rid = await submit(env, "legacy@example.com");
  assert.equal(sub(env, rid).retake_count, 1); assert.equal(sub(env, rid).unsubscribed, true);
  assert.equal(env.SC.m.get(eh("legacy@example.com")), rid);
  assert.equal(env.SC.m.get("email:legacy@example.com"), old, "legacy key not overwritten and not deleted");
});
await t("eh: wins over email: when both exist and differ", async () => {
  const env = baseEnv(); const a = await submit(env, "both@example.com"); const b = await submit(env, "both@example.com");
  env.SC.m.set("email:both@example.com", a); assert.equal(env.SC.m.get(eh("both@example.com")), b);
  const c = await submit(env, "both@example.com");
  assert.equal(sub(env, c).retake_count, 2, "prev = b (from eh:), whose retake_count is 1");
});
await t("a malformed eh: value is ignored and the legacy email: value is used", async () => {
  const env = baseEnv(); const old = await submit(env, "odd@example.com"); legacyRecord(env, "odd@example.com", old);
  env.SC.m.set(eh("odd@example.com"), "not-a-rid");
  const rid = await submit(env, "odd@example.com"); assert.equal(sub(env, rid).retake_count, 1);
});
await t("a malformed legacy email: value is ignored (fresh result, retake_count 0)", async () => {
  const env = baseEnv(); env.SC.m.set("email:junk@example.com", "<script>");
  const rid = await submit(env, "junk@example.com"); assert.equal(sub(env, rid).retake_count, 0);
});
await t("unsubscribe of a legacy-only record marks that result unsubscribed (email: fallback) and writes no email: key", async () => {
  const env = baseEnv(LIVE); const old = await submit(env, "gone@example.com"); legacyRecord(env, "gone@example.com", old);
  const before = env.SC.m.get("email:gone@example.com");
  const r = await unsub(env, legacyToken("gone@example.com", "r" + "0".repeat(24)), "POST"); assert.equal(r.status, 200);
  assert.equal(sub(env, old).unsubscribed, true, "found through the fallback, not through the token's rid");
  assert.equal(env.SC.m.get("email:gone@example.com"), before); assert.equal(env.SC.m.get(eh("gone@example.com")), undefined, "unsubscribe does not backfill");
});
await t("unsubscribe after the hashed record exists uses eh:", async () => {
  const env = baseEnv(LIVE); const rid = await submit(env, "hashed@example.com");
  const r = await unsub(env, legacyToken("hashed@example.com", "r" + "0".repeat(24)), "POST"); assert.equal(r.status, 200);
  assert.equal(sub(env, rid).unsubscribed, true);
});
await t("backfilled record (eh: copied from email:, same value) behaves the same as the legacy one for the webhook", async () => {
  const env = baseEnv(); const rid = await seed(env, "copied@example.com", { legacy: true });
  env.SC.m.set(eh("copied@example.com"), env.SC.m.get("email:copied@example.com"));
  const r = await post(env, session({ customer_details: { email: "copied@example.com" } })); assert.equal(r.j.resultId, rid);
  assert.equal(env.SC.m.get("orphan:" + r.j.session), undefined);
});
await t("no code path deletes an email: key (submit, unsubscribe, webhook)", async () => {
  const env = baseEnv(LIVE); const old = await submit(env, "keep@example.com"); legacyRecord(env, "keep@example.com", old);
  const del = env.SC.delete; const deleted = []; env.SC.delete = async (k) => { deleted.push(k); return del(k); };
  await submit(env, "keep@example.com"); await unsub(env, legacyToken("keep@example.com", old), "POST");
  await post(env, session({ customer_details: { email: "keep@example.com" } }));
  assert.ok(!deleted.some((k) => k.startsWith("email:"))); assert.ok(env.SC.m.has("email:keep@example.com"));
});

// P106-01 owner check: Security edge cases E3-E6 (p106-sec-edge.test.mjs on 2cc7459), assertions flipped to the fixed behaviour.
const rid = (n) => "r" + String(n).padStart(24, "0");
const putSub = (env, id, email, extra = {}) => env.SC.m.set("sub:" + id, JSON.stringify({ result_id: id, email, retake_count: 4, result: { total: 77 }, unsubscribed: false, ...extra }));
await t("E3 eh: present but its sub: missing -> the legacy email: record (owned) is used: retake 5, unsubscribed carried", async () => {
  const env = baseEnv(); env.SC.m.set(eh("ghost@example.com"), rid(7)); env.SC.m.set("email:ghost@example.com", rid(8)); putSub(env, rid(8), "ghost@example.com", { unsubscribed: true });
  const s = sub(env, await submit(env, "ghost@example.com"));
  assert.equal(s.retake_count, 5); assert.equal(s.previous_total, 77); assert.equal(s.unsubscribed, true);
});
await t("E4 email: fallback pointing at ANOTHER address's result is rejected in /submit (no previous_total, retake 0, no unsubscribed carry)", async () => {
  const env = baseEnv(); env.SC.m.set("email:victim@example.com", rid(9)); putSub(env, rid(9), "other@example.org", { unsubscribed: true });
  const s = sub(env, await submit(env, "victim@example.com"));
  assert.equal(s.previous_total, null); assert.equal(s.retake_count, 0); assert.equal(s.unsubscribed, false);
});
await t("E5 eh: pointing at ANOTHER address's result is rejected in /submit", async () => {
  const env = baseEnv(); env.SC.m.set(eh("victim2@example.com"), rid(10)); putSub(env, rid(10), "other@example.org");
  const s = sub(env, await submit(env, "victim2@example.com")); assert.equal(s.previous_total, null); assert.equal(s.retake_count, 0);
});
await t("E6 unsubscribe: email: fallback pointing at another address's result does NOT mark it unsubscribed", async () => {
  const env = baseEnv(LIVE); env.SC.m.set("email:u@example.com", rid(11)); putSub(env, rid(11), "other@example.org");
  const r = await unsub(env, legacyToken("u@example.com", rid(0)), "POST"); assert.equal(r.status, 200);
  assert.equal(sub(env, rid(11)).unsubscribed, false); assert.ok(env.SC.m.get("unsub:u@example.com"), "the address itself is still unsubscribed");
});
await t("owner check: eh: owned by another address, legacy email: owned -> legacy used (next key tried)", async () => {
  const env = baseEnv(); env.SC.m.set(eh("next@example.com"), rid(12)); putSub(env, rid(12), "other@example.org");
  env.SC.m.set("email:next@example.com", rid(13)); putSub(env, rid(13), " NEXT@example.com ");
  const s = sub(env, await submit(env, "next@example.com")); assert.equal(s.retake_count, 5);
});
console.log(results.n + " passed");
