// The doctor's kit check. "No kits" is nearly always "looked in the wrong root",
// so the search path has to be in the message either way.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function kitRoot(slug) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sb-doctor-"));
  if (slug) {
    const dir = path.join(root, "brands", slug);
    fs.mkdirSync(path.join(dir, "assets"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, "brand.json"),
      JSON.stringify({
        slug, name: "Doctor Kit",
        colors: { bg: "#FFFFFF" },
        fonts: { headlineFamily: "system-ui", bodyFamily: "system-ui", files: [] },
      }),
      "utf8",
    );
  }
  return root;
}

let n = 0;
const freshDoctor = () => import(`../doctor.mjs?doctor-test-${n++}`);
const kitCheck = (checks) => checks.find((c) => c.name === "kits");

test("reports the kits it found and the path it searched", async () => {
  const root = kitRoot("doctor-kit");
  process.env.BRAND_STUDIO_DATA = root;
  const { runDoctor } = await freshDoctor();

  const { checks } = await runDoctor({});
  const kits = kitCheck(checks);

  assert.ok(kits, "there should be a kits check");
  assert.equal(kits.status, "ok");
  assert.match(kits.message, /doctor-kit/);
  assert.match(kits.message, new RegExp(path.join(root, "brands").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("warns rather than fails when no kit resolves, and still prints the path", async () => {
  const root = kitRoot(null);
  process.env.BRAND_STUDIO_DATA = root;
  const { runDoctor } = await freshDoctor();

  const { checks } = await runDoctor({});
  const kits = kitCheck(checks);

  assert.equal(kits.status, "warn", "a missing kit degrades, it does not block");
  assert.match(kits.message, /Searched/);
  assert.match(kits.message, /BRAND_STUDIO_DATA/);
});
