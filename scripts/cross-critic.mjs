#!/usr/bin/env node
// Cross-model visual critic for chart rebranding. Sends the render (+ optional
// brand reference images) to an OpenAI vision model and prints localised critique
// JSON. Exit 0 = critique on stdout; exit 2 = no OPENAI_API_KEY (degraded
// mode - caller continues rubric-only); exit 1 = API/args error.
import fs from "node:fs";

const args = { reference: [] };
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const k = argv[i].replace(/^--/, "");
  if (k === "reference") args.reference.push(argv[++i]);
  else args[k] = argv[++i];
}

if (!args.render) { console.error("usage: cross-critic --render <png> [--reference <png>]... [--notes <file>] [--model <id>]"); process.exit(1); }
if (!process.env.OPENAI_API_KEY) {
  console.error("OPENAI_API_KEY not set - cross-model critique unavailable, continue rubric-only (degraded mode)");
  process.exit(2);
}

const model = args.model || process.env.CROSS_CRITIC_MODEL || "gpt-4o";
const notes = args.notes ? fs.readFileSync(args.notes, "utf8") : "";

const toDataUrl = (p) => `data:image/png;base64,${fs.readFileSync(p).toString("base64")}`;

const system = `You are an adversarial design critic. The FIRST image is a machine-rendered chart in a
specific brand's style; any further images are REAL, human-designed assets from that brand, for calibration.
Find what makes the render look machine-generated or off-brand. Every issue MUST be localised and actionable:
{ "dimension": "brand-fidelity" | "layout-hygiene" | "hierarchy" | "human-feel",
  "severity": "high" | "medium" | "low",
  "whatsWrong": "<specific defect>",
  "where": "<which element/region of the image>",
  "suggestedFix": "<which chart-spec field to change and how>" }
Vague verdicts without a "where" and a "suggestedFix" are useless and will be discarded.
Respond with JSON: { "issues": [ ... ] }. An empty issues array means you found nothing actionable.`;

const content = [
  { type: "text", text: `Brand notes:\n${notes || "(none provided)"}` },
  { type: "image_url", image_url: { url: toDataUrl(args.render) } },
  ...args.reference.map((p) => ({ type: "image_url", image_url: { url: toDataUrl(p) } })),
];

const res = await fetch("https://api.openai.com/v1/chat/completions", {
  method: "POST",
  headers: { "content-type": "application/json", authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
  body: JSON.stringify({
    model,
    response_format: { type: "json_object" },
    messages: [ { role: "system", content: system }, { role: "user", content } ],
  }),
});

if (!res.ok) { console.error(`OpenAI API error ${res.status}: ${await res.text()}`); process.exit(1); }
const data = await res.json();
try {
  const parsed = JSON.parse(data.choices[0].message.content);
  console.log(JSON.stringify({ issues: parsed.issues || [] }, null, 2));
} catch {
  console.error("critic returned non-JSON content"); process.exit(1);
}
