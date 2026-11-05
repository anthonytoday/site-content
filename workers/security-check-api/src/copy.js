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
  // Item 11 (L0_CEO): the cancel line only on the monthly line. Annual removed 19 Oct 2026 (no live annual link).
  monthly_cancel: "Cancel any month, 30-day refund.",
  // Fractional Notion Admin price (Anthony, 26 Oct 2026, 8:28 am UAE): $990/month standard, launch offer $490/month x 3 months if started by 30 Nov 2026.
  fna_price: "$990/month. Launch offer: $490/month for your first 3 months if you start by 30 Nov 2026, then $990/month.",
};
export const REWRITES = [
  ["Score {{overall_score}} / 100. Your level comes from your weakest areas, not the average.", COPY.level_note],
  // Summary sentence: the good-shape sentence stands on its own (omitted when no area qualifies).
  ["): {{strength_summary}}, but {{top_risks_summary}} leave gaps. ", "). {{good_shape_sentence}}{{gaps_sentence}}"],
  ["): {{strength_summary}}, but {{top_risks_summary}} {{exposure_summary}}. ", "). {{good_shape_sentence}}{{gaps_sentence}}"],
  ["). {{good_shape_sentence}}{{top_risks_summary_cap}} leave gaps. ", "). {{good_shape_sentence}}{{gaps_sentence}}"],
  ["). {{good_shape_sentence}}{{top_risks_summary_cap}} {{exposure_summary}}. ", "). {{good_shape_sentence}}{{gaps_sentence}}"],
  // Older template wordings of the FNA price line -> the current price line (longest match first, so the cancel line is not doubled).
  ["$490/mo founding rate for the first 5 clients, then $990/mo. Cancel any time. ", COPY.fna_price + " " + COPY.monthly_cancel + " "],
  ["$347/mo founding rate for the first 5 clients, then $490/mo. ", COPY.fna_price + " " + COPY.monthly_cancel + " "],
  ["$490/mo founding rate for the first 5 clients, then $990/mo. ", COPY.fna_price + " " + COPY.monthly_cancel + " "],
];
// Link swaps (exact URL, or the same URL with a query string), applied to template links before tokens are filled.
// FNA (26 Oct 2026): the old $490/month Payment Link billed $490 forever; the launch offer checkout lives on anthonytoday.com.
export const LINK_REWRITES = [
  ["https://buy.stripe.com/5kQ5kF0rS5zTfY74Kt1ZS0B", "https://www.anthonytoday.com/checkout/fna-launch"],
];
export function rewriteUrl(u) {
  if (!u) return u;
  for (const [a, b] of LINK_REWRITES) if (u === a || u.startsWith(a + "?")) return b + u.slice(a.length);
  return u;
}
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
