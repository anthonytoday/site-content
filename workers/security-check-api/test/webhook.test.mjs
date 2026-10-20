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
await t("no match -> orphan record + Resend alert to admin@ and ORPHAN_ALERT_TO + Command Center ping, 200", async () => {
  calls.length = 0;
  const env = baseEnv({ DRY_RUN: "0", LIVE_FOR: "all", RESEND_API_KEY: "re_test_only", ORPHAN_ALERT_TO: "l0@example.com", CC_INGEST_URL: "https://cc.example/ingest", CC_INGEST_TOKEN: "x" });
  const s = session({ client_reference_id: "scfb1_102_abcdabcdabca_a91e751b", customer_details: { email: "nobody@example.com" } });
  const r = await post(env, s);
  assert.equal(r.status, 200); assert.equal(r.j.orphan, true);
  const mail = calls.find((c) => c.url === "https://api.resend.com/emails"); assert.ok(mail, "alert sent via Resend");
  const p = JSON.parse(mail.body);
  assert.deepEqual(p.to, ["admin@anthonytoday.com", "l0@example.com"]);
  assert.match(p.subject, /Unmatched Fix List payment/); assert.match(p.text, /scfb1_102_abcdabcdabca_a91e751b/); assert.match(p.text, new RegExp(s.id));
  const cc = calls.find((c) => c.url === "https://cc.example/ingest"); assert.ok(cc); assert.equal(JSON.parse(cc.body).type, "security_check.orphan_payment");
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
await t("multiple matches (retaken check) -> no delivery, ambiguous alert to admin@ and L0", async () => {
  calls.length = 0;
  const env = baseEnv({ DRY_RUN: "0", LIVE_FOR: "none", TEST_SEND_ALLOWLIST: "", RESEND_API_KEY: "re_test_only", ORPHAN_ALERT_TO: "l0@example.com" });
  await seed(env, "twice@example.com"); await seed(env, "twice@example.com");
  calls.length = 0;
  const s = session({ customer_details: { email: "twice@example.com" } });
  const r = await post(env, s);
  assert.equal(r.status, 200); assert.equal(r.j.orphan, true); assert.equal(r.j.resultId, undefined);
  const rec = JSON.parse(env.SC.m.get("orphan:" + s.id)); assert.equal(rec.reason, "multiple_matches");
  const p = JSON.parse(calls.find((c) => c.url === "https://api.resend.com/emails").body);
  assert.match(p.subject, /Ambiguous Fix List payment/); assert.deepEqual(p.to, ["admin@anthonytoday.com", "l0@example.com"]);
  assert.equal(calls.filter((c) => c.url === "https://api.resend.com/emails").length, 1, "only the internal alert, no client email");
  assert.ok(!calls.some((c) => /notion/i.test(c.url)));
});
await t("multiple matches (hashed and legacy index point at different results) -> alert, no guess", async () => {
  const env = baseEnv(); const a = await seed(env, "split@example.com");
  const other = JSON.parse(env.SC.m.get("sub:" + a)); other.result_id = "r" + "f".repeat(24); env.SC.m.set("sub:" + other.result_id, JSON.stringify(other));
  env.SC.m.set("email:split@example.com", other.result_id);
  const s = session({ customer_details: { email: "split@example.com" } });
  const r = await post(env, s); assert.equal(r.j.orphan, true);
  assert.equal(JSON.parse(env.SC.m.get("orphan:" + s.id)).reason, "multiple_matches");
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
