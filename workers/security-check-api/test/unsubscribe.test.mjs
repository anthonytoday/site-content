// BASE-H2 unsubscribe tests: random token minted at send time, masked page, legacy grace, no per-click token writes.
// Run: ESBUILD=<path to esbuild> node test/unsubscribe.test.mjs  (no network: fetch is stubbed)
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import data from "../src/quiz-data.json" with { type: "json" };
import { worker, baseEnv, calls, ctx, t, results, SIGNING_KEY } from "./harness.mjs";

const LIVE = { DRY_RUN: "0", LIVE_FOR: "all", RESEND_API_KEY: "re_test_only" };
// MINT-01: a u1 link only goes into an email when UNSUB_BASE is an https non-workers.dev host (custom domain). Tests of the Worker's
// u1 endpoint set one; without it the fallback email is mailto-only (see the MINT-01 tests at the end).
const U1 = { UNSUB_BASE: "https://unsub.example/unsubscribe" };
async function submit(env, email, consent = true) {
  const body = { name: "Jo", company: "Co", email, team_size: "5-10", role: "owner", plan: data.profile.plan[0].value, country: data.profile.country[0].value ?? data.profile.country[0], consent,
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

await t("live send (UNSUB_BASE custom host): List-Unsubscribe and body carry a random u1 token, no email, one ut: record", async () => {
  calls.length = 0; const env = baseEnv({ ...LIVE, ...U1 });
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
  calls.length = 0; const env = baseEnv({ ...LIVE, ...U1 });
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

// Shared Supabase unsubscribe (mint at send time, one 3 s deadline, KV u1 fallback). Dummy key only; fake Supabase below.
const MINT = { UNSUB_MINT_URL: "https://jzmglkzmqgojjnqxoytf.supabase.co/functions/v1/cc-hooks/mint", UNSUB_MINT_TOKEN: "dummy-mint-key-for-tests" };
const SB_UNSUB = "https://jzmglkzmqgojjnqxoytf.supabase.co/functions/v1/unsub";
const PAGE = "https://www.anthonytoday.com/unsubscribe/";
const SBTOK = "AbCdEfGhIjKlMnOpQrStUvWx";
// Fake shared system: mint returns one token per address (reused), unsub GET fmt=json is read-only, POST marks used (= suppressed).
function fakeSupabase(mintHandler) {
  const sb = { tokens: new Map([["jane.doe@example.com", SBTOK]]), used: new Set(), writes: 0, gets: 0 };
  sb.emailOf = (t) => [...sb.tokens].find(([, v]) => v === t)?.[0];
  sb.handle = async (url, init) => {
    const u = new URL(url);
    if (url === MINT.UNSUB_MINT_URL) {
      if (mintHandler) return mintHandler(init);
      if ((init.headers || {}).Authorization !== "Bearer " + MINT.UNSUB_MINT_TOKEN) return new Response('{"error":"unauthorized"}', { status: 401 });
      const e = JSON.parse(init.body).email; if (!sb.tokens.has(e)) sb.tokens.set(e, ("T" + Buffer.from(e).toString("hex")).slice(0, 24).padEnd(24, "x"));
      const t = sb.tokens.get(e); return new Response(JSON.stringify({ token: t, url: SB_UNSUB + "?id=" + t + "&l=en", list_unsubscribe: "<x>" }), { status: 200 });
    }
    if (u.origin + u.pathname === SB_UNSUB) {
      const method = init.method || "GET";
      const id = u.searchParams.get("id") || new URLSearchParams(String(init.body || "")).get("id") || "";
      const e = sb.emailOf(id); if (!e) return new Response('{"ok":false,"error":"invalid"}', { status: 404 });
      if (method === "GET") { sb.gets++; return new Response(JSON.stringify({ ok: true, masked: "j***@e***.com", lang: "en", done: sb.used.has(e) }), { status: 200 }); }
      sb.writes++; sb.used.add(e); return new Response(JSON.stringify({ ok: true, done: true }), { status: 200 });
    }
    return null;
  };
  return sb;
}
async function withSB(sb, fn) {
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => { const r = await sb.handle(String(url), init); if (r) { calls.push({ url: String(url), body: String(init.body || ""), auth: (init.headers || {}).Authorization, method: init.method || "GET" }); return r; } return orig(url, init); };
  try { await fn(); } finally { globalThis.fetch = orig; }
}
const EMAIL_RE = /@|%40|amFuZS5kb2|jane\.doe|jane%2Edoe/i; // plain, %-encoded, base64 of "jane.doe"
const noEmail = (p, label) => {
  const lu = p.headers["List-Unsubscribe"];
  for (const u of [...lu.matchAll(/<(https:[^>]+)>/g)].map((m) => m[1])) assert.ok(!EMAIL_RE.test(u) && !EMAIL_RE.test(decodeURIComponent(u)), label + ": header URL has no email");
  for (const u of [...(p.html + " " + p.text).matchAll(/https:\/\/[^\s"<>']*unsub[^\s"<>']*/g)].map((m) => m[0])) assert.ok(!EMAIL_RE.test(u) && !EMAIL_RE.test(decodeURIComponent(u.replace(/&amp;/g, "&"))), label + ": body link has no email");
  const b64 = Buffer.from("jane.doe@example.com").toString("base64").slice(0, 12), b64u = Buffer.from("jane.doe@example.com").toString("base64url").slice(0, 12);
  assert.ok(!lu.includes(b64) && !lu.includes(b64u), label + ": no base64 email in header");
};

await t("[S1/S4/S5] mint OK -> body links to www /unsubscribe/?id=&l=en, header one-click to the unsub function; no email anywhere; no KV token", async () => {
  calls.length = 0; const env = baseEnv({ ...LIVE, ...MINT }); const sb = fakeSupabase();
  await withSB(sb, async () => {
    const rid = await submit(env, "jane.doe@example.com");
    const p = sentResultEmail(); assert.ok(p);
    const link = PAGE + "?id=" + SBTOK + "&l=en";
    assert.ok(p.html.includes(link.replace(/&/g, "&amp;")) || p.html.includes(link), "html body link"); assert.ok(p.text.includes(link), "text body link");
    assert.ok(!p.html.includes("supabase.co") && !p.text.includes("supabase.co"), "body never links to supabase.co");
    assert.equal(unsubFrom(p), SB_UNSUB + "?id=" + SBTOK + "&l=en&oc=1", "List-Unsubscribe one-click");
    assert.equal(p.headers["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
    assert.ok(p.headers["List-Unsubscribe"].includes("<mailto:admin@anthonytoday.com?subject=unsubscribe>"));
    // matches what the static page expects: ?id=<tok> passes its regex, l=en
    const pu = new URL(link); assert.match(pu.searchParams.get("id"), /^[A-Za-z0-9_-]{20,40}$/); assert.equal(pu.searchParams.get("l"), "en"); assert.equal(pu.origin + pu.pathname, PAGE);
    noEmail(p, "supabase path");
    const m = calls.find((c) => c.url === MINT.UNSUB_MINT_URL);
    assert.equal(m.auth, "Bearer dummy-mint-key-for-tests"); assert.deepEqual(JSON.parse(m.body), { email: "jane.doe@example.com", lang: "en", source: "security-check-worker" });
    assert.ok(!calls.filter((c) => c.url.includes("supabase.co")).some((c) => EMAIL_RE.test(c.url)), "email only in the mint POST body, never a URL");
    assert.equal([...env.SC.m.keys()].filter((k) => k.startsWith("ut:")).length, 0);
    assert.equal(JSON.parse(env.SC.m.get("sub:" + rid)).unsub_via, "supabase");
    assert.equal(sb.writes, 0, "send path never writes to the shared system");
  });
});
await t("[S1] mint response url/list_unsubscribe are ignored (links built from fixed bases)", async () => {
  calls.length = 0; const env = baseEnv({ ...LIVE, ...MINT });
  const sb = fakeSupabase(async () => new Response(JSON.stringify({ token: SBTOK, url: "https://evil.example/u", list_unsubscribe: "<https://evil.example/x>" }), { status: 200 }));
  await withSB(sb, async () => { await submit(env, "jane.doe@example.com"); const p = sentResultEmail(); assert.ok(!JSON.stringify(p).includes("evil.example")); });
});
const MAILTO_LU = "<mailto:admin@anthonytoday.com?subject=unsubscribe>";
// MINT-01 fallback shape: mailto-only header, no one-click Post header, body links to the www page with no id + the reply line.
const assertMailtoFallback = (p, label) => {
  assert.equal(p.headers["List-Unsubscribe"], MAILTO_LU, label + ": mailto-only List-Unsubscribe");
  assert.ok(!("List-Unsubscribe-Post" in p.headers), label + ": no List-Unsubscribe-Post");
  assert.ok(p.html.includes('<a href="' + PAGE + '">Unsubscribe</a>'), label + ": html body link is the www page, no id");
  assert.ok(p.text.includes("Unsubscribe (" + PAGE + ")"), label + ": text body link is the www page, no id");
  assert.ok(p.html.includes("reply &quot;unsubscribe&quot;") || p.html.includes('reply "unsubscribe"'), label + ": html reply line");
  assert.ok(p.text.includes('reply "unsubscribe"'), label + ": text reply line");
  assert.ok(!/u1[A-Za-z0-9_-]{22}/.test(JSON.stringify(p)), label + ": no u1 token in the email");
};
for (const [name, handler, via] of [
  ["mint 503", async () => new Response('{"error":"temporary","email":"jane.doe@example.com"}', { status: 503 }), "mailto_only (mint 503)"],
  ["mint 401", async () => new Response('{"error":"unauthorized"}', { status: 401 }), "mailto_only (mint 401)"],
  ["mint bad token", async () => new Response(JSON.stringify({ token: "../../x?y=1" }), { status: 200 }), "mailto_only (mint bad token)"],
  ["mint 20-char token (not the 24-char format)", async () => new Response(JSON.stringify({ token: "A".repeat(20) }), { status: 200 }), "mailto_only (mint bad token)"],
  ["mint network error", async () => { throw new TypeError("fetch failed for jane.doe@example.com"); }, "mailto_only (mint failed)"],
]) await t("[S2/S3/S4/S8] " + name + " -> mailto-only fallback + www page (no legacy, no ?e=), u1 record kept, no email in logs", async () => {
  calls.length = 0; const env = baseEnv({ ...LIVE, ...MINT });
  await withSB(fakeSupabase(handler), async () => {
    const rid = await submit(env, "jane.doe@example.com");
    const p = sentResultEmail(); assert.ok(p, "email sent");
    assertMailtoFallback(p, name);
    assert.ok(!/\?e=|&e=/.test(JSON.stringify(p)), "never ?e=");
    noEmail(p, "fallback");
    const recs = [...env.SC.m.keys()].filter((k) => k.startsWith("ut:")); assert.equal(recs.length, 1, "u1 KV record kept for a later re-mint");
    assert.equal((await get(env, "https://w.example/unsubscribe?" + "token=" + recs[0].slice(3))).status, 200, "kept u1 record still resolves on the Worker");
    const s = JSON.parse(env.SC.m.get("sub:" + rid)); assert.equal(s.unsub_via, via);
    assert.ok(!JSON.stringify(s.log || []).includes("temporary"), "mint error body never stored");
    const step = (s.log || []).find((l) => l.step === "resend_result_email"); assert.ok(step);
    assert.ok(!/jane\.doe|temporary|fetch failed/.test(JSON.stringify(step) + s.unsub_via), "mint error recorded as a fixed string only (no body, no email)");
  });
});
await t("[S2] mint hangs -> 3 s deadline, mailto-only fallback, email still sent", async () => {
  calls.length = 0; const env = baseEnv({ ...LIVE, ...MINT });
  await withSB(fakeSupabase((init) => new Promise((_, rej) => init.signal.addEventListener("abort", () => rej(init.signal.reason)))), async () => {
    const keep = setInterval(() => {}, 1000); // AbortSignal.timeout timers are unref'd in Node; keep the loop alive
    const t0 = Date.now(); const rid = await submit(env, "slow@example.com"); const ms = Date.now() - t0; clearInterval(keep);
    assert.ok(ms >= 2900 && ms < 4500, "took " + ms + " ms");
    assert.ok(sentResultEmail(), "email sent"); assertMailtoFallback(sentResultEmail(), "timeout");
    assert.equal(JSON.parse(env.SC.m.get("sub:" + rid)).unsub_via, "mailto_only (mint timeout)");
  });
});
await t("[S2] status check hangs after a fast mint -> same 3 s deadline total, email sent with the shared link", async () => {
  calls.length = 0; const env = baseEnv({ ...LIVE, ...MINT }); const sb = fakeSupabase();
  const h = sb.handle; sb.handle = async (url, init) => (url.includes("fmt=json") ? new Promise((_, rej) => init.signal.addEventListener("abort", () => rej(init.signal.reason))) : h(url, init));
  await withSB(sb, async () => {
    const keep = setInterval(() => {}, 1000); const t0 = Date.now(); await submit(env, "jane.doe@example.com"); const ms = Date.now() - t0; clearInterval(keep);
    assert.ok(ms >= 2900 && ms < 4500, "took " + ms + " ms"); assert.match(unsubFrom(sentResultEmail()), /unsub\?id=/);
  });
});
await t("[S1] non-Supabase or other-project UNSUB_MINT_URL is refused (never called) -> mailto-only fallback", async () => {
  for (const bad of ["https://evil.example/mint", "https://otherproj.supabase.co/functions/v1/cc-hooks/mint"]) {
    calls.length = 0; const env = baseEnv({ ...LIVE, UNSUB_MINT_URL: bad, UNSUB_MINT_TOKEN: "dummy" });
    await submit(env, "x@example.com");
    assert.ok(!calls.some((c) => c.url === bad), "token never sent to " + bad);
    assertMailtoFallback(sentResultEmail(), bad);
  }
});
await t("[S3] Worker resolver: strict regex per format; shared token GET -> 302 www page, no writes; junk 400", async () => {
  calls.length = 0; const env = baseEnv({ ...LIVE, ...MINT }); const sb = fakeSupabase();
  await withSB(sb, async () => {
    const before = new Map(env.SC.m);
    const g = await get(env, "https://w.example/unsubscribe?token=" + SBTOK);
    assert.equal(g.status, 302); assert.equal(g.headers.get("Location"), PAGE + "?id=" + SBTOK + "&l=en");
    assert.equal(sb.writes, 0); assert.deepEqual([...env.SC.m.entries()], [...before.entries()]);
    for (const tok of ["A".repeat(23), "A".repeat(25), SBTOK + "=", "u1" + "A".repeat(21), "AbCdEfGhIjKlMnOpQrStUv.x"]) assert.equal((await get(env, "https://w.example/unsubscribe?token=" + encodeURIComponent(tok))).status, 400, tok);
    assert.equal((await get(env, "https://w.example/unsubscribe?token=u1AAAAAAAAAAAAAAAAAAAAAA", "POST")).status, 400, "u1-shaped unknown token is not forwarded");
    assert.equal(sb.writes, 0, "nothing forwarded for junk");
  });
});
await t("[S6] GET has no side effects on either path; one-click POST works on both", async () => {
  // shared path: the header URL is the unsub function; GET read-only, RFC 8058 POST suppresses
  calls.length = 0; const env = baseEnv({ ...LIVE, ...MINT }); const sb = fakeSupabase();
  await withSB(sb, async () => {
    await submit(env, "jane.doe@example.com"); const oc = unsubFrom(sentResultEmail());
    await fetch(oc, { method: "GET" }); assert.equal(sb.writes, 0, "GET writes nothing");
    const r = await fetch(oc, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "List-Unsubscribe=One-Click" });
    assert.equal(r.status, 200); assert.ok(sb.used.has("jane.doe@example.com"), "one-click POST suppresses (shared)");
    // Worker host forwarding a shared token on POST
    sb.used.clear(); assert.equal((await get(env, "https://w.example/unsubscribe?token=" + SBTOK, "POST")).status, 200); assert.ok(sb.used.has("jane.doe@example.com"));
  });
  // u1 path: GET page writes nothing, one-click POST (RFC 8058 body) unsubscribes
  calls.length = 0; const env2 = baseEnv({ ...LIVE, ...U1 }); await submit(env2, "jane.doe@example.com"); const u = unsubFrom(sentResultEmail());
  const before = new Map(env2.SC.m); assert.equal((await get(env2, u)).status, 200); assert.deepEqual([...env2.SC.m.entries()], [...before.entries()]);
  const po = await worker.fetch(new Request(u, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "List-Unsubscribe=One-Click" }), env2, ctx());
  assert.equal(po.status, 200); assert.ok(env2.SC.m.get("unsub:jane.doe@example.com"));
});
await t("[S7] one unsubscribe stops both: shared unsubscribe -> Worker skips the next result email", async () => {
  calls.length = 0; const env = baseEnv({ ...LIVE, ...MINT }); const sb = fakeSupabase();
  await withSB(sb, async () => {
    sb.used.add("jane.doe@example.com"); // unsubscribed through any shared-system email
    const rid = await submit(env, "jane.doe@example.com");
    assert.ok(!calls.some((c) => c.url === "https://api.resend.com/emails" && JSON.parse(c.body).tags?.some((x) => x.value === "security_check_result")), "result email not sent");
    const s = JSON.parse(env.SC.m.get("sub:" + rid)); assert.equal(s.unsubscribed, true);
    assert.match(JSON.stringify(s.log), /unsubscribed \(shared system\)/);
  });
});
await t("[S7] one unsubscribe stops both: shared unsubscribe -> held email is not replayed", async () => {
  calls.length = 0; const env = baseEnv({ ...LIVE, ...MINT, LIVE_FOR: "admin@anthonytoday.com", TEST_TOKEN: "tt" }); const sb = fakeSupabase();
  await withSB(sb, async () => {
    const rid = await submit(env, "jane.doe@example.com");
    assert.ok(env.SC.m.get("heldmail:" + rid), "held"); assert.ok(env.SC.m.get("mail:" + rid).includes(SBTOK));
    sb.used.add("jane.doe@example.com"); env.LIVE_FOR = "all"; calls.length = 0;
    env.SC.list = async ({ prefix }) => ({ keys: [...env.SC.m.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })) }); // test-local: harness KV has no list()
    const r = await worker.fetch(new Request("https://w.example/admin/replay-held", { method: "POST", headers: { "X-Test-Token": "tt" } }), env, ctx());
    const j = await r.json(); assert.equal(r.status, 200, JSON.stringify(j));
    assert.ok(!calls.some((c) => c.url === "https://api.resend.com/emails" && JSON.parse(c.body).tags?.some((x) => x.value === "security_check_result")), "held email not sent");
  });
});
await t("[S7] one unsubscribe stops both: Worker (u1) unsubscribe -> shared system suppressed too", async () => {
  calls.length = 0; const env = baseEnv({ ...LIVE, ...U1 }); await submit(env, "jane.doe@example.com"); const u = unsubFrom(sentResultEmail()); // u1 email (mint not configured, custom UNSUB_BASE)
  Object.assign(env, MINT); const sb = fakeSupabase();
  await withSB(sb, async () => {
    assert.equal((await get(env, u, "POST")).status, 200);
    assert.ok(sb.used.has("jane.doe@example.com"), "shared system suppressed");
    const fwd = calls.filter((c) => c.url.startsWith(SB_UNSUB)); assert.ok(fwd.every((c) => !EMAIL_RE.test(c.url) && !EMAIL_RE.test(c.body)), "no email in the unsub call");
    assert.match(env.SC.m.get("unsublog:jane.doe@example.com"), /"shared_unsubscribe","ok"/);
  });
  // switch off
  const env3 = baseEnv({ ...LIVE, ...U1 }); await submit(env3, "jane.doe@example.com"); const u3 = unsubFrom(sentResultEmail()); Object.assign(env3, MINT, { UNSUB_SHARED_SYNC: "0" }); const sb3 = fakeSupabase();
  await withSB(sb3, async () => { await get(env3, u3, "POST"); assert.equal(sb3.writes, 0); });
});
await t("[S8] dry run and preview never mint or call Supabase", async () => {
  calls.length = 0; const sb = fakeSupabase();
  await withSB(sb, async () => {
    await submit(baseEnv({ ...MINT }), "jane.doe@example.com");                         // DRY_RUN=1
    await worker.fetch(new Request("https://w.example/preview/email?kind=result"), baseEnv({ ...LIVE, ...MINT }), ctx()); // preview endpoint
    await submit(baseEnv({ ...LIVE, ...MINT }), "jane.doe@example.com");                  // the one live, consented send
  });
  const sbCalls = calls.filter((c) => c.url.includes("supabase.co"));
  assert.equal(sbCalls.filter((c) => c.url === MINT.UNSUB_MINT_URL).length, 1, "only the live consented submit minted: " + sbCalls.length);
});
// MINT-01 (L-2_Security review-0025-mint): production-like env (PUBLIC_BASE = the real workers.dev host, UNSUB_BASE unset).
const PROD = { PUBLIC_BASE: "https://security-check-api.learningamazonfba.workers.dev" };
const hang = (init) => new Promise((_, rej) => init.signal.addEventListener("abort", () => rej(init.signal.reason)));
const unsubBodyLinks = (p) => [...p.html.matchAll(/<a href="([^"]+)">Unsubscribe<\/a>/g)].map((m) => m[1]).concat([...p.text.matchAll(/Unsubscribe \((https:[^)\s]+)\)/g)].map((m) => m[1]));
const WD = /workers\.dev/i;
await t("[MINT-01] mint failure and timeout (prod PUBLIC_BASE, no UNSUB_BASE) -> 0 workers.dev links in the headers and the unsubscribe body link", async () => {
  const cases = [
    ["mint 503", { ...MINT }, async () => new Response("{}", { status: 503 })],
    ["mint 401", { ...MINT }, async () => new Response("{}", { status: 401 })],
    ["mint bad token", { ...MINT }, async () => new Response(JSON.stringify({ token: "x" }), { status: 200 })],
    ["mint network error", { ...MINT }, async () => { throw new TypeError("fetch failed"); }],
    ["mint timeout", { ...MINT }, hang],
    ["mint not configured", {}, null],
    ["mint url refused", { UNSUB_MINT_URL: "https://evil.example/mint", UNSUB_MINT_TOKEN: "dummy" }, null],
  ];
  const keep = setInterval(() => {}, 1000);
  try {
    for (const [name, extra, handler] of cases) {
      calls.length = 0; const env = baseEnv({ ...LIVE, ...PROD, ...extra });
      await withSB(fakeSupabase(handler || undefined), async () => {
        const rid = await submit(env, "jane.doe@example.com");
        const p = sentResultEmail(); assert.ok(p, name + ": email sent");
        assert.equal(Object.values(p.headers).filter((v) => WD.test(v)).length, 0, name + ": 0 workers.dev in headers");
        const links = unsubBodyLinks(p); assert.equal(links.length, 2, name + ": html + text unsubscribe link");
        assert.equal(links.filter((u) => WD.test(u)).length, 0, name + ": 0 workers.dev in the unsubscribe body link");
        assert.deepEqual(links, [PAGE, PAGE], name + ": exactly the www page, no id");
        assertMailtoFallback(p, name);
        assert.match(JSON.parse(env.SC.m.get("sub:" + rid)).unsub_via, /^mailto_only \(/);
      });
    }
  } finally { clearInterval(keep); }
});
await t("[MINT-01] UNSUB_BASE on a workers.dev host (or not https) is ignored -> still mailto-only", async () => {
  for (const ub of ["https://security-check-api.learningamazonfba.workers.dev/unsubscribe", "https://x.WORKERS.DEV", "http://unsub.example/unsubscribe", "javascript:alert(1)"]) {
    calls.length = 0; const env = baseEnv({ ...LIVE, ...PROD, ...MINT, UNSUB_BASE: ub });
    await withSB(fakeSupabase(async () => new Response("{}", { status: 503 })), async () => {
      await submit(env, "jane.doe@example.com"); const p = sentResultEmail();
      assertMailtoFallback(p, ub); assert.ok(!WD.test(JSON.stringify(p.headers)) && !unsubBodyLinks(p).some((u) => WD.test(u)), ub);
    });
  }
});
await t("[MINT-01] success path unchanged (prod PUBLIC_BASE): www ?id=<24>&l=en body link, supabase.co one-click + Post header", async () => {
  calls.length = 0; const env = baseEnv({ ...LIVE, ...PROD, ...MINT });
  await withSB(fakeSupabase(), async () => {
    await submit(env, "jane.doe@example.com"); const p = sentResultEmail();
    assert.deepEqual(p.headers, { "List-Unsubscribe": MAILTO_LU + ", <" + SB_UNSUB + "?id=" + SBTOK + "&l=en&oc=1>", "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" });
    assert.deepEqual(unsubBodyLinks(p), [(PAGE + "?id=" + SBTOK + "&l=en").replace(/&/g, "&amp;"), PAGE + "?id=" + SBTOK + "&l=en"]);
  });
});
await t("[MINT-01] held fallback email is stored and replayed mailto-only (no workers.dev)", async () => {
  calls.length = 0; const env = baseEnv({ ...LIVE, ...PROD, ...MINT, LIVE_FOR: "admin@anthonytoday.com", TEST_TOKEN: "tt" });
  await withSB(fakeSupabase(async () => new Response("{}", { status: 503 })), async () => {
    const rid = await submit(env, "jane.doe@example.com");
    assert.ok(env.SC.m.get("heldmail:" + rid), "held"); const stored = JSON.parse(env.SC.m.get("mail:" + rid)); assertMailtoFallback(stored, "stored");
    env.LIVE_FOR = "all"; calls.length = 0;
    env.SC.list = async ({ prefix }) => ({ keys: [...env.SC.m.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })) });
    const r = await worker.fetch(new Request("https://w.example/admin/replay-held", { method: "POST", headers: { "X-Test-Token": "tt" } }), env, ctx());
    assert.equal(r.status, 200); const p = sentResultEmail(); assert.ok(p, "replayed"); assertMailtoFallback(p, "replayed");
  });
});
console.log(results.n + " passed");
