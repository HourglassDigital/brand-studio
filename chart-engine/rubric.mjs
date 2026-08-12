// Critique rubric (spec §8). This file is DATA - the rebrand-visual skill
// reads rubricPrompt() into its own vision-scoring pass. Version it: any
// change to bars or dimensions should bump RUBRIC_VERSION and be noted in git.
export const RUBRIC_VERSION = 1;

export const RUBRIC = [
  { id: "brand-fidelity", name: "Brand fidelity", hardGate: false, passBar: 4,
    catches: "Palette, fonts, card/connector style match the brand tokens and reference PNGs. No off-palette colours, no substituted fonts, accents used per the brand's rules." },
  { id: "data-integrity", name: "Data integrity", hardGate: true, passBar: 5,
    catches: "Every number and label from the SOURCE visual is present and correct in the render. HARD GATE: any miss is an automatic fail - stop and flag, never refine past a wrong number." },
  { id: "layout-hygiene", name: "Layout hygiene", hardGate: false, passBar: 4,
    catches: "No text overflow, collisions or clipping. Sane spacing and alignment; nothing cramped or floating." },
  { id: "hierarchy", name: "Hierarchy", hardGate: false, passBar: 4,
    catches: "Title -> takeaway -> detail reads in the right order; emphasis lands on the point the chart makes." },
  { id: "human-feel", name: "Human-made feel", hardGate: false, passBar: 4,
    catches: "Not templated or rigid: considered spacing, intentional emphasis, nothing that looks stamped out by a machine." },
];

export function rubricPrompt() {
  return [
    `Score the rendered chart against each dimension, 1-5. Pass bars below.`,
    ``,
    ...RUBRIC.map((d) =>
      `- **${d.name}** (pass >= ${d.passBar}${d.hardGate ? ", HARD GATE" : ""}): ${d.catches}`),
    ``,
    `Return per-dimension: score, pass/fail, and for each failure a localised issue:`,
    `{ dimension, severity, whatsWrong, where, suggestedFix (a chart-SPEC field change - the loop`,
    `may not edit brand tokens or components; propose those separately for human approval) }.`,
  ].join("\n");
}
