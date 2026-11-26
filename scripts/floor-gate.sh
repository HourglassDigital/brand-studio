#!/usr/bin/env bash
# Floor gate for one package: runs its real test suite (render tests included) and
# fails unless every test ran and passed.
#
#   bash scripts/floor-gate.sh <engine|chart-engine> <minimum test count>
#
# Fails when: a test fails; any test is skipped (the render tests skip when no
# Chromium is found, so a runner without a browser cannot pass the floor quietly);
# or fewer tests ran than the minimum (a deleted or unloaded test file).
# EVALS_FLOOR_CANARY=<package> makes that package's test/floor-canary.test.mjs fail:
# the gate's must_fail uses it to prove a failing test turns this gate red.
set -euo pipefail
pkg=${1:?usage: floor-gate.sh <package> <minimum test count>}
min=${2:?usage: floor-gate.sh <package> <minimum test count>}
root=$(cd "$(dirname "$0")/.." && pwd)
cd "$root/$pkg"
[ -d node_modules ] || npm ci --no-audit --no-fund
log=$(mktemp)
status=0
npm test >"$log" 2>&1 || status=$?
tail -n 12 "$log"
count() { sed -n "s/^# $1 \([0-9]*\)$/\1/p" "$log" | tail -n 1; }
tests=$(count tests); fail=$(count fail); skipped=$(count skipped)
if [ "$status" -ne 0 ] || [ -z "$tests" ]; then
  grep -E "^not ok|✖|Error" "$log" | head -n 20 || true
  echo "floor gate $pkg: npm test failed (exit $status)"; exit 1
fi
[ "${fail:-1}" = 0 ] || { echo "floor gate $pkg: $fail failing tests"; exit 1; }
[ "${skipped:-1}" = 0 ] || { echo "floor gate $pkg: $skipped skipped tests (no Chromium?); the floor needs every render test to run"; exit 1; }
[ "$tests" -ge "$min" ] || { echo "floor gate $pkg: only $tests tests ran, the floor is $min"; exit 1; }
echo "floor gate $pkg: $tests tests passed, none skipped"
