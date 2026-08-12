import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";

const CLI = path.resolve(import.meta.dirname, "..", "cli.mjs");
const env = { ...process.env, BRAND_STUDIO_DATA: path.resolve(import.meta.dirname) };

test("validate: good spec exits 0", () => {
  const out = execFileSync("node", [CLI, "validate", "--spec-json",
    JSON.stringify({ type: "pie", series: [{ values: [{ x: "A", y: 1 }] }] })], { env, encoding: "utf8" });
  assert.match(out, /spec OK/);
});

test("validate: bad spec exits non-zero", () => {
  assert.throws(() => execFileSync("node", [CLI, "validate", "--spec-json",
    JSON.stringify({ type: "sankey", series: [] })], { env, encoding: "utf8" }));
});

test("brands: lists the template kit", () => {
  const out = execFileSync("node", [CLI, "brands"], { env, encoding: "utf8" });
  assert.match(out, /_template/);
});
