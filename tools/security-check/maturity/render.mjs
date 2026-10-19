// Renders the 5 maturity staircase PNGs (one per highlighted level) from _data/security_check.yml (maturity block).
// Usage: tools/security-check/maturity/build.sh   (needs ruby, node with puppeteer-core, Google Chrome)
import fs from "fs"; import puppeteer from "puppeteer-core";
const cfg = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const out = process.argv[3];
const W = 1200, TAB = [330, 400, 470, 560, 620];
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
const html = (hl) => `<!doctype html><meta charset="utf-8"><style>
*{box-sizing:border-box;margin:0}body{width:${W}px;background:#fff;font-family:Inter,-apple-system,'Segoe UI',sans-serif;color:#051C2C;padding:40px 44px 36px}
h1{font-size:54px;font-weight:700;text-align:center;margin:0 0 34px;letter-spacing:-0.5px}
.row{display:flex;align-items:flex-end;justify-content:space-between;gap:24px;height:176px;border-bottom:5px solid var(--c);margin-bottom:18px}
.l{display:flex;gap:18px;align-items:baseline;padding-bottom:26px;flex:1;min-width:0}
.num{font-size:50px;font-weight:800;color:var(--c);min-width:52px}
.desc{font-size:36px;line-height:1.22;font-weight:500;color:#051C2C}
.row:not(.active) .desc,.row:not(.active) .num{color:#5F6B78}
.tab{background:var(--c);border-radius:34px 34px 0 0;height:156px;display:flex;flex-direction:column;justify-content:flex-end;align-items:flex-end;padding:0 32px 26px;flex:none;color:#fff}
.tab:not(.active){color:#475569}
.tab.active.l2,.tab.active.l3,.tab.active.l4{color:#051C2C}
.name{font-size:38px;font-weight:700;white-space:nowrap;line-height:1.1}
.range{font-size:30px;font-weight:500;white-space:nowrap;margin-top:4px}
.pill{background:#051C2C;color:#fff;font-size:28px;font-weight:700;border-radius:24px;padding:6px 16px;margin-bottom:8px;white-space:nowrap}
</style><h1>${esc(cfg.title)}</h1>` + cfg.levels.map((l, i) => {
  const on = l.number === hl;
  return `<div class="row${on ? " active" : ""}" style="--c:${on ? l.color : l.muted}">
  <div class="l"><span class="num">${l.number}.</span><span class="desc">${esc(l.meaning)}</span></div>
  <div class="tab l${l.number}${on ? " active" : ""}" style="min-width:${TAB[i]}px">${on ? '<span class="pill">You are here</span>' : ""}<span class="name">${esc(l.name)}</span><span class="range">(${esc(l.range)})</span></div></div>`;
}).join("");
const b = await puppeteer.launch({ executablePath: process.env.CHROME || "/usr/bin/google-chrome", args: ["--no-sandbox"] });
const pg = await b.newPage(); await pg.setViewport({ width: W, height: 900, deviceScaleFactor: 1 });
for (const l of cfg.levels) {
  await pg.setContent(html(l.number), { waitUntil: "load" });
  await pg.evaluate(() => document.fonts.ready);
  // Each tab is at least its staircase width and never narrower than its label; keep the staircase rising.
  await pg.evaluate(() => { let prev = 0; document.querySelectorAll(".tab").forEach((t) => { const need = Math.max(...[...t.children].map((c) => c.scrollWidth)) + 72; const w = Math.max(parseInt(t.style.minWidth), need); if (w < prev) throw new Error("staircase not rising: widen TAB"); t.style.width = w + "px"; prev = w; }); });
  const clip = await pg.evaluate(() => [...document.querySelectorAll(".tab, .tab *, .desc")].filter((e) => e.scrollWidth > e.clientWidth + 1 || e.getBoundingClientRect().right > document.body.clientWidth).map((e) => e.className + ":" + e.textContent));
  if (clip.length) throw new Error("clipped: " + clip.join(" | "));
  const h = await pg.evaluate(() => document.body.scrollHeight);
  await pg.setViewport({ width: W, height: h, deviceScaleFactor: 1 });
  await pg.screenshot({ path: `${out}/maturity-level-${l.number}.png`, clip: { x: 0, y: 0, width: W, height: h } });
  console.log(`${out}/maturity-level-${l.number}.png`, W + "x" + h);
}
await b.close();
