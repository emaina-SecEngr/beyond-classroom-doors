#!/usr/bin/env bash
# scripts/design-gate.sh
#
# Anti-AI design gate, adapted from https://docs.deep.space/design/anti-ai-gate
# Scoped to the landing page files, as the docs specify.
#
#   HARD checks     -> any hit exits 1 (a design bug to fix before shipping)
#   ADVISORY checks -> printed for review, never fail the run
#
# Addition beyond the docs: setTimeout loops are flagged as advisory too,
# because MotionConfig reducedMotion="user" does not cover timer-driven
# animation (e.g. the split-flap hero board needs its own useReducedMotion gate).
#
# Usage: bash scripts/design-gate.sh   (run from the app root)

set -uo pipefail

# grep -P needs a UTF-8 locale to match emoji code points; without one it
# errors out (which the docs' version silently discards). Force UTF-8.
if locale -a 2>/dev/null | grep -qiE '^c\.utf-?8$'; then
  export LC_ALL=C.UTF-8
elif locale -a 2>/dev/null | grep -qiE '^en_US\.utf-?8$'; then
  export LC_ALL=en_US.UTF-8
fi

targets=()
for p in "src/pages/index.tsx" "src/pages/volunteer.tsx" "src/components/PublicChrome.tsx" "src/pages/(app)/landing.tsx" "src/components/landing"; do
  [ -e "$p" ] && targets+=("$p")
done

if [ ${#targets[@]} -eq 0 ]; then
  echo "design-gate: no landing files found; nothing to check."
  exit 0
fi

hard_hits=0
advisory_hits=0

report() { # severity name output
  local severity="$1" name="$2" out="$3"
  local count
  count=$(printf '%s\n' "$out" | wc -l | tr -d ' ')
  echo ""
  echo "[$severity] $name ($count)"
  printf '%s\n' "$out" | sed 's/^/    /'
  if [ "${GITHUB_ACTIONS:-}" = "true" ]; then
    local level="error"
    [ "$severity" = "ADVISORY" ] && level="notice"
    echo "::${level} title=Design gate::${name} (${count} hit(s))"
  fi
  if [ "$severity" = "HARD" ]; then
    hard_hits=$((hard_hits + count))
  else
    advisory_hits=$((advisory_hits + count))
  fi
}

check() { # severity name pattern grep-flags
  local severity="$1" name="$2" pattern="$3" flags="$4"
  local out status
  out=$(grep "$flags" --include="*.tsx" -e "$pattern" "${targets[@]}" 2>&1)
  status=$?
  # grep exits 0 = matches, 1 = no matches, 2 = error. An error must never
  # pass silently: a check that cannot run is reported as a failure.
  if [ "$status" -eq 2 ]; then
    report HARD "Check could not run: ${name}" "$out"
  elif [ "$status" -eq 0 ]; then
    report "$severity" "$name" "$out"
  fi
}

echo "design-gate: checking ${targets[*]}"

# ── Rule 5: hardcoded colors ─────────────────────────────────────────────────
check HARD "Hardcoded hex color (6-digit)" '#[0-9a-fA-F]{6}\b' -rnE
check HARD "Hardcoded hex color (3-digit)" '#[0-9a-fA-F]{3}\b' -rnE
check HARD "Hardcoded rgb()/rgba()" 'rgba?\([0-9]' -rnE
check HARD "Raw Tailwind palette color" \
  '\b(violet|indigo|purple|fuchsia|rose|amber|emerald|teal|cyan|sky|blue|green|red|orange|yellow|lime|pink)-[0-9]{3}' -rnE

# ── Rule 6: fractional-opacity foreground ────────────────────────────────────
check HARD "Fractional-opacity foreground" '(bg|text|border)-foreground/(\[|[0-9])' -rnE

# ── Rule 14: pictograph emoji (U+1F000-1FFFF) ────────────────────────────────
if printf 'x' | grep -qP 'x' 2>/dev/null; then
  check HARD "Pictograph emoji" '[\x{1F000}-\x{1FFFF}]' -rnP
elif command -v rg >/dev/null 2>&1; then
  out=$(rg -n --glob '*.tsx' '[\x{1F000}-\x{1FFFF}]' "${targets[@]}" 2>/dev/null || true)
  [ -n "$out" ] && report HARD "Pictograph emoji" "$out"
else
  echo ""
  echo "[SKIPPED] Pictograph emoji check needs grep -P or ripgrep; check by eye."
fi

# ── Template placeholder copy and generic marketing phrases ─────────────────
check HARD "Template placeholder copy" \
  'My App|Welcome to [Mm]y|[Ll]orem [Ii]psum|Your DeepSpace app is running' -rniE
check HARD "Generic marketing phrase" \
  'streamline your|transform your|cutting.edge|state.of.the.art|next.generation|revolutionary|world.class|best.in.class|game.chang' -rniE

# ── Unfilled TODOs ───────────────────────────────────────────────────────────
check HARD "Unfilled TODO" 'TODO[: ]' -rnE

# ── Illegal import from read-only example compositions (scans all of src/) ──
if [ -d src ]; then
  out=$(grep -rn --include="*.tsx" -e 'from.*landing-design/examples' src 2>&1)
  status=$?
  if [ "$status" -eq 2 ]; then
    report HARD "Check could not run: example-composition import" "$out"
  elif [ "$status" -eq 0 ]; then
    report HARD "Import from read-only example composition" "$out"
  fi
fi

# ── Advisory: continuous / timer-driven animation needs a useReducedMotion gate
check ADVISORY "Continuous animation - confirm a useReducedMotion gate" \
  'repeat:\s*Infinity|setInterval\(|requestAnimationFrame\(' -rnE
check ADVISORY "Timer-driven animation - confirm a useReducedMotion gate" \
  'setTimeout\(' -rnE

echo ""
echo "design-gate: ${hard_hits} hard hit(s), ${advisory_hits} advisory hit(s)."
if [ "$hard_hits" -gt 0 ]; then
  echo "design-gate: FAIL - fix the hard hits above (see docs.deep.space/design/anti-ai-gate)."
  exit 1
fi
echo "design-gate: PASS"
exit 0
