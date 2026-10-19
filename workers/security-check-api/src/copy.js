// Approved copy that may change again (PM / L0_CEO). One place, so a later swap is a one-line edit.
// Rewrites are applied to the Notion template text (live template or repo snapshot) before tokens are filled,
// so the Notion pages, /r/ and /f/ all get the same wording. Once a template carries the new text, its rewrite is a no-op.
export const COPY = {
  // Item 6 (PM, L0_CEO 19 Oct 2026): Overall Level callout, line 3, and the gray note under the Domain Profile table.
  level_note: "Average score {{overall_score}}/100. Your level is set by your lowest area, so it can be lower than your average suggests.",
  // Item 7 (PM pick b, 19 Oct 2026): per question. A question is named only if it scored full points (A) and the
  // result has no fix or action for it; N/A never counts. At most 3 names, then "and N more".
  good_shape: { one: "{A} {verb} in good shape.", two: "{A} and {B} are both in good shape.", three: "{A}, {B}, and {C} are all in good shape.", more: "{A}, {B}, {C}, and {N} more are in good shape." },
  // Plain question labels (Q1 to Q12 order) with the verb used when a label stands alone.
  question_labels: {
    q1: { label: "Sign-in security", verb: "is" }, q2: { label: "Account setup", verb: "is" }, q3: { label: "Public pages", verb: "are" },
    q4: { label: "Sensitive data handling", verb: "is" }, q5: { label: "Connected apps", verb: "are" }, q6: { label: "AI tool access", verb: "is" },
    q7: { label: "Offboarding", verb: "is" }, q8: { label: "Access reviews", verb: "are" }, q9: { label: "Admin rights", verb: "are" },
    q10: { label: "Default access", verb: "is" }, q11: { label: "Recovery readiness", verb: "is" }, q12: { label: "Change history", verb: "is" },
  },
  // Item C (PM): the gaps sentence per page; left out with the biggest-difference sentence when there are no risks.
  gaps: { free: "{risks} leave gaps.", fixlist: "{risks} {exposure}." },
  // Item 11 (L0_CEO): annual billing line on the Fix List; "Cancel any time" only on the monthly line.
  annual_line: "Annual: $2,970/year, billed once a year.",
  monthly_cancel: "Cancel any time.",
};
export const REWRITES = [
  ["Score {{overall_score}} / 100. Your level comes from your weakest areas, not the average.", COPY.level_note],
  // Summary sentence: the good-shape sentence stands on its own (omitted when no area qualifies).
  ["): {{strength_summary}}, but {{top_risks_summary}} leave gaps. ", "). {{good_shape_sentence}}{{gaps_sentence}}"],
  ["): {{strength_summary}}, but {{top_risks_summary}} {{exposure_summary}}. ", "). {{good_shape_sentence}}{{gaps_sentence}}"],
  ["). {{good_shape_sentence}}{{top_risks_summary_cap}} leave gaps. ", "). {{good_shape_sentence}}{{gaps_sentence}}"],
  ["). {{good_shape_sentence}}{{top_risks_summary_cap}} {{exposure_summary}}. ", "). {{good_shape_sentence}}{{gaps_sentence}}"],
  ["Annual: $2,970. Cancel any time.", COPY.annual_line],
  ["$347/mo founding rate for the first 5 clients, then $490/mo. ", "$347/mo founding rate for the first 5 clients, then $490/mo. " + COPY.monthly_cancel + " "],
];
// Exported for tests. ids are question ids in Q1 to Q12 order.
export function goodShapeSentence(ids) {
  const L = ids.map((id) => COPY.question_labels[id]);
  if (!L.length) return "";
  const lab = L.map((x, i) => (i ? x.label.charAt(0).toLowerCase() + x.label.slice(1) : x.label));
  const G = COPY.good_shape;
  if (L.length === 1) return G.one.replace("{A}", lab[0]).replace("{verb}", L[0].verb);
  if (L.length === 2) return G.two.replace("{A}", lab[0]).replace("{B}", lab[1]);
  if (L.length === 3) return G.three.replace("{A}", lab[0]).replace("{B}", lab[1]).replace("{C}", lab[2]);
  return G.more.replace("{A}", lab[0]).replace("{B}", lab[1]).replace("{C}", lab[2]).replace("{N}", String(L.length - 3));
}
