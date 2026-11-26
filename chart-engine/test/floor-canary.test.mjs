import { test } from "node:test";
import assert from "node:assert/strict";

// The floor gate's must_fail sets EVALS_FLOOR_CANARY=chart-engine to prove a failing test in
// this package turns its floor gate red (scripts/floor-gate.sh). Unset, it passes.
test("floor canary: fails only when EVALS_FLOOR_CANARY names this package", () => {
  assert.notEqual(process.env.EVALS_FLOOR_CANARY, "chart-engine", "floor canary planted for chart-engine");
});
