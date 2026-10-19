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
const flatRt = (bs) => flat(bs);
const flat = (bs) => bs.flatMap((b) => [((b[b.type] || {}).rich_text || []).map((x) => x.text?.content ?? x.plain_text ?? "").join(""), ...((b[b.type] || {}).cells || []).map((c) => c.map((x) => x.text?.content ?? "").join("")), ...(b.children ? flat(b.children) : [])]);
// Item 7, per question (PM pick b): grammar for 0, 1, 2, 3, 4 and 6 labels.
eq(goodShapeSentence([]), "", "0 labels: line omitted");
eq(goodShapeSentence(["q9"]), "Admin rights are in good shape.", "1 label, 'are'");
eq(goodShapeSentence(["q1"]), "Sign-in security is in good shape.", "1 label, 'is'");
eq(goodShapeSentence(["q3", "q9"]), "Public pages and admin rights are both in good shape.", "2 labels");
eq(goodShapeSentence(["q1", "q2", "q9"]), "Sign-in security, account setup, and admin rights are all in good shape.", "3 labels");
eq(goodShapeSentence(["q1", "q2", "q5", "q9"]), "Sign-in security, account setup, connected apps, and 1 more are in good shape.", "4 labels");
eq(goodShapeSentence(["q1", "q2", "q3", "q4", "q5", "q9"]), "Sign-in security, account setup, public pages, and 3 more are in good shape.", "6 labels");
{ const want = { q1: "Sign-in security is", q2: "Account setup is", q3: "Public pages are", q4: "Sensitive data handling is", q5: "Connected apps are", q6: "AI tool access is", q7: "Offboarding is", q8: "Access reviews are", q9: "Admin rights are", q10: "Default access is", q11: "Recovery readiness is", q12: "Change history is" };
  ok(Object.entries(want).every(([q, w]) => goodShapeSentence([q]) === w + " in good shape."), "label and verb table Q1 to Q12"); }
// Example Co (exact).
{ const { T } = tok(base); eq(T.good_shape_sentence.trim(), "Admin rights are in good shape.", "Example Co good-shape line (exact)"); }
{ const { T } = tok(base, "11-24", "fixlist"); eq(T.good_shape_sentence.trim(), "Admin rights are in good shape.", "Example Co good-shape line on the Fix List (exact)"); }
// End to end, the line follows the answers.
{ const { T } = tok({ ...base, q1: "A", q2: "A" }); console.log("   q1, q2, q9 = A -> " + T.good_shape_sentence + "(" + T.good_shape_questions.join(",") + ")"); ok(T.good_shape_questions.every((q) => ["q1", "q2", "q9"].includes(q)), "only full-point questions named"); }
// N/A never counts (solo, Q7/Q8 N/A).
{ const a = { ...base, q7: "NA", q8: "NA" }; const { T, r } = tok(a, "solo"); ok(r.perQuestion.filter((x) => x.points === null).length === 2 && !T.good_shape_questions.some((q) => q === "q7" || q === "q8"), "N/A answers (solo Q7/Q8) never named: " + JSON.stringify(T.good_shape_sentence)); }
// Invariant: a named question scored full points and has no fix or action in the result.
{ const opts = ["A", "B", "C", "D"]; let bad = 0, seen = 0; let seed = 7; const rnd = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
  for (let n = 0; n < 2000; n++) { const a = {}; for (const q of data.questions) a[q.id] = rnd() < 0.55 ? "A" : opts[Math.floor(rnd() * 4)];
    for (const kind of ["free", "fixlist"]) { const { r, sub, T } = tok(a, "11-24", kind); const acts = actionRows(data, r, sub.paid_at, sub.plan);
      for (const id of T.good_shape_questions) { seen++; const x = r.perQuestion.find((p) => p.id === id); if (x.points !== 10 || acts.some((y) => y.qid === id && !y.routine)) bad++; } } }
  ok(bad === 0 && seen > 0, `named questions all scored 10 with no gap fix (2000 answer sets x 2 kinds, ${seen} names, ${bad} bad)`); }
// PM 11:46: routine upkeep actions don't block. All A names every question (Q1 to Q12 order).
{ const all = Object.fromEntries(data.questions.map((q) => [q.id, "A"]));
  for (const kind of ["free", "fixlist"]) { const { T, r, sub } = tok(all, "11-24", kind);
    eq(T.good_shape_sentence.trim(), "Sign-in security, account setup, public pages, and 9 more are in good shape.", `all A (${kind}), routine actions present: ${actionRows(data, r, sub.paid_at, sub.plan).filter((x) => x.routine).map((x) => x.id + "->" + x.qid).join(", ")}`); } }
// Q3 root cause: routine action A-18 (access reviews, People) is also a secondary fix for Q3; it must attach to its own area (Q8).
{ const all = Object.fromEntries(data.questions.map((q) => [q.id, "A"])); const { r, sub } = tok(all); const rows = actionRows(data, r, sub.paid_at, sub.plan);
  const qDom = Object.fromEntries(data.questions.map((x) => [x.id, x.domain])), dName = Object.fromEntries(data.domains.map((d) => [d.id, d.name]));
  ok(rows.every((x) => !x.qid || dName[qDom[x.qid]] === x.domain), "every action is attached to a question in its own area: " + rows.map((x) => x.id + "->" + x.qid).join(", ")); }
// Guard C: no risks -> no gaps sentence and no biggest-difference sentence, nothing dangling.
{ const all = Object.fromEntries(data.questions.map((q) => [q.id, "A"]));
  for (const [name, kind] of [["free-result", "free"], ["fixlist", "fixlist"]]) {
    const { T, r } = tok(all, "11-24", kind); const blocks = JSON.parse(fs.readFileSync(W + "templates/notion-" + name + ".blocks.json", "utf8"));
    const summ = flatRt(transform(blocks, T)).find((l) => /It sits at Level/.test(l)); console.log("   " + name + " no-risk summary: " + summ);
    ok(r.topRisks.length === 0 && T.gaps_sentence === "" && T.biggest_impact_sentence === "", `${name}: no risks -> empty gaps and impact tokens`);
    ok(!/leave gaps|exposed|biggest difference|a few gaps|  |\s$|\.\s*\.|\(\s*\)/.test(summ), `${name}: no-risk summary has nothing empty or dangling`); } }
// Item 6 and dates.
{ const { T } = tok(base); eq(T.level_note, "Average score 53/100. Your level is set by your lowest area, so it can be lower than your average suggests.", "level note"); eq(T.report_date, "Oct 19, 2026", "report date US format"); }
eq(fmtRange("2026-10-19", "2026-10-23"), "Oct 19 to Oct 23, 2026", "phase range");
eq(fmtRange("2026-12-29", "2027-01-02"), "Dec 29, 2026 to Jan 2, 2027", "phase range across years");
// Templates (repo snapshots): callout line, gray note under the Domain Profile table, summary sentence, annual line.
for (const [name, kind] of [["free-result", "free"], ["fixlist", "fixlist"]]) {
  const blocks = JSON.parse(fs.readFileSync(W + "templates/notion-" + name + ".blocks.json", "utf8"));
  const { T } = tok(base, "11-24", kind); const out = transform(blocks, T); const lines = flat(out); const all = lines.join("\n");
  ok(!/weakest areas, not the average/.test(all), `${name}: old callout line gone`);
  ok(lines.filter((l) => l.includes(T.level_note)).length === 2, `${name}: level note in the callout and under the Domain Profile table`);
  const ti = out.findIndex((b) => b.type === "table" && b.children && (b.children[0].table_row.cells[0] || []).map((x) => x.text?.content).join("") === "Area");
  ok(ti >= 0 && out[ti + 1].type === "paragraph" && out[ti + 1].paragraph.rich_text[0].text.content === T.level_note && out[ti + 1].paragraph.rich_text[0].annotations.color === "gray", `${name}: gray note directly under the Domain Profile table`);
  ok(lines.filter((l) => /in good shape/.test(l)).length === 1 && /\(53\/100\)\. Admin rights are in good shape\. Old public pages/.test(all), `${name}: Example Co good-shape sentence in the summary`);
  const summ = lines.find((l) => /It sits at Level/.test(l)); console.log("   " + name + " summary: " + summ);

  if (kind === "fixlist") { ok(lines.includes("Annual: $2,970/year, billed once a year."), "fixlist: annual line"); ok(!/Annual: \$2,970\. Cancel/.test(all), "fixlist: old annual line gone");
    ok(lines.some((l) => /^\$347\/mo founding rate.*then \$490\/mo\. Cancel any time\./.test(l)), "fixlist: Cancel any time on the monthly line only"); ok((all.match(/Cancel any time/g) || []).length === 1, "fixlist: Cancel any time appears once"); }

}
// /f/: a repeated step block shows once; later items point back by number.
{ const { r, sub } = tok(base, "11-24", "fixlist"); const rows = actionRows(data, r, sub.paid_at, sub.plan); const h = renderActionPlan(rows, fmtRange);
  const hows = rows.map((x) => x.how); const dup = hows.length - new Set(hows).size;
  ok((h.match(/Same steps as item \d+\./g) || []).length === dup, `/f/ repeats replaced (${dup})`);
  ok(/Phase 1: <span class="when">Oct 19 to Oct 23, 2026<\/span>/.test(h), "/f/ Phase 1 heading date range"); }
process.exit(fails ? 1 : 0);
