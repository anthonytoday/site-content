// Scoring bands and the recommended-level rule (L0_CEO 19 Oct 2026, 10:59 am UAE). Run: node levels.test.mjs
import fs from "fs";
const W = new URL("../../workers/security-check-api/", import.meta.url).pathname;
const data = JSON.parse(fs.readFileSync(W + "src/quiz-data.json", "utf8"));
const { levelFor, score } = await import(W + "src/scoring.js");
const { computeTokens } = await import(W + "src/tokens.js");
let fails = 0; const ok = (c, l) => { console.log((c ? "PASS " : "FAIL ") + l); if (!c) fails++; };
const L = data.scoring.levels;
for (const [s, n] of [[0, 1], [19, 1], [20, 2], [39, 2], [40, 3], [59, 3], [60, 4], [89, 4], [90, 5], [100, 5]]) ok(levelFor(s, L).level === n, `score ${s} -> Level ${n} (${levelFor(s, L).name})`);
for (const [s, n] of [[0, 1], [10, 1], [20, 2], [30, 2], [40, 3], [50, 3], [60, 4], [80, 4], [100, 5]]) ok(levelFor(s, L).level === n, `area score ${s} -> Level ${n}`);
ok(L.map((l) => l.name).join("|") === "Initial|Managed|Defined|Quantitatively Managed|Optimizing", "level names");
// Recommended = Level 4 or above = score >= 60.
const base = { q1: "B", q2: "B", q3: "C", q4: "B", q5: "B", q6: "B", q7: "B", q8: "C", q9: "A", q10: "B", q11: "C", q12: "B" };
const r = score(data, base, "11-24");
const sub = { ...base, team_size: "11-24", plan: "plus", company: "Example Co", name: "A B", email: "a@b.co", result_id: "r0", submitted_at: new Date().toISOString() };
const T = computeTokens(data, sub, r, { maturity_base: "https://x" }, "free");
const at = r.domains.filter((d) => d.score !== null && d.score >= 60).length;
ok(T.areas_at_recommended_count === String(r.domains.filter((d) => d.score === null || d.score >= 60).length), `areas at recommended = areas with score >= 60 (${T.areas_at_recommended_count})`);
ok(r.domains.some((d) => d.score === 40) && levelFor(40, L).level < 4, "fixture area at 40 is below the recommended level");
const fifty = levelFor(50, L).level >= 4, sixty = levelFor(60, L).level >= 4;
ok(!fifty && sixty, "an area at 50 is NOT at the recommended level; 60 is");
ok(T.recommended_level === "Level 4, Quantitatively Managed,", "recommended line token");
ok(T.maturity_img_url === "https://x/assets/img/security-check/maturity-level-" + r.level + ".png", "staircase image per level");
ok(/^Maturity level \d of 5: /.test(T.maturity_alt), "alt text format");
process.exit(fails ? 1 : 0);
