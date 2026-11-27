#!/usr/bin/env bash
# Self-proof gate for the CUPPEE agent and CI.
#   scripts/verify.sh            type checks + tests for server, stand-bridge and app
#   scripts/verify.sh --screens  also captures screenshots of the screens in scripts/screens.json
# Exits non-zero on the first failure. Prints a summary of what ran and what was skipped.
set -euo pipefail
trap 'echo; echo "== verify summary"; echo "  result:  FAIL (see the step above)"' ERR
cd "$(dirname "$0")/.."

SCREENS=0
[[ "${1:-}" == "--screens" ]] && SCREENS=1

ran=()
skipped=()

step() { echo; echo "== $*"; }

install_if_needed() {
  local dir="$1"
  if [[ ! -d "$dir/node_modules" ]]; then
    if [[ -f "$dir/package-lock.json" ]]; then (cd "$dir" && npm ci); else (cd "$dir" && npm install); fi
  fi
}

step "server: install"
install_if_needed server
step "server: typecheck"
(cd server && npm run typecheck); ran+=("server typecheck")
step "server: tests"
(cd server && npm test); ran+=("server tests")

step "stand-bridge: install (without building the native PC/SC module)"
if [[ ! -d stand-bridge/node_modules ]]; then
  if [[ -f stand-bridge/package-lock.json ]]; then (cd stand-bridge && npm ci --ignore-scripts); else (cd stand-bridge && npm install --ignore-scripts); fi
fi
step "stand-bridge: typecheck"
(cd stand-bridge && npm run typecheck); ran+=("stand-bridge typecheck")
step "stand-bridge: tests"
(cd stand-bridge && npm test); ran+=("stand-bridge tests")

step "app: install"
install_if_needed app
step "app: typecheck"
(cd app && npm run typecheck); ran+=("app typecheck")
if [[ "$(cd app && npm pkg get scripts.test)" != "{}" ]]; then
  step "app: tests"
  (cd app && npm test); ran+=("app tests")
else
  skipped+=("app tests (no test script yet)")
fi

if [[ $SCREENS -eq 1 ]]; then
  step "screenshots"
  python3 scripts/screenshots.py; ran+=("screenshots")
fi

echo
echo "== verify summary"
for r in "${ran[@]}"; do echo "  ran:     $r"; done
for s in "${skipped[@]:-}"; do [[ -n "$s" ]] && echo "  skipped: $s"; done
echo "  result:  PASS"
