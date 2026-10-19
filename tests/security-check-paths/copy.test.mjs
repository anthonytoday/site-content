// 0005 copy rules: good-shape sentence (PM 11:18 rule), level note, annual line, US dates, /f/ repeated steps. Run: node copy.test.mjs
import fs from "fs";
const W = new URL("../../workers/security-check-api/", import.meta.url).pathname;
const data = JSON.parse(fs.readFileSync(W + "src/quiz-data.json", "utf8"));
const { score } = await import(W + "src/scoring.js");
const { computeTokens, actionRows, fmtDate, fmtRange } = await import(W + "src/tokens.js");
const { goodShapeSentence, COPY } = await import(W + "src/copy.js");
const { transform } = await import(W + "src/notion-tpl.js");
const { renderActionPlan } = await import(W + "src/render.js");
let fails = 0; const ok = (c, l) => { console.log((c ? "PASS " : "FAIL ") + l); if (!c) fails++; };
const eq = (a, b, l) => ok(a === b, `${l}: ${JSON.stringify(a)}${a === b ? "" : " (want " + JSON.stringify(b) + ")"}`);
const base = { q1: "B", q2: "B", q3: "C", q4: "B", q5: "B", q6: "B", q7: "B", q8: "C", q9: "A", q10: "B", q11: "C", q12: "B" }; // Example Co
const tok = (answers, team = "11-24", kind = "free") => { const sub = { name: "Anthony Test", company: "Example Co", email: "a@b.co", team_size: team, plan: "plus", result_id: "r0", submitted_at: "2026-10-19T07:05:23Z", paid_at: "2026-10-19T07:05:39Z", answers }; const r = score(data, answers, team); return { r, sub, T: computeTokens(data, sub, r, { maturity_base: "https://x" }, kind) }; };
// Sentence grammar, 0 to 4 areas (Domain Profile order, first word capitalized, Oxford comma).
eq(goodShapeSentence([]), "", "0 areas: line omitted");
eq(goodShapeSentence(["governance"]), "Admin rights are in good shape.", "1 area, plural label");
eq(goodShapeSentence(["sharing"]), "Sharing is in good shape.", "1 area, singular label");
eq(goodShapeSentence(["integrations", "governance"]), "Connected apps and admin rights are both in good shape.", "2 areas");
eq(goodShapeSentence(["identity", "integrations", "governance"]), "Sign-in and accounts, connected apps, and admin rights are all in good shape.", "3 areas");
eq(goodShapeSentence(["identity", "sharing", "integrations", "governance"]), "Sign-in and accounts, sharing, connected apps, and admin rights are all in good shape.", "4 areas");
// Example Co: Admin rights (Q9) is full marks, but Default Access (Q10, same area) is listed under Other Risks to Watch, so no area qualifies.
{ const { T } = tok(base); eq(T.good_shape_sentence, "", "Example Co (Q10 Default Access is an open risk in Governance): no good-shape line"); }
{ const { T } = tok({ ...base, q10: "A" }); eq(T.good_shape_sentence.trim(), "Admin rights are in good shape.", "Example Co with Q10 = A"); }
{ const { T } = tok({ ...base, q3: "A", q4: "A", q10: "A" }); eq(T.good_shape_sentence.trim(), "Sharing and admin rights are both in good shape.", "2 areas end to end"); }
{ const { T } = tok({ ...base, q1: "A", q2: "A", q3: "A", q4: "A", q10: "A" }); eq(T.good_shape_sentence.trim(), "Sign-in and accounts, sharing, and admin rights are all in good shape.", "3 areas end to end"); }
// Invariant over many answer sets: an area with an open risk or a fix never appears.
{ const opts = ["A", "B", "C", "D"]; let bad = 0, seen = 0; let seed = 7; const rnd = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
  const qDom = Object.fromEntries(data.questions.map((x) => [x.id, x.domain]));
  for (let n = 0; n < 2000; n++) { const a = {}; for (const q of data.questions) a[q.id] = rnd() < 0.55 ? "A" : opts[Math.floor(rnd() * 4)];
    for (const kind of ["free", "fixlist"]) { const { r, sub, T } = tok(a, "11-24", kind); const acts = actionRows(data, r, sub.paid_at, sub.plan);
      for (const id of T.good_shape_areas) { seen++; const d = r.domains.find((x) => x.id === id); if (r.perQuestion.some((x) => qDom[x.id] === id && x.points !== null && x.points < 10) || acts.some((x) => x.domain === d.name)) bad++; } } }
  ok(bad === 0 && seen > 0, `no area with an open risk or a fix in the good-shape line (2000 answer sets x 2 kinds, ${seen} area mentions, ${bad} bad)`); }
// Item 6 and dates.
{ const { T } = tok(base); eq(T.level_note, "Average score 53/100. Your level is set by your lowest area, so it can be lower than your average suggests.", "level note"); eq(T.report_date, "Oct 19, 2026", "report date US format"); }
eq(fmtRange("2026-10-19", "2026-10-23"), "Oct 19 to Oct 23, 2026", "phase range");
eq(fmtRange("2026-12-29", "2027-01-02"), "Dec 29, 2026 to Jan 2, 2027", "phase range across years");
// Templates (repo snapshots): callout line, gray note under the Domain Profile table, summary sentence, annual line.
const flat = (bs) => bs.flatMap((b) => [((b[b.type] || {}).rich_text || []).map((x) => x.text?.content ?? x.plain_text ?? "").join(""), ...((b[b.type] || {}).cells || []).map((c) => c.map((x) => x.text?.content ?? "").join("")), ...(b.children ? flat(b.children) : [])]);
for (const [name, kind] of [["free-result", "free"], ["fixlist", "fixlist"]]) {
  const blocks = JSON.parse(fs.readFileSync(W + "templates/notion-" + name + ".blocks.json", "utf8"));
  const { T } = tok(base, "11-24", kind); const out = transform(blocks, T); const lines = flat(out); const all = lines.join("\n");
  ok(!/weakest areas, not the average/.test(all), `${name}: old callout line gone`);
  ok(lines.filter((l) => l.includes(T.level_note)).length === 2, `${name}: level note in the callout and under the Domain Profile table`);
  const ti = out.findIndex((b) => b.type === "table" && b.children && (b.children[0].table_row.cells[0] || []).map((x) => x.text?.content).join("") === "Area");
  ok(ti >= 0 && out[ti + 1].type === "paragraph" && out[ti + 1].paragraph.rich_text[0].text.content === T.level_note && out[ti + 1].paragraph.rich_text[0].annotations.color === "gray", `${name}: gray note directly under the Domain Profile table`);
  ok(!/in good shape/.test(all), `${name}: Example Co has no good-shape line`);
  const summ = lines.find((l) => /It sits at Level/.test(l)); console.log("   " + name + " summary: " + summ);
  ok(/\(53\/100\)\. Old public pages, unreviewed access and an unmapped recovery path /.test(summ), `${name}: summary sentence without the good-shape part`);
  if (kind === "fixlist") { ok(lines.includes("Annual: $2,970/year, billed once a year."), "fixlist: annual line"); ok(!/Annual: \$2,970\. Cancel/.test(all), "fixlist: old annual line gone");
    ok(lines.some((l) => /^\$347\/mo founding rate.*then \$490\/mo\. Cancel any time\./.test(l)), "fixlist: Cancel any time on the monthly line only"); ok((all.match(/Cancel any time/g) || []).length === 1, "fixlist: Cancel any time appears once"); }
  { const { T: T2 } = tok({ ...base, q10: "A" }, "11-24", kind); const s2 = flat(transform(blocks, T2)).find((l) => /It sits at Level/.test(l)); console.log("   " + name + " summary (Q10 = A): " + s2); ok(/\)\. Admin rights are in good shape\. [A-Z]/.test(s2), `${name}: good-shape sentence stands on its own`); }
}
// /f/: a repeated step block shows once; later items point back by number.
{ const { r, sub } = tok(base, "11-24", "fixlist"); const rows = actionRows(data, r, sub.paid_at, sub.plan); const h = renderActionPlan(rows, fmtRange);
  const hows = rows.map((x) => x.how); const dup = hows.length - new Set(hows).size;
  ok((h.match(/Same steps as item \d+\./g) || []).length === dup, `/f/ repeats replaced (${dup})`);
  ok(/Phase 1: <span class="when">Oct 19 to Oct 23, 2026<\/span>/.test(h), "/f/ Phase 1 heading date range"); }
process.exit(fails ? 1 : 0);
