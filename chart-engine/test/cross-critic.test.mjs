import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";

const CRITIC = path.resolve(import.meta.dirname, "..", "..", "scripts", "cross-critic.mjs");

test("no OPENAI_API_KEY -> degraded (exit 2) with a clear message", () => {
  const env = { ...process.env };
  delete env.OPENAI_API_KEY;
  const r = spawnSync("node", [CRITIC, "--render", "x.png", "--reference", "y.png", "--notes", "n.txt"],
    { env, encoding: "utf8" });
  assert.equal(r.status, 2);
  assert.match((r.stdout || "") + (r.stderr || ""), /degraded|OPENAI_API_KEY/i);
});
