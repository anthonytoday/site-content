// P1-06 migration tests: scheduled() copies email:<addr> -> eh:<HMAC> inside the Worker, guarded by MIGRATE_EH + the done marker.
// Run: ESBUILD=<path to esbuild> node test/migrate.test.mjs  (no network: fetch is stubbed)
import assert from "node:assert/strict";
import { worker, baseEnv, calls, ctx, t, results, eh } from "./harness.mjs";

const FLAG = { MIGRATE_EH: "run-2026-10-20" };
const DAY = 86400, now = () => Math.floor(Date.now() / 1000);
const rid = (n) => "r" + n.toString(16).padStart(24, "0");
const logs = []; const origLog = console.log;
async function tick(env) {
  const c = ctx(); const mine = [];
  console.log = (...a) => { const s = a.join(" "); logs.push(s); mine.push(s); };
  try { await worker.scheduled({ cron: "*/5 * * * *", scheduledTime: Date.now() }, env, c); await Promise.allSettled(c.w); } finally { console.log = origLog; }
  const line = mine.map((s) => { try { return JSON.parse(s).migrate_eh; } catch { return null; } }).find(Boolean);
  return line || null;
}
// Legacy record + the sub: record it points to (owned by the normalised email unless owner is given; owner null = no sub: record).
const legacy = (env, email, r, expiration, owner) => { env.SC.m.set("email:" + email, r); if (expiration) env.SC.exp.set("email:" + email, expiration);
  if (owner !== null && /^r[0-9a-f]{24}$/.test(r) && !env.SC.m.has("sub:" + r)) env.SC.m.set("sub:" + r, JSON.stringify({ result_id: r, email: owner ?? email.trim().toLowerCase() })); };
const snap = (env) => JSON.stringify([...env.SC.m.entries()].sort());
const marker = (env) => env.SC.m.get("migrate:eh:done");

await t("flag absent -> no-op (no KV read/write beyond nothing, no log)", async () => {
  const env = baseEnv(); legacy(env, "a@example.com", rid(1), now() + 100 * DAY); const s = snap(env);
  assert.equal(await tick(env), null); assert.equal(snap(env), s);
});
await t("flag with a wrong value -> no-op", async () => {
  for (const v of ["run", "RUN-2026-10-20", "run-2026-10-21", "1", "true", " run-2026-10-20"]) {
    const env = baseEnv({ MIGRATE_EH: v }); legacy(env, "a@example.com", rid(1), now() + 100 * DAY); const s = snap(env);
    assert.equal(await tick(env), null, v); assert.equal(snap(env), s);
  }
});
await t("marker present -> no-op", async () => {
  const env = baseEnv(FLAG); legacy(env, "a@example.com", rid(1), now() + 100 * DAY); env.SC.m.set("migrate:eh:done", "{}"); const s = snap(env);
  assert.equal(await tick(env), null); assert.equal(snap(env), s);
});
await t("copies with the same value and the same absolute expiry; email: untouched; marker holds counts only", async () => {
  const env = baseEnv(FLAG); const ex1 = now() + 300 * DAY, ex2 = now() + 700 * DAY;
  legacy(env, "one@example.com", rid(1), ex1); legacy(env, "two@example.com", rid(2), ex2);
  const r = await tick(env);
  assert.equal(r.copied, 2); assert.equal(r.done, true);
  assert.equal(env.SC.m.get(eh("one@example.com")), rid(1)); assert.equal(env.SC.exp.get(eh("one@example.com")), ex1);
  assert.equal(env.SC.m.get(eh("two@example.com")), rid(2)); assert.equal(env.SC.exp.get(eh("two@example.com")), ex2);
  assert.equal(env.SC.m.get("email:one@example.com"), rid(1)); assert.equal(env.SC.exp.get("email:one@example.com"), ex1);
  const m = JSON.parse(marker(env)); assert.equal(m.copied, 2); assert.ok(!/@|email:|eh:|r0{20}/.test(marker(env)), "marker has counts only");
  assert.equal(env.SC.exp.get("migrate:eh:done"), undefined);
});
await t("no expiration on the legacy key -> the writer's standard 730-day TTL", async () => {
  const env = baseEnv(FLAG); legacy(env, "noexp@example.com", rid(3));
  const r = await tick(env); assert.equal(r.copied, 1); assert.equal(r.ttl_default, 1);
  const e = env.SC.exp.get(eh("noexp@example.com")); assert.ok(Math.abs(e - (now() + 730 * DAY)) < 5, "730 days");
});
await t("idempotent re-run: eh: already equal -> skipped; with the marker the next tick is a no-op", async () => {
  const env = baseEnv(FLAG); legacy(env, "idem@example.com", rid(4), now() + 50 * DAY);
  assert.equal((await tick(env)).copied, 1); assert.equal(await tick(env), null, "marker -> no-op");
  env.SC.m.delete("migrate:eh:done"); const s = snap(env);
  const r = await tick(env); assert.equal(r.copied, 0); assert.equal(r.same, 1); assert.equal(r.done, true);
  const after = JSON.parse(snap(env)).filter(([k]) => k !== "migrate:eh:done"); assert.deepEqual(after, JSON.parse(s));
});
await t("eh: holding a different value is never overwritten -> mismatched, marker not set", async () => {
  const env = baseEnv(FLAG); legacy(env, "mm@example.com", rid(5), now() + 50 * DAY); legacy(env, "ok@example.com", rid(6), now() + 50 * DAY);
  env.SC.m.set(eh("mm@example.com"), rid(99));
  const r = await tick(env); assert.equal(r.mismatched, 1); assert.equal(r.copied, 1); assert.equal(r.done, false);
  assert.equal(env.SC.m.get(eh("mm@example.com")), rid(99)); assert.equal(marker(env), undefined);
  const r2 = await tick(env); assert.equal(r2.mismatched, 1); assert.equal(r2.same, 1); assert.equal(env.SC.m.get(eh("mm@example.com")), rid(99));
});
await t("odd values and odd keys are skipped and counted; they do not block the marker", async () => {
  const env = baseEnv(FLAG);
  legacy(env, "bad@example.com", "<script>", now() + 50 * DAY); legacy(env, "bad2@example.com", rid(7) + "x", now() + 50 * DAY);
  legacy(env, "not-an-email", rid(8), now() + 50 * DAY); legacy(env, "good@example.com", rid(9), now() + 50 * DAY);
  const r = await tick(env); assert.equal(r.odd, 3); assert.equal(r.copied, 1); assert.equal(r.done, true);
  assert.ok(![...env.SC.m.keys()].some((k) => k.startsWith("eh:") && [ "<script>", rid(7) + "x", rid(8)].includes(env.SC.m.get(k))));
});
await t("normalises like the live writer (trim + lowercase): a legacy key with case/space maps to the same eh:", async () => {
  const env = baseEnv(FLAG); legacy(env, " Mixed@Example.COM", rid(10), now() + 50 * DAY);
  const r = await tick(env); assert.equal(r.copied, 1); assert.equal(env.SC.m.get(eh("mixed@example.com")), rid(10));
});
await t("legacy key expiring within 2 minutes is skipped (expiring), not copied", async () => {
  const env = baseEnv(FLAG); legacy(env, "soon@example.com", rid(11), now() + 30);
  const r = await tick(env); assert.equal(r.expiring, 1); assert.equal(r.copied, 0); assert.equal(env.SC.m.get(eh("soon@example.com")), undefined);
});
await t("partial failure (put throws / read-back differs) -> counted as failed, marker not set; next tick retries and finishes", async () => {
  const env = baseEnv(FLAG); legacy(env, "f1@example.com", rid(12), now() + 50 * DAY); legacy(env, "f2@example.com", rid(13), now() + 50 * DAY); legacy(env, "f3@example.com", rid(14), now() + 50 * DAY);
  const put = env.SC.put, get = env.SC.get; const k1 = eh("f1@example.com"), k2 = eh("f2@example.com");
  env.SC.put = async (k, v, o) => { if (k === k1) throw new Error("kv down"); return put(k, v, o); };
  let lie = true; env.SC.get = async (k, t2) => { if (k === k2 && lie && env.SC.m.has(k2)) return "stale"; return get(k, t2); };
  const r = await tick(env); assert.equal(r.failed, 2); assert.equal(r.copied, 1); assert.equal(r.done, false); assert.equal(marker(env), undefined);
  env.SC.put = put; lie = false;
  const r2 = await tick(env); assert.equal(r2.failed, 0); assert.equal(r2.copied, 1); assert.equal(r2.same, 2); assert.equal(r2.done, true); assert.ok(marker(env));
});
await t("paging + KV budget: 250 keys over 3 list pages; ticks defer at the budget (each under 1000 KV ops) until done, then the marker", async () => {
  const env = baseEnv(FLAG); for (let i = 0; i < 250; i++) legacy(env, "p" + i + "@example.com", rid(1000 + i), now() + 100 * DAY);
  let lists = 0; const list = env.SC.list; env.SC.list = async (o) => { lists++; assert.ok(o.limit <= 1000); return list(o); };
  let ops = 0; const g = env.SC.get, p = env.SC.put; env.SC.get = async (...a) => { ops++; return g(...a); }; env.SC.put = async (...a) => { ops++; return p(...a); };
  let copied = 0, ticks = 0, r, maxLists = 0;
  do { ops = 0; lists = 0; r = await tick(env); ticks++; copied += r.copied; maxLists = Math.max(maxLists, lists);
    assert.ok(ops + lists <= 1000, "tick " + ticks + " KV ops " + (ops + lists));
    if (!r.done) { assert.equal(r.deferred, true); assert.equal(marker(env), undefined); } } while (!r.done && ticks < 6);
  assert.equal(r.done, true); assert.ok(ticks >= 2, "first tick deferred"); assert.equal(copied, 250); assert.ok(maxLists >= 3, "paged with a cursor");
  for (let i = 0; i < 250; i++) assert.equal(env.SC.m.get(eh("p" + i + "@example.com")), rid(1000 + i));
});
await t("the migration makes no fetch calls and has no fetch path (no admin route)", async () => {
  calls.length = 0; const env = baseEnv(FLAG); legacy(env, "nf@example.com", rid(20), now() + 50 * DAY);
  await tick(env); assert.equal(calls.length, 0, "no outbound fetch");
  env.SC.m.delete("migrate:eh:done"); env.SC.m.delete(eh("nf@example.com")); const s = snap(env);
  for (const path of ["/migrate", "/migrate-eh", "/admin/migrate", "/scheduled", "/__scheduled", "/cdn-cgi/handler/scheduled"]) for (const method of ["GET", "POST"]) {
    const res = await worker.fetch(new Request("https://w.example" + path, { method }), env, ctx()); assert.notEqual(res.status, 200, path);
  }
  assert.equal(snap(env), s, "no fetch request runs the migration");
});
await t("C2 owner check: sub: missing or owned by another address -> owner_mismatch, not copied; marker still set (non-blocking)", async () => {
  const env = baseEnv(FLAG);
  legacy(env, "nosub@example.com", rid(30), now() + 50 * DAY, null);
  legacy(env, "notmine@example.com", rid(31), now() + 50 * DAY, "someoneelse@example.org");
  legacy(env, "mine@example.com", rid(32), now() + 50 * DAY, "  MINE@example.com ");
  const r = await tick(env); assert.equal(r.owner_mismatch, 2); assert.equal(r.copied, 1); assert.equal(r.done, true);
  assert.equal(env.SC.m.get(eh("nosub@example.com")), undefined); assert.equal(env.SC.m.get(eh("notmine@example.com")), undefined);
  assert.equal(env.SC.m.get(eh("mine@example.com")), rid(32), "owner compared after trim + lowercase");
  assert.equal(JSON.parse(marker(env)).owner_mismatch, 2);
});
await t("logs from every run above contain no key, address or result id", async () => {
  assert.ok(logs.length > 5);
  for (const l of logs) { assert.ok(!/@|email:|eh:|sub:|r[0-9a-f]{24}/.test(l), "log leaks: " + l.slice(0, 40)); assert.ok(/"migrate_eh"/.test(l)); }
});
console.log(results.n + " passed");
