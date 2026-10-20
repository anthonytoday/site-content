// BASE-H2 unsubscribe tests: random token minted at send time, masked page, legacy grace, no per-click token writes.
// Run: ESBUILD=<path to esbuild> node test/unsubscribe.test.mjs  (no network: fetch is stubbed)
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import data from "../src/quiz-data.json" with { type: "json" };
import { worker, baseEnv, calls, ctx, t, results, SIGNING_KEY } from "./harness.mjs";

const LIVE = { DRY_RUN: "0", LIVE_FOR: "all", RESEND_API_KEY: "re_test_only" };
async function submit(env, email) {
  const body = { name: "Jo", company: "Co", email, team_size: "5-10", role: "owner", plan: data.profile.plan[0].value, country: data.profile.country[0].value ?? data.profile.country[0], consent: true,
    answers: Object.fromEntries(data.questions.map((q) => [q.id, "B"])) };
  const c = ctx();
  const res = await worker.fetch(new Request("https://w.example/submit", { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json", Origin: "https://www.anthonytoday.com", "CF-Connecting-IP": "9.9.9." + Math.floor(Math.random() * 200) } }), env, c);
  await Promise.allSettled(c.w);
  assert.equal(res.status, 200);
  return (await res.json()).resultId;
}
const sentResultEmail = () => calls.map((c) => c.url === "https://api.resend.com/emails" && JSON.parse(c.body)).find((p) => p && p.headers && p.headers["List-Unsubscribe"]);
const unsubFrom = (p) => p.headers["List-Unsubscribe"].match(/<(https:[^>]+)>/)[1];
const get = (env, u, method = "GET") => worker.fetch(new Request(u, { method }), env, ctx());
const b64u = (s) => Buffer.from(s).toString("base64url");
const legacyToken = (email, rid) => { const p = b64u(JSON.stringify({ e: email, r: rid })); return p + "." + createHmac("sha256", SIGNING_KEY).update("u:" + p).digest("base64url").slice(0, 32); };

await t("live send: List-Unsubscribe and body carry a random u1 token, no email, one ut: record", async () => {
  calls.length = 0; const env = baseEnv(LIVE);
  const rid = await submit(env, "jane.doe@example.com");
  const p = sentResultEmail(); assert.ok(p, "result email sent");
  const u = unsubFrom(p); const tok = new URL(u).searchParams.get("token");
  assert.match(tok, /^u1[A-Za-z0-9_-]{22}$/);
  assert.ok(!/@|%40|amFuZS/.test(u), "no email, plain or base64, in the URL");
  assert.ok(p.html.includes(tok) && p.text.includes(tok), "same token in the email body");
  const recs = [...env.SC.m.keys()].filter((k) => k.startsWith("ut:")); assert.equal(recs.length, 1);
  assert.deepEqual(Object.keys(JSON.parse(env.SC.m.get(recs[0]))).sort(), ["at", "e", "r"]); assert.equal(JSON.parse(env.SC.m.get(recs[0])).r, rid);
});
await t("GET shows a masked email and writes nothing; POST unsubscribes", async () => {
  calls.length = 0; const env = baseEnv(LIVE);
  const rid = await submit(env, "jane.doe@example.com"); const u = unsubFrom(sentResultEmail());
  const before = new Map(env.SC.m);
  const g = await get(env, u); const html = await g.text();
  assert.equal(g.status, 200); assert.ok(html.includes("j***@e***.com")); assert.ok(!html.includes("jane.doe@example.com"));
  assert.deepEqual([...env.SC.m.entries()], [...before.entries()], "GET writes no KV");
  const po = await get(env, u, "POST"); const h2 = await po.text();
  assert.equal(po.status, 200); assert.ok(h2.includes("j***@e***.com") && !h2.includes("jane.doe"));
  assert.ok(env.SC.m.get("unsub:jane.doe@example.com")); assert.equal(JSON.parse(env.SC.m.get("sub:" + rid)).unsubscribed, true);
  assert.equal([...env.SC.m.keys()].filter((k) => k.startsWith("ut:")).length, 1, "no new token on click");
});
await t("dry-run submit mints no token", async () => {
  const env = baseEnv(); await submit(env, "dry@example.com");
  assert.equal([...env.SC.m.keys()].filter((k) => k.startsWith("ut:")).length, 0);
});
await t("legacy token from an old email still unsubscribes during the grace period", async () => {
  const env = baseEnv(LIVE); const rid = await submit(env, "old@example.com");
  const u = "https://w.example/unsubscribe?token=" + legacyToken("old@example.com", rid);
  const g = await get(env, u); const html = await g.text(); assert.equal(g.status, 200); assert.ok(html.includes("o***@e***.com") && !html.includes("old@example.com"));
  assert.equal((await get(env, u, "POST")).status, 200); assert.ok(env.SC.m.get("unsub:old@example.com"));
});
await t("legacy token is refused after LEGACY_UNSUB_UNTIL", async () => {
  const env = baseEnv({ ...LIVE, LEGACY_UNSUB_UNTIL: "2020-01-01T00:00:00Z" });
  assert.equal((await get(env, "https://w.example/unsubscribe?token=" + legacyToken("old@example.com", "r" + "0".repeat(24)))).status, 400);
});
await t("unknown, tampered or junk tokens -> 400", async () => {
  const env = baseEnv(LIVE);
  for (const tok of ["u1AAAAAAAAAAAAAAAAAAAAAA", legacyToken("x@example.com", "r1").replace(/.$/, "A"), "", "<script>", "u1" + "x".repeat(500)])
    assert.equal((await get(env, "https://w.example/unsubscribe?token=" + encodeURIComponent(tok))).status, 400, tok.slice(0, 20));
});
await t("UNSUB_BASE swaps the endpoint without changing the token", async () => {
  calls.length = 0; const env = baseEnv({ ...LIVE, UNSUB_BASE: "https://unsub.example/fn" });
  await submit(env, "swap@example.com");
  assert.match(unsubFrom(sentResultEmail()), /^https:\/\/unsub\.example\/fn\?token=u1[A-Za-z0-9_-]{22}$/);
});
console.log(results.n + " passed");
