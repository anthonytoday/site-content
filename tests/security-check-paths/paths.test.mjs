import puppeteer from "puppeteer-core";
const BASE = process.env.BASE || "https://security-check.security-check-preview.pages.dev";
const EMAIL = process.env.EMAIL || "test+sc@anthonytoday.com";
const CHROME = process.env.CHROME || "/usr/bin/google-chrome";
const FIX_URL = process.env.FIX_URL || "";
const QS = ["q1","q2","q3","q4","q5","q6","q7","q8","q9","q10","q11","q12"];
const BASE_ANS = { q1:"B",q2:"B",q3:"C",q4:"B",q5:"B",q6:"B",q7:"B",q8:"C",q9:"A",q10:"B",q11:"C",q12:"B" };
let fails = 0; const results = [];
const ok = (cond, label) => { results.push((cond ? "PASS " : "FAIL ") + label); if (!cond) fails++; };
const click = (pg, sel) => pg.$eval(sel, (e) => e.click());

async function open(b) {
  const pg = await b.newPage(); const errs = []; const sent = [];
  pg.on("pageerror", (e) => errs.push(e.message));
  pg.on("request", (r) => { if (r.url().endsWith("/submit") && r.method() === "POST") sent.push(JSON.parse(r.postData())); });
  await pg.goto(BASE + "/security-check/", { waitUntil: "networkidle0" });
  return { pg, errs, sent };
}
async function profile(pg, team, plan) { await pg.select("#f-team", team); await pg.select("#f-role", "owner"); await pg.select("#f-plan", plan || ""); await click(pg, "#b-start"); }
async function answer(pg, q, v) { await click(pg, `#s-${q} input[value="${v}"]`); await click(pg, `#s-${q} .nxt`); }
async function onScreen(pg) { return pg.$eval(".qf .scr.on", (e) => e.id); }
let n = 0; // one address per path (plus-tag), so the per-address rate limit (12/hour) never trips the test
const pathEmail = () => EMAIL.replace("@", "-p" + (++n) + "@");
async function gate(pg, country) {
  for (const [sel, v] of [["#f-name", "Path Test"], ["#f-email", pathEmail()], ["#f-company", "Path Test Co"]]) { await pg.$eval(sel, (e) => (e.value = "")); await pg.type(sel, v); }
  if (!(await pg.$eval("#f-consent", (e) => e.checked))) await click(pg, "#f-consent");
  await pg.select("#f-country", country);
}
async function submit(pg) { await click(pg, "#b-submit"); try { await pg.waitForSelector("#s-result.on", { timeout: 25000 }); return true; } catch { return false; } }

async function path(b, label, { team, plan, ans, country, edit }) {
  const { pg, errs, sent } = await open(b);
  await profile(pg, team, plan);
  for (const q of QS) await answer(pg, q, ans[q]);
  ok((await onScreen(pg)) === "s-gate", `${label}: reached gate`);
  await gate(pg, country);
  if (edit) await edit(pg);
  const shown = await submit(pg);
  ok(sent.length >= 1, `${label}: submit request fired`);
  const body = sent[sent.length - 1] || {};
  ok(body.website === "", `${label}: honeypot empty`);
  ok(QS.every((q) => body.answers && body.answers[q]), `${label}: all 12 answers sent`);
  ok(shown, `${label}: result shown`);
  const gateErr = await pg.$eval("#e-gate", (e) => e.textContent).catch(() => "");
  ok(!gateErr, `${label}: no gate error (${gateErr || "none"})`);
  if (shown) {
    const txt = await pg.$eval("#r-card", (e) => e.innerText);
    ok(/Level \d/.test(txt), `${label}: level visible`);
    ok(!/\{\{|\}\}/.test(txt), `${label}: no unfilled placeholders on result`);
  }
  ok(errs.length === 0, `${label}: no JS errors ${errs.join(" | ")}`);
  const resultUrl = shown ? await pg.$eval("#r-card a[target=_blank]", (a) => a.href).catch(() => "") : "";
  await pg.close();
  return { body, resultUrl };
}

async function layout(b, url, label) {
  for (const w of [1280, 390, 360]) {
    const pg = await b.newPage(); await pg.setViewport({ width: w, height: 900 });
    await pg.goto(url, { waitUntil: "networkidle0" });
    const m = await pg.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth,
      empty: [...document.querySelectorAll("h1,h2,h3,h4")].filter((h) => { const sm = h.closest("summary"); if (sm) return !sm.parentElement.textContent.replace(sm.textContent, "").trim(); let n = h.nextElementSibling; while (n && !/^H[1-4]$/.test(n.tagName) && !n.textContent.trim()) n = n.nextElementSibling; return !n || /^H[1-4]$/.test(n.tagName) && Number(n.tagName[1]) <= Number(h.tagName[1]); }).map((h) => h.textContent.trim()),
      braces: /\{\{|\}\}/.test(document.body.innerText), fav: !!document.querySelector('link[rel~="icon"]') }));
    ok(m.sw <= m.iw, `${label} @${w}: no horizontal scroll (${m.sw} <= ${m.iw})`);
    ok(m.empty.length === 0, `${label} @${w}: no empty headings ${m.empty.join(", ")}`);
    ok(!m.braces, `${label} @${w}: no {{ }}`);
    if (w === 1280) ok(m.fav, `${label}: favicon link`);
    await pg.close();
  }
}

const b = await puppeteer.launch({ executablePath: CHROME, args: ["--no-sandbox"] });
try {
  const a = await path(b, "team + plan answered, UAE", { team: "11-24", plan: "plus", ans: BASE_ANS, country: "United Arab Emirates" });
  await path(b, "team, plan skipped, Algeria", { team: "5-10", plan: "", ans: BASE_ANS, country: "Algeria" });
  await path(b, "solo with N/A on Q7/Q8, France", { team: "solo", plan: "free", ans: { ...BASE_ANS, q7: "NA", q8: "NA" }, country: "France" });
  await path(b, "solo answering Q7/Q8, United States", { team: "solo", plan: "", ans: BASE_ANS, country: "United States" });
  // Back/forward edit: from the gate, go back to Q3, change the answer, walk forward again; earlier answers must survive.
  const e = await path(b, "Back/forward edit of Q3, Germany", { team: "2-4", plan: "business", ans: BASE_ANS, country: "Germany", edit: async (pg) => {
    await click(pg, "#b-gate-back"); for (let i = 12; i > 3; i--) await click(pg, `#s-q${i} .back`);
    await answer(pg, "q3", "A"); for (let i = 4; i <= 12; i++) await click(pg, `#s-q${i} .nxt`);
  } });
  ok(e.body.answers && e.body.answers.q3 === "A" && e.body.answers.q12 === "B", "Back/forward edit: edited Q3 sent, other answers kept");
  // Team size changed to solo after answering "I don't know" on Q7: the gate must jump to Q7, not dead-end.
  {
    const { pg, sent } = await open(b);
    await profile(pg, "11-24", "plus");
    for (const q of QS) await answer(pg, q, q === "q7" ? "D" : BASE_ANS[q]);
    await click(pg, "#b-gate-back"); for (let i = 12; i >= 1; i--) await click(pg, `#s-q${i} .back`);
    await pg.select("#f-team", "solo"); await click(pg, "#b-start");
    for (let i = 1; i <= 12; i++) { const id = await onScreen(pg); if (id === "s-gate") break; const q = id.slice(2); const c = await pg.$(`#${id} input:checked`); if (!c) await click(pg, `#${id} input[value="NA"]`); await click(pg, `#${id} .nxt`); }
    await gate(pg, "Algeria"); const shown = await submit(pg);
    ok(shown && sent.length && sent[sent.length - 1].answers.q7 === "NA", "team -> solo switch: Q7 re-asked, submit works");
    await pg.close();
  }
  // Server rejects one answer (e.g. a stale page): the page must jump to that exact question, not dead-end.
  {
    const { pg } = await open(b);
    await pg.setRequestInterception(true);
    pg.on("request", (r) => { if (r.url().endsWith("/submit") && r.method() === "POST") r.respond({ status: 400, contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify({ ok: false, error: "invalid", fields: ["answers.q5"] }) }); else r.continue(); });
    await profile(pg, "5-10", "");
    for (const q of QS) await answer(pg, q, BASE_ANS[q]);
    await gate(pg, "Algeria");
    await click(pg, "#b-submit"); await new Promise((r) => setTimeout(r, 1000));
    const id = await onScreen(pg); const msg = await pg.$eval(`#${id} .err`, (e) => e.textContent).catch(() => "");
    ok(id === "s-q5" && msg.length > 0, `server rejects Q5: page jumps to ${id} with "${msg}"`);
    await answer(pg, "q5", "A");
    for (let i = 6; i <= 12; i++) await click(pg, `#s-q${i} .nxt`);
    ok((await onScreen(pg)) === "s-gate" && (await pg.$eval("#f-company", (e) => e.value)) === "Path Test Co", "after fixing Q5: back at gate with fields kept");
    await pg.close();
  }
  if (a.resultUrl) await layout(b, a.resultUrl, "/r/ result page");
  if (FIX_URL) await layout(b, FIX_URL, "/f/ Fix List page");
} finally { await b.close(); }
console.log(results.join("\n")); console.log(fails ? `\n${fails} FAILED` : "\nALL PASSED"); process.exit(fails ? 1 : 0);
