// Computes every placeholder in /workspace/marketing/security-check-template-placeholders.md.
// Scalar tokens are strings. List tokens are arrays of items {b: bold lead, t: text, url?}.
// Typed values (first_name, company) are inserted as plain text; callers escape for HTML.
const DOMAIN_SHORT = { identity: "Identity", sharing: "Sharing", integrations: "Integrations", people: "People", governance: "Governance", resilience: "Resilience" };
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const lc = (s) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s);
const joinAnd = (a) => (a.length <= 1 ? a.join("") : a.slice(0, -1).join(", ") + " and " + a[a.length - 1]);
export const bar = (s) => (s === null ? "N/A" : "▰".repeat(Math.floor(s / 10)) + "▱".repeat(10 - Math.floor(s / 10)));
export const fmtDate = (d) => new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Dubai" });

// Plan feature library (Free page "Already in Your Plan"). Plus texts are from the SAMPLE free page.
// Free/Business/Enterprise/"Not sure" lines follow the placeholder map; PM to confirm wording.
const F = {
  guests: { q: ["q2"], b: "Unlimited guests", t: " (Free stops at 10): freelancers and clients can be guests on their own pages instead of full members.", url: "https://www.notion.com/pricing" },
  hist7: { q: ["q11", "q12"], b: "7 days of page history:", t: " restore any page to how it looked in the last 7 days.", url: "https://www.notion.com/help/duplicate-delete-and-restore-content" },
  hist30: { q: ["q11", "q12"], b: "30 days of page history:", t: " restore any page to how it looked in the last 30 days.", url: "https://www.notion.com/help/duplicate-delete-and-restore-content" },
  hist90: { q: ["q11", "q12"], b: "90 days of page history:", t: " restore any page to how it looked in the last 90 days.", url: "https://www.notion.com/help/duplicate-delete-and-restore-content" },
  histU: { q: ["q11", "q12"], b: "Unlimited page history:", t: " restore any page to any earlier version.", url: "https://www.notion.com/help/duplicate-delete-and-restore-content" },
  closed: { q: ["q10"], b: "Closed teamspaces:", t: " keep finance, HR or client areas closed to people who aren't invited.", url: "https://www.notion.com/help/intro-to-teamspaces" },
  groups: { q: ["q8"], b: "Permission groups:", t: " give access by role instead of person by person.", url: "https://www.notion.com/pricing" },
  lock: { q: ["q10"], b: "Lock page:", t: " stops accidental edits on key pages.", url: "https://www.notion.com/help/collaborate-within-a-workspace" },
  requests: { q: ["q2"], b: "Block access requests from outsiders:", t: " Plus lets you turn off page access requests from non-members (Free can't).", url: "https://www.notion.com/help/add-members-admins-guests-and-groups" },
  twostep: { q: ["q1"], b: "2-step verification:", t: " every person can turn it on in Settings → your name → Account security.", url: "https://www.notion.com/help/two-step-verification" },
  private: { q: ["q10"], b: "Private teamspaces:", t: " hidden from people who aren't added.", url: "https://www.notion.com/pricing" },
  saml: { q: ["q1"], b: "SAML SSO:", t: " sign-in through your company identity provider.", url: "https://www.notion.com/help/saml-sso-configuration" },
  csv: { q: ["q8"], b: "Export members as CSV:", t: " review the member list offline, in Settings → General.", url: "https://www.notion.com/help/workspace-settings" },
  audit: { q: ["q6", "q12"], b: "Audit log:", t: " see who changed, shared or connected what.", url: "https://www.notion.com/help/audit-log" },
  scim: { q: ["q7"], b: "User provisioning (SCIM):", t: " people are removed automatically when they leave your identity provider.", url: "https://www.notion.com/pricing" },
  mfa: { q: ["q1"], b: "Require MFA for guests:", t: " organization owners can require it.", url: "https://www.notion.com/help/two-step-verification" },
  nopub: { q: ["q3"], b: "Disable publishing:", t: " turn off publishing sites, forms and public links in Settings → Security.", url: "https://www.notion.com/help/public-pages-and-web-publishing" },
};
const PLAN_FEATURES = {
  plus: ["guests", "hist30", "closed", "groups", "lock", "requests"],
  free: ["hist7", "closed", "groups", "lock", "twostep"],
  business: ["guests", "hist90", "closed", "groups", "lock", "requests", "private", "saml", "csv"],
  enterprise: ["guests", "histU", "closed", "groups", "lock", "requests", "private", "saml", "csv", "audit", "scim", "mfa", "nopub"],
  not_sure: ["guests", "hist30", "closed", "groups", "lock", "requests"],
};

export function computeTokens(data, sub, r, links, kind = "free") {
  const q = Object.fromEntries(data.questions.map((x) => [x.id, x]));
  const pq = Object.fromEntries(r.perQuestion.map((x) => [x.id, x]));
  const label = (list, v) => (list.find((o) => o.value === v) || {}).label || "";
  const T = {};
  T.first_name = sub.name.split(" ")[0];
  T.company = sub.company;
  T.work_email = sub.email;
  T.team_size = sub.team_size === "solo" ? "1" : label(data.profile.team_size, sub.team_size);
  T.plan = sub.plan === "not_sure" ? "Notion" : label(data.profile.plan, sub.plan);
  T.report_date = fmtDate(kind === "fixlist" && sub.paid_at ? sub.paid_at : sub.submitted_at);
  T.overall_score = String(r.total); T.overall_level = r.levelName; T.overall_level_number = String(r.level);
  for (const d of r.domains) {
    T["area_" + d.id + "_score"] = d.score === null ? "N/A" : String(d.score);
    T["area_" + d.id + "_bar"] = bar(d.score);
    T["area_" + d.id + "_level"] = d.score === null ? "N/A" : d.levelName;
  }
  T.points_earned = String(r.earned); T.points_possible = String(r.possible);
  const flagged = new Set(r.flags.map((f) => f.question));
  for (const x of r.perQuestion) {
    T[x.id + "_answer"] = x.answer === "NA" ? q[x.id].solo_na : q[x.id].answers[x.answer].text;
    T[x.id + "_score"] = x.points === null ? "N/A" : flagged.has(x.id) ? x.points + ", flag" : String(x.points);
  }
  const managed = r.domains.filter((d) => d.level !== null && d.level >= 3);
  const snip = data.strength_snippets || {};
  T.strength_summary = managed.length ? joinAnd(managed.map((d) => snip[d.id] || d.name.toLowerCase() + " is in good shape")) : "a few basics are in place";
  const top = r.topRisks;
  const short = (x) => (data.risk_short_names || {})[x.id] || lc(q[x.id].title);
  T.top_risks_summary = joinAnd(top.map(short)) || "a few gaps";
  T.exposure_summary = top.some((x) => x.domain === "sharing" || x.domain === "integrations") ? "leave client material exposed" : "leave gaps an outsider could use";
  T.biggest_impact_sentence = top[0] ? "Closing " + short(top[0]) + " first makes the biggest difference" + (kind === "fixlist" && top[1] ? ", followed by " + short(top[1]) + "." : ".") : "";
  T.main_risk = top[0] ? cap(q[top[0].id].risk) : "No major risk found in your answers.";
  // Action plan (copy v1, B3) drives Do First and the delivery email Phase 1 line.
  const plan_rows = actionRows(data, r, kind === "fixlist" && sub.paid_at ? sub.paid_at : sub.submitted_at, sub.plan);
  const p1 = plan_rows.filter((x) => x.phase === "Phase 1");
  T.do_first = p1[0] ? p1[0].action : top[0] ? q[top[0].id].fixes[0].text : "";
  T.phase_1_count = p1.length ? String(p1.length) : "";
  T.phase_1_fix_word = p1.length === 1 ? "fix" : "fixes";
  T.top_action_title_plain = p1[0] ? p1[0].plain : "";
  // Critical flags (copy v1, C): callout shows "**{flag_name} (Qn).** {headline}"; the first ends with the "first thing to fix" line.
  const suffix = data.scoring.flag_first_suffix || "";
  T.flags = r.flags.map((f, i) => ({ b: f.label + " (Q" + q[f.question].number + "). ", t: f.headline + (i === 0 && suffix ? " " + suffix : "") }));
  T.flag_count = String(r.flags.length);
  T.flag_names = r.flags.map((f) => (f.riskTitle || f.label).toLowerCase()).join(", ");
  // Quick wins: public pages (hide if Q3 = A, use 2-step), 2-step (hide if Q1 = A, use Lock key pages).
  const qw = data.quick_wins;
  const wins = [];
  if (pq.q3.answer !== "A") wins.push(qw[0]);
  if (pq.q1.answer !== "A") wins.push(qw[1]);
  for (const w of [qw[1], qw[2]]) if (wins.length < 2 && !wins.includes(w) && !(w.question === "q1" && pq.q1.answer === "A")) wins.push(w);
  T.quick_wins = wins.slice(0, 2).map((w) => ({ b: w.title + ". ", t: w.text + " ", url: w.source, urlText: "Notion help" }));
  T.quick_win_1 = wins[0] ? wins[0].email : "";
  T.strengths = r.perQuestion.filter((x) => x.points === 10).map((x) => q[x.id].title).join(", ");
  T.priority_risks = r.perQuestion.filter((x) => x.points !== null && x.points <= 2 && !flagged.has(x.id)).map((x) => ({ b: q[x.id].title + ". ", t: cap(q[x.id].risk) }));
  T.risk_list = r.perQuestion.filter((x) => x.points === 6).map((x) => ({ b: q[x.id].title + ": ", t: q[x.id].risk }));
  T.other_risk_count = String(T.risk_list.length);
  const plan = sub.plan || "not_sure";
  top.forEach((x, i) => {
    const n = i + 1, qq = q[x.id];
    const notes = (qq.plan_notes || []).filter((p) => plan === "not_sure" || p.plans.includes("all") || p.plans.includes(plan));
    const fl = r.flags.find((f) => f.question === x.id);
    T["risk_" + n + "_title"] = x.title; T["risk_" + n + "_title_lower"] = x.title.toLowerCase();
    T["risk_" + n + "_control"] = cap(qq.control); T["risk_" + n + "_question"] = "Q" + qq.number; T["risk_" + n + "_score"] = String(x.points);
    T["risk_" + n + "_why"] = fl && fl.why ? fl.why : cap(qq.risk);
    T["risk_" + n + "_impact"] = ((data.risk_impacts || {})[x.id] || {})[x.answer] || "You answered: " + qq.answers[x.answer].text; // copy v1 A; fallback only if a line is missing
    T["risk_" + n + "_fix"] = qq.fixes.map((f) => f.text).join(" ");
    T["risk_" + n + "_plan_note"] = notes.map((p) => p.text).join(" ") || "Works the same on every plan.";
    const src = qq.fixes.find((f) => f.source) || notes.find((p) => p.source);
    T["risk_" + n + "_source_link"] = src ? { link: src.source, text: "Notion help" } : "";
  });
  T.recommended_level = data.scoring.recommended_level;
  const below = r.domains.filter((d) => d.level !== null && d.level < 3);
  T.areas_at_recommended_count = String(r.domains.filter((d) => d.level === null || d.level >= 3).length);
  T.areas_below_recommended = below.length ? joinAnd(below.map((d) => DOMAIN_SHORT[d.id])) : "No area";
  const gap = below.length ? Math.max(...below.map((d) => 3 - d.level)) : 0;
  T.below_recommended_verb = below.length === 0 ? "is" : (below.length === 1 ? "is " : "are ") + (gap === 2 ? "two levels" : "one level");
  T.peer_comparison_enabled = ""; T.peer_comparison_text = "";
  T.plan_features_unused = (PLAN_FEATURES[plan] || PLAN_FEATURES.plus).map((k) => F[k]).filter((f) => f.q.some((id) => pq[id].points !== null && pq[id].points < 10))
    .map((f) => ({ b: f.b, t: f.t + " ", url: f.url, urlText: f.url.includes("pricing") ? "Pricing" : "Notion help" }));
  if (plan === "not_sure" && T.plan_features_unused.length) T.plan_features_unused.push({ b: "", t: "Check your plan in Settings → Billing." });
  T.result_id = sub.result_id || "";
  T.stripe_link = links.fixlist || ""; T.result_url = links.result || ""; T.fixlist_url = links.fixlist_page || "";
  return T;
}

// Mini template engine for emails: {{x}}, {{#if x}}..{{else}}..{{/if}}. List tokens render as text.
const truthy = (v) => (Array.isArray(v) ? v.length > 0 : !!v);
export function renderString(tpl, T, escFn) {
  let s = tpl;
  for (let i = 0; i < 5 && /\{\{#if /.test(s); i++)
    s = s.replace(/\{\{#if (\w+)\}\}((?:(?!\{\{#if )[\s\S])*?)(?:\{\{else\}\}((?:(?!\{\{#if )[\s\S])*?))?\{\{\/if\}\}/g, (m, k, a, b) => (truthy(T[k]) ? a : b || ""));
  return s.replace(/\{\{(\w+)\}\}/g, (m, k) => {
    if (!(k in T)) return m;
    let v = T[k];
    if (Array.isArray(v)) v = v.map((x) => (x.b || "") + (x.t || "")).join("; ");
    else if (v && typeof v === "object") v = v.link;
    return escFn ? escFn(String(v)) : String(v);
  });
}

// Action plan rows per copy v1 section B3 (5 to 7 rows). Owner Role is left at the template default (empty);
// Impact is the impact line of the answer that brought the action in (template placeholder {{action_n_impact}}).
export function actionRows(data, r, reportDate, plan = "not_sure") {
  const q = Object.fromEntries(data.questions.map((x) => [x.id, x]));
  const A = data.actions || {}, M = data.answer_actions || {};
  const day = (n) => new Date(new Date(reportDate).getTime() + n * 86400000).toISOString().slice(0, 10);
  const srcQ = (aid) => { for (const [qid, opts] of Object.entries(M)) for (const m of Object.values(opts)) if (m.primary === aid || m.secondary === aid) return qid; return null; };
  const rows = [];
  const add = (aid, phase, answer, qid) => {
    if (!aid || !A[aid]) return;
    const ex = rows.find((x) => x.id === aid);
    if (ex) { if (phase < ex.p) { ex.p = phase; ex.answer = answer; } return; }
    rows.push({ id: aid, p: phase, answer, qid: qid || srcQ(aid) });
  };
  for (const x of r.topRisks) { const m = (M[x.id] || {})[x.answer]; if (m) add(m.primary, m.phase, x.answer, x.id); }
  for (const x of r.topRisks) { const m = (M[x.id] || {})[x.answer]; if (m && m.secondary && rows.length < 7) add(m.secondary, m.phase, x.answer, x.id); }
  for (const h of data.action_habits || []) if (rows.length < 5) add(h, 3, null, null);
  if (rows.length && !rows.some((x) => x.p === 1)) rows[0].p = 1;
  const ordered = rows.slice(0, 7).map((x, i) => ({ ...x, i })).sort((a, b) => a.p - b.p || a.i - b.i);
  return ordered.map((x) => {
    const qq = q[x.qid] || {};
    const notes = (qq.plan_notes || []).filter((n) => plan === "not_sure" || n.plans.includes("all") || n.plans.includes(plan));
    const src = (qq.fixes || []).find((f) => f.source);
    return {
      id: x.id, action: A[x.id].title, plain: A[x.id].plain, domain: A[x.id].domain, phase: "Phase " + x.p,
      priority: x.p === 1 ? "High" : x.p === 2 ? (x.answer === "C" || x.answer === "D" ? "High" : "Medium") : "Low",
      owner: "", impact: x.answer && x.qid ? ((data.risk_impacts || {})[x.qid] || {})[x.answer] || "" : "",
      start: x.p === 1 ? day(0) : x.p === 2 ? day(7) : null, end: x.p === 1 ? day(4) : x.p === 2 ? day(11) : null,
      how: (qq.fixes || []).map((f) => f.text).join(" "), planNote: notes[0] ? notes[0].text : "", source: src ? src.source : null,
    };
  });
}
