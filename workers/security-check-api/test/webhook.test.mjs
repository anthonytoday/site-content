// Stripe webhook tests: valid id, missing id + checkout-email match, multiple matches -> alert, no match -> alert, bad signature, offer check.
// Run: ESBUILD=<path to esbuild> node test/webhook.test.mjs  (no network: fetch is stubbed)
import assert from "node:assert/strict";
import * as H from "./harness.mjs";
const { worker, baseEnv, calls, ctx, sig, eh, session, post, seed, t, results, SECRET } = H;

await t("valid client_reference_id matches the result", async () => {
  const env = baseEnv(); const RID = await seed(env, "someone-else@example.com");
  const r = await post(env, session({ client_reference_id: RID }));
  assert.equal(r.status, 200); assert.equal(r.j.resultId, RID); assert.notEqual(r.j.orphan, true);
});
await t("missing client_reference_id + checkout email -> the one result for that email (hashed key)", async () => {
  const env = baseEnv(); const RID = await seed(env, "buyer@example.com");
  const r = await post(env, session({ customer_details: { email: "Buyer@Example.com " } }));
  assert.equal(r.status, 200); assert.equal(r.j.resultId, RID);
  assert.ok(![...env.SC.m.keys()].some((k) => k.startsWith("orphan:")), "no orphan record");
});
await t("site fallback code (scfb1_) + checkout email -> email match", async () => {
  const env = baseEnv(); const RID = await seed(env, "buyer@example.com");
  const r = await post(env, session({ client_reference_id: "scfb1_102_abcdabcdabca_a91e751b" }));
  assert.equal(r.j.resultId, RID);
});
await t("legacy plaintext email: key still matches (pre-deploy results)", async () => {
  const env = baseEnv(); const RID = await seed(env, "buyer@example.com", { legacy: true });
  const r = await post(env, session());
  assert.equal(r.j.resultId, RID);
});
await t("no match -> orphan record + '[ORPHAN $39]' Resend alert to admin@ only, no Command Center event, 200", async () => {
  calls.length = 0;
  const env = baseEnv({ DRY_RUN: "0", LIVE_FOR: "all", RESEND_API_KEY: "re_test_only", CC_INGEST_URL: "https://cc.example/ingest", CC_INGEST_TOKEN: "x" });
  const s = session({ client_reference_id: "scfb1_102_abcdabcdabca_a91e751b", customer_details: { email: "nobody@example.com" } });
  const r = await post(env, s);
  assert.equal(r.status, 200); assert.equal(r.j.orphan, true);
  const mails = calls.filter((c) => c.url === "https://api.resend.com/emails"); assert.equal(mails.length, 1, "exactly one alert");
  const p = JSON.parse(mails[0].body);
  assert.deepEqual(p.to, ["admin@anthonytoday.com"]);
  assert.ok(p.subject.startsWith("[ORPHAN $39] no match, not delivered")); assert.match(p.text, /scfb1_102_abcdabcdabca_a91e751b/); assert.ok(p.text.includes(s.id));
  assert.ok(!calls.some((c) => c.url.startsWith("https://cc.example")), "no Command Center orphan event");
  const rec = JSON.parse(env.SC.m.get("orphan:" + s.id)); assert.ok(rec.alert.alert.resendId); assert.equal(rec.reason, "no_match");
  assert.ok(!calls.some((c) => /@|%40/.test(c.url)), "no email in any URL");
  assert.ok(!calls.some((c) => /notion/i.test(c.url)), "no Notion / CRM lookup");
});
await t("no match with junk client_reference_id -> dropped as (invalid), still alerts, no crash", async () => {
  calls.length = 0;
  const env = baseEnv({ DRY_RUN: "0", LIVE_FOR: "all", RESEND_API_KEY: "re_test_only" });
  const r = await post(env, session({ client_reference_id: "<script>alert(1)</script>", customer_details: null }));
  assert.equal(r.status, 200); assert.equal(r.j.orphan, true);
  const p = JSON.parse(calls.find((c) => c.url === "https://api.resend.com/emails").body);
  assert.ok(!p.text.includes("<script>")); assert.match(p.text, /\(invalid\)/);
});
await t("Resend failure on the alert does not crash the webhook", async () => {
  const env = baseEnv({ DRY_RUN: "0", LIVE_FOR: "all", RESEND_API_KEY: "re_test_only" });
  const orig = globalThis.fetch; globalThis.fetch = async () => new Response("{}", { status: 500 });
  try { const r = await post(env, session({ customer_details: { email: "nobody@example.com" } })); assert.equal(r.status, 200); assert.equal(r.j.orphan, true); } finally { globalThis.fetch = orig; }
});
const MULTI_ENV = { DRY_RUN: "0", LIVE_FOR: "none", TEST_SEND_ALLOWLIST: "", RESEND_API_KEY: "re_test_only", CC_INGEST_URL: "https://cc.example/ingest", CC_INGEST_TOKEN: "x" };
await t("multiple matches (retaken check), default policy -> latest result delivered + '[ORPHAN $39] delivered latest, please check' to admin@", async () => {
  const env = baseEnv(MULTI_ENV);
  const first = await seed(env, "twice@example.com"); await new Promise((r) => setTimeout(r, 5)); const latest = await seed(env, "twice@example.com");
  calls.length = 0;
  const s = session({ customer_details: { email: "twice@example.com" } });
  const r = await post(env, s);
  assert.equal(r.status, 200); assert.notEqual(r.j.orphan, true); assert.equal(r.j.resultId, latest); assert.notEqual(latest, first);
  const alerts = calls.filter((c) => c.url === "https://api.resend.com/emails").map((c) => JSON.parse(c.body)).filter((p) => p.subject.startsWith("[ORPHAN $39]"));
  assert.equal(alerts.length, 1); assert.deepEqual(alerts[0].to, ["admin@anthonytoday.com"]);
  assert.ok(alerts[0].subject.startsWith("[ORPHAN $39] delivered latest, please check"), alerts[0].subject); assert.ok(alerts[0].text.includes(latest));
  assert.equal(JSON.parse(env.SC.m.get("orphan:" + s.id)).reason, "multiple_matches_delivered_latest");
  assert.equal(JSON.parse(env.SC.m.get("sub:" + latest)).matched_by, "checkout_email_latest_of_2");
  assert.ok(!calls.some((c) => c.url.startsWith("https://cc.example") && /orphan_payment/.test(c.body)), "no orphan CC event");
  assert.ok(!calls.some((c) => /notion/i.test(c.url)));
});
await t("multiple matches, MULTI_MATCH_POLICY=alert_only -> nothing delivered, '[ORPHAN $39] multiple matches' alert", async () => {
  const env = baseEnv({ ...MULTI_ENV, MULTI_MATCH_POLICY: "alert_only" });
  await seed(env, "twice@example.com"); await seed(env, "twice@example.com");
  calls.length = 0;
  const s = session({ customer_details: { email: "twice@example.com" } });
  const r = await post(env, s);
  assert.equal(r.j.orphan, true); assert.equal(r.j.resultId, undefined);
  assert.equal(JSON.parse(env.SC.m.get("orphan:" + s.id)).reason, "multiple_matches");
  const mails = calls.filter((c) => c.url === "https://api.resend.com/emails").map((c) => JSON.parse(c.body));
  assert.equal(mails.length, 1, "only the admin alert"); assert.ok(mails[0].subject.startsWith("[ORPHAN $39] multiple matches, not delivered")); assert.deepEqual(mails[0].to, ["admin@anthonytoday.com"]);
});
await t("multiple matches (hashed and legacy keys point at different results) -> the newer one is delivered, alert sent", async () => {
  const env = baseEnv(); const a = await seed(env, "split@example.com");
  const older = JSON.parse(env.SC.m.get("sub:" + a)); older.result_id = "r" + "f".repeat(24); older.submitted_at = "2020-01-01T00:00:00Z"; env.SC.m.set("sub:" + older.result_id, JSON.stringify(older));
  env.SC.m.set("email:split@example.com", older.result_id);
  const s = session({ customer_details: { email: "split@example.com" } });
  const r = await post(env, s); assert.equal(r.j.resultId, a);
  const rec = JSON.parse(env.SC.m.get("orphan:" + s.id)); assert.equal(rec.reason, "multiple_matches_delivered_latest"); assert.deepEqual(rec.candidates, [a, older.result_id]);
});
await t("a result owned by another email is never a candidate, even when an index points at it", async () => {
  const env = baseEnv(); const mine = await seed(env, "buyer2@example.com");
  const other = JSON.parse(env.SC.m.get("sub:" + mine)); other.result_id = "r" + "e".repeat(24); other.email = "someoneelse@example.com"; other.submitted_at = "2099-01-01T00:00:00Z";
  env.SC.m.set("sub:" + other.result_id, JSON.stringify(other)); env.SC.m.set("email:buyer2@example.com", other.result_id);
  const r = await post(env, session({ customer_details: { email: "buyer2@example.com" } }));
  assert.equal(r.j.resultId, mine);
});
await t("email match is exact: stored result email must equal the checkout email", async () => {
  const env = baseEnv(); const rid = await seed(env, "owner@example.com");
  env.SC.m.set(eh("intruder@example.com"), rid); // index points at someone else's result
  const s = session({ customer_details: { email: "intruder@example.com" } });
  const r = await post(env, s); assert.equal(r.j.orphan, true);
  assert.equal(JSON.parse(env.SC.m.get("orphan:" + s.id)).reason, "no_match");
});
await t("bad signature -> 400 bad_signature, nothing stored", async () => {
  const env = baseEnv(); const RID = await seed(env, "buyer@example.com");
  const r = await post(env, session(), sig("other body"));
  assert.equal(r.status, 400); assert.equal(r.j.error, "bad_signature");
  const r2 = await post(env, session(), sig("x", "whsec_wrong"));
  assert.equal(r2.status, 400);
  assert.ok(![...env.SC.m.keys()].some((k) => k.startsWith("stripe:") || k.startsWith("orphan:")));
});
await t("stale signature timestamp -> 400", async () => {
  const env = baseEnv(); const s = session();
  const raw = JSON.stringify({ id: "evt_1", type: "checkout.session.completed", data: { object: s } });
  const res = await worker.fetch(new Request("https://w.example/stripe-webhook", { method: "POST", body: raw, headers: { "Stripe-Signature": sig(raw, SECRET, Math.floor(Date.now() / 1000) - 3600) } }), env, ctx());
  assert.equal(res.status, 400);
});
await t("offer check: metadata missing but payment link + 3900 USD -> handled; other link or amount -> ignored", async () => {
  const env = baseEnv(); const RID = await seed(env, "buyer@example.com");
  assert.equal((await post(env, session({ metadata: {} }))).j.resultId, RID);
  assert.equal((await post(env, session({ metadata: {}, amount_total: 99000 }))).j.ignored, "offer not fixlist");
  assert.equal((await post(env, session({ metadata: {}, payment_link: "plink_other" }))).j.ignored, "offer not fixlist");
});
console.log(results.n + " passed");
