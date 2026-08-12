import { test } from "node:test";
import assert from "node:assert/strict";
import { adaptProfile } from "../brand-adapter.mjs";

const pluginProfile = {
  slug: "test-brand", name: "Test Brand",
  colors: { bg: "#FFFAF3", ink: "#232222", muted: "#6B6660", accent: "#FC6932",
            accentSoft: "#FFE7C6", accent2: "#3843EB", line: "#EAE2D5", white: "#FFFFFF" },
  fonts: {
    headlineFamily: "Test Display", bodyFamily: "Test Sans",
    files: [
      { family: "Test Display", file: "TestDisplay-Bold.otf", weight: 700 },
      { family: "Test Sans", file: "TestSans-Regular.woff2", weight: 400 },
    ],
  },
  chart: { series: ["accent2", "accent"], pie: { ramp: ["accent2", "accentSoft", "accent"] } },
};

test("maps colors -> palette", () => {
  const b = adaptProfile(pluginProfile, "/kits/sb");
  assert.equal(b.palette.accent2, "#3843EB");
  assert.equal(b.palette.bg, "#FFFAF3");
});

test("maps flat fonts -> role-nested families + files split by family", () => {
  const b = adaptProfile(pluginProfile, "/kits/sb");
  assert.equal(b.fonts.headline.family, "Test Display");
  assert.equal(b.fonts.body.family, "Test Sans");
  assert.deepEqual(b.fonts.headline.files, [{ file: "TestDisplay-Bold.otf", weight: 700, style: "normal" }]);
  assert.deepEqual(b.fonts.body.files, [{ file: "TestSans-Regular.woff2", weight: 400, style: "normal" }]);
});

test("passes chart through and sets _meta.dir", () => {
  const b = adaptProfile(pluginProfile, "/kits/sb");
  assert.deepEqual(b.chart.pie.ramp, ["accent2", "accentSoft", "accent"]);
  assert.equal(b._meta.dir, "/kits/sb");
  assert.equal(b._meta.slug, "test-brand");
});

test("passes logo through so charts/util.mjs readLogoIcon() can use brand.logo.icon", () => {
  const withLogo = { ...pluginProfile, logo: { icon: "icon.svg" } };
  const b = adaptProfile(withLogo, "/kits/sb");
  assert.equal(b.logo.icon, "icon.svg");
});
