// Scoring per tech spec (PROPOSAL, Open Decision 3). Pure functions, no I/O.
export function levelFor(score, levels) {
  for (const l of levels) if (score >= l.min && score <= l.max) return l;
  return levels[0];
}

export function score(data, answers, teamSize) {
  const pts = data.scoring.points;
  const solo = teamSize === "solo";
  const qById = Object.fromEntries(data.questions.map((q) => [q.id, q]));
  let earned = 0, possible = 0;
  const perQuestion = [];
  for (const q of data.questions) {
    const a = answers[q.id];
    if (a === "NA") { perQuestion.push({ id: q.id, answer: "NA", points: null }); continue; }
    earned += pts[a]; possible += 10;
    perQuestion.push({ id: q.id, answer: a, points: pts[a] });
  }
  const pq = Object.fromEntries(perQuestion.map((p) => [p.id, p]));
  const domains = data.domains.map((d) => {
    let e = 0, p = 0;
    for (const id of d.questions) if (pq[id].points !== null) { e += pq[id].points; p += 10; }
    if (p === 0) return { id: d.id, name: d.name, score: null, level: null, levelName: "Not applicable" };
    const s = Math.round((e / p) * 100);
    const l = levelFor(s, data.scoring.levels);
    return { id: d.id, name: d.name, score: s, level: l.level, levelName: l.name };
  });
  const scored = domains.filter((d) => d.score !== null);
  const overallLevel = Math.min(...scored.map((d) => d.level));
  const overall = data.scoring.levels.find((l) => l.level === overallLevel);
  let weakest = scored[0];
  for (const d of scored) if (d.score < weakest.score) weakest = d;
  const total = possible ? Math.round((earned / possible) * 100) : 0;

  const flags = data.scoring.critical_flags
    .filter((f) => f.answers.includes(answers[f.question]))
    .map((f) => { const c = (f.copy || {})[answers[f.question]] || {}; return { id: f.id, label: f.label, question: f.question, answer: answers[f.question], headline: c.headline || "", why: c.why || "", riskName: c.risk_name || "", riskTitle: c.risk_title_long || c.risk_name || "" }; });
  const flagBy = Object.fromEntries(flags.map((f) => [f.question, f]));
  const flagQs = new Set(flags.map((f) => f.question));
  const order = data.scoring.tie_order;
  const risks = perQuestion
    .filter((p) => p.points !== null && p.points < 10)
    .sort((x, y) => {
      const fx = flagQs.has(x.id) ? 0 : 1, fy = flagQs.has(y.id) ? 0 : 1;
      if (fx !== fy) return fx - fy;
      if (x.points !== y.points) return x.points - y.points;
      return order.indexOf(x.id) - order.indexOf(y.id);
    })
    .map((p) => ({ id: p.id, title: (flagBy[p.id] && flagBy[p.id].riskTitle) || qById[p.id].title, answer: p.answer, points: p.points, critical: flagQs.has(p.id), domain: qById[p.id].domain }));
  const strengths = perQuestion.filter((p) => p.points === 10).map((p) => ({ id: p.id, title: qById[p.id].title }));

  return {
    version: data.version, solo, total, earned, possible,
    level: overall.level, levelName: overall.name,
    weakestDomain: weakest ? weakest.name : null,
    domains, flags, topRisks: risks.slice(0, 3), allRisks: risks, strengths, perQuestion,
  };
}
