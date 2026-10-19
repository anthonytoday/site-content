// Approved copy that may change again (PM / L0_CEO). One place, so a later swap is a one-line edit.
// Rewrites are applied to the Notion template text (live template or repo snapshot) before tokens are filled,
// so the Notion pages, /r/ and /f/ all get the same wording. Once a template carries the new text, its rewrite is a no-op.
export const COPY = {
  // Item 6 (PM, L0_CEO 19 Oct 2026): Overall Level callout, line 3, and the gray note under the Domain Profile table.
  level_note: "Average score {{overall_score}}/100. Your level is set by your lowest area, so it can be lower than your average suggests.",
  // Item 7: one "in good shape" sentence. {list} uses the area labels below, in Domain Profile order.
  good_shape: { one: "{A} {verb} in good shape.", two: "{A} and {B} are both in good shape.", many: "{list} are all in good shape." },
  // Plain area labels with grammatical number (verb agreement for the 1-area sentence).
  area_labels: {
    identity: { label: "Sign-in and accounts", plural: true },
    sharing: { label: "Sharing", plural: false },
    integrations: { label: "Connected apps", plural: true },
    people: { label: "Offboarding", plural: false },
    governance: { label: "Admin rights", plural: true },
    resilience: { label: "Recovery", plural: false },
  },
  // Item 11 (L0_CEO): annual billing line on the Fix List; "Cancel any time" only on the monthly line.
  annual_line: "Annual: $2,970/year, billed once a year.",
  monthly_cancel: "Cancel any time.",
};
export const REWRITES = [
  ["Score {{overall_score}} / 100. Your level comes from your weakest areas, not the average.", COPY.level_note],
  // Summary sentence: the good-shape sentence stands on its own (omitted when no area qualifies).
  ["): {{strength_summary}}, but {{top_risks_summary}} ", "). {{good_shape_sentence}}{{top_risks_summary_cap}} "],
  ["Annual: $2,970. Cancel any time.", COPY.annual_line],
  ["$347/mo founding rate for the first 5 clients, then $490/mo. ", "$347/mo founding rate for the first 5 clients, then $490/mo. " + COPY.monthly_cancel + " "],
];
// Exported for tests.
export function goodShapeSentence(ids) {
  const L = ids.map((id) => COPY.area_labels[id]);
  if (!L.length) return "";
  const lab = L.map((x, i) => (i ? x.label.charAt(0).toLowerCase() + x.label.slice(1) : x.label));
  if (L.length === 1) return COPY.good_shape.one.replace("{A}", lab[0]).replace("{verb}", L[0].plural ? "are" : "is");
  if (L.length === 2) return COPY.good_shape.two.replace("{A}", lab[0]).replace("{B}", lab[1]);
  return COPY.good_shape.many.replace("{list}", lab.slice(0, -1).join(", ") + ", and " + lab[lab.length - 1]);
}
