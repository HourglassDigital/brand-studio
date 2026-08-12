// Typography roles (spec §5.1): weights clamp to what the kit ships, no
// renderer emits monospace, and legend layout measures its text.
// Deterministic - no chromium needed.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { typography, typographyClamps, estimateTextWidth, ROLES } from "../render/charts/typography.mjs";
import { layoutLegend } from "../render/charts/util.mjs";
import { renderBar } from "../render/charts/bar.mjs";
import { renderArea } from "../render/charts/area.mjs";
import { renderPie } from "../render/charts/pie.mjs";

// A kit that ships 400-700 in both slots, where the engine asks for 800 and
// 900 anyway.
const clampedKit = {
  slug: "clampy",
  palette: { bg: "#FFF", ink: "#111", muted: "#666", line: "#EEE", accent: "#FC6932", accentSoft: "#FFE7C6", accent2: "#3843EB", purple: "#B19EF8" },
  fonts: {
    headline: { family: "Test Display", files: [{ file: "a.otf", weight: 400 }, { file: "b.otf", weight: 700 }] },
    body: { family: "Test Sans", files: [{ file: "c.woff2", weight: 400 }, { file: "d.woff2", weight: 700 }] },
  },
  chart: { hues: ["accent", "accent2", "purple"] },
};

const fontless = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "kits", "derivation.brand.json"), "utf8"));

test("a role asking for an unshipped weight snaps to the nearest shipped file", () => {
  const t = typography(clampedKit);
  assert.equal(t.role("title").weight, 700); // asked 800
  assert.equal(t.role("watermark").weight, 700); // asked 900
  assert.equal(t.role("axis").weight, 400); // shipped as-is
});

test("clamping keeps the declared family - only the weight moves", () => {
  const t = typography(clampedKit);
  assert.equal(t.role("title").family, "Test Display");
  assert.equal(t.role("source").family, "Test Sans");
});

test("a fontless kit clamps nothing: there are no shipped weights to violate", () => {
  const t = typography(fontless);
  assert.equal(t.role("title").weight, ROLES.title.weight);
  assert.equal(typographyClamps(fontless).length, 0);
});

test("an equidistant request snaps DOWN, never up into fake bold", () => {
  const kit = structuredClone(clampedKit);
  kit.fonts.headline.files = [{ file: "a", weight: 300 }, { file: "b", weight: 500 }];
  const t = typography(kit);
  assert.equal(t.role("watermark", { weight: 400 }).weight, 300);
});

test("overridden weights clamp exactly like the role's own", () => {
  const kit = structuredClone(clampedKit);
  kit.fonts.body.files = [{ file: "c", weight: 400 }];
  const t = typography(kit);
  assert.equal(t.role("category", { weight: 700 }).weight, 400);
});

test("typographyClamps names every clamp the engine will actually request", () => {
  const clamps = typographyClamps(clampedKit);
  const byRole = Object.fromEntries(clamps.map((c) => [`${c.role}:${c.requested}`, c.used]));
  assert.equal(byRole["title:800"], 700);
  assert.equal(byRole["watermark:900"], 700);
});

test("an unknown role fails loudly and lists the roles that exist", () => {
  assert.throws(() => typography(clampedKit).role("caption"), /caption[\s\S]*title/);
});

// No renderer emits monospace, whatever the chart type (spec §5.1: all ten
// hardcoded occurrences left the renderers).

const barSpec = {
  type: "bar", title: "T", subtitle: "S", watermark: "W",
  series: [
    { name: "of revenue", values: [{ x: "A", y: 1 }, { x: "B", y: 2 }] },
    { name: "of operating income", values: [{ x: "A", y: 2 }, { x: "B", y: 1 }] },
    { name: "of membership income", values: [{ x: "A", y: 3 }, { x: "B", y: 2 }] },
  ],
};

test("no rendered chart contains font-family monospace", () => {
  const size = { width: 1600, height: 1100 };
  const bodies = [
    renderBar({ brand: fontless, spec: barSpec, size }).body,
    renderArea({ brand: fontless, spec: {
      type: "area", title: "T", series: [{ values: [{ x: 1, y: 1 }, { x: 2, y: 2 }] }],
      annotations: [{ x: 2, y: 2, text: "peak" }],
    }, size }).body,
    renderPie({ brand: fontless, spec: {
      type: "pie", title: "T", series: [{ values: [{ x: "A", y: 1 }, { x: "B", y: 2 }] }],
    }, size }).body,
  ];
  for (const body of bodies) assert.doesNotMatch(body, /monospace/);
});

test("no rendered chart asks for a weight the kit does not ship", () => {
  const size = { width: 1600, height: 1100 };
  const body = renderBar({ brand: clampedKit, spec: barSpec, size }).body;
  const weights = [...body.matchAll(/font-weight="(\d+)"/g)].map((m) => +m[1]);
  assert.ok(weights.length > 0, "expected explicit weights in the svg");
  for (const w of weights) assert.ok([400, 700].includes(w), `emitted weight ${w} is not shipped`);
});

// Legend layout measures its text (the 3-series overlap defect).

test("legend entries are spaced by their own text, so long names never overlap", () => {
  const names = ["of revenue", "of operating income", "of membership income"];
  const placed = layoutLegend(names, { size: 22, right: 1500, maxWidth: 1400 });
  for (let i = 1; i < placed.length; i++) {
    const prev = placed[i - 1];
    // Lower bound deliberately narrower than the layout's own estimate: the
    // check holds even if the advance ratio is tuned later.
    const minWidth = 18 + 8 + prev.name.length * 22 * 0.5;
    assert.ok(
      placed[i].x >= prev.x + minWidth,
      `entry "${placed[i].name}" at ${placed[i].x} overlaps "${prev.name}" at ${prev.x}`,
    );
  }
});

test("a legend wider than the plot wraps into rows instead of running off canvas", () => {
  const names = ["alpha series", "beta series", "gamma series", "delta series"];
  const placed = layoutLegend(names, { size: 22, right: 600, maxWidth: 500 });
  assert.ok(placed[placed.length - 1].row > 0, "expected more than one row");
  for (const e of placed) assert.ok(e.x >= 0, "no entry may start off-canvas");
});

test("each legend row ends flush at the right edge", () => {
  const names = ["one", "two", "three"];
  const right = 1000;
  const placed = layoutLegend(names, { size: 22, right, maxWidth: 900 });
  const last = placed[placed.length - 1];
  const width = 18 + 8 + estimateTextWidth(last.name, 22) + 40;
  assert.ok(Math.abs(last.x + width - right) < 0.001);
});

// Doctor reports clamps so the gap is visible rather than silent.

test("doctor warns with every clamp for a kit shipping fewer weights than the engine asks", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sbkit-typo-"));
  const dir = path.join(root, "brands", "clampy");
  fs.mkdirSync(path.join(dir, "assets"), { recursive: true });
  // The store speaks the brand-studio kit shape; the adapter turns it into the
  // role-nested shape typography() consumes.
  const kit = {
    slug: "clampy", name: "Clampy",
    colors: { bg: "#FFF", ink: "#111", muted: "#666", line: "#EEE", accent: "#FC6932", accentSoft: "#FFE7C6", accent2: "#3843EB", purple: "#B19EF8" },
    chart: { hues: ["accent", "accent2", "purple"] },
    fonts: {
      headlineFamily: "Test Display", bodyFamily: "Test Sans",
      files: [
        { family: "Test Display", file: "a.otf", weight: 400 },
        { family: "Test Display", file: "b.otf", weight: 700 },
        { family: "Test Sans", file: "c.woff2", weight: 400 },
        { family: "Test Sans", file: "d.woff2", weight: 700 },
      ],
    },
  };
  for (const f of kit.fonts.files) fs.writeFileSync(path.join(dir, "assets", f.file), "");
  fs.writeFileSync(path.join(dir, "brand.json"), JSON.stringify(kit));
  const prev = process.env.BRAND_STUDIO_DATA;
  process.env.BRAND_STUDIO_DATA = root;
  try {
    const { runDoctor } = await import("../doctor.mjs");
    const { checks } = await runDoctor({ brand: "clampy" });
    const typo = checks.find((c) => c.name === "typography");
    assert.ok(typo, "doctor should run the typography check when given a brand");
    assert.equal(typo.status, "warn");
    assert.match(typo.message, /title 800->700/);
    assert.match(typo.message, /watermark 900->700/);
  } finally {
    if (prev === undefined) delete process.env.BRAND_STUDIO_DATA;
    else process.env.BRAND_STUDIO_DATA = prev;
    fs.rmSync(root, { recursive: true, force: true });
  }
});
