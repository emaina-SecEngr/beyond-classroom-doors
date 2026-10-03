#!/usr/bin/env bash
# scripts/precommit.sh — run every local gate; stop at the first failure.
# Usage: bash scripts/precommit.sh && git commit -m "..."
set -euo pipefail
echo "1/4 type-check";       npx tsc --noEmit
echo "2/4 guardrail check";  bash scripts/guardrail-check.sh
echo "3/4 unit tests";       npx vitest run
echo "4/4 design gate (warn)"; bash scripts/design-gate.sh || echo "  design gate: warnings only"
echo "All gates passed."
