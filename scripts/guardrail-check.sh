#!/usr/bin/env bash
# scripts/guardrail-check.sh
#
# Mechanical enforcement of GUARDRAILS.md (section numbers in brackets).
#   HARD     -> any hit exits 1 (security / locked decision violated)
#   ADVISORY -> printed for human review, never fails the run
#
# A check that cannot run is reported as a HARD failure: gates fail closed.
# Grep checks are a safety net, not proof. Reviews and tests still apply.
#
# Usage: bash scripts/guardrail-check.sh   (run from the app root)

set -uo pipefail

hard_hits=0
advisory_hits=0

existing() { # print only the paths that exist
  local p
  for p in "$@"; do [ -e "$p" ] && printf '%s\n' "$p"; done
}

# Browser-side code (everything the Vite client bundle may include)
mapfile -t CLIENT < <(existing src/pages src/components src/lib src/main.tsx src/nav.ts src/hooks)
# Worker-side code
mapfile -t SERVER < <(existing src/actions src/server src/cron.ts src/jobs.ts src/ai worker.ts)
# Shared schemas
mapfile -t SCHEMAS < <(existing src/schemas src/schemas.ts)
# Everything under src
mapfile -t ALLSRC < <(existing src worker.ts)

report() { # severity ref name output
  local severity="$1" ref="$2" name="$3" out="$4" count level
  count=$(printf '%s\n' "$out" | wc -l | tr -d ' ')
  echo ""
  echo "[$severity $ref] $name ($count)"
  printf '%s\n' "$out" | sed 's/^/    /'
  if [ "${GITHUB_ACTIONS:-}" = "true" ]; then
    level="error"; [ "$severity" = "ADVISORY" ] && level="notice"
    echo "::${level} title=Guardrail ${ref}::${name} (${count} hit(s)) - see GUARDRAILS.md"
  fi
  if [ "$severity" = "HARD" ]; then
    hard_hits=$((hard_hits + count))
  else
    advisory_hits=$((advisory_hits + count))
  fi
}

# check SEVERITY REF NAME PATTERN FLAGS PATH...
check() {
  local severity="$1" ref="$2" name="$3" pattern="$4" flags="$5"; shift 5
  [ "$#" -eq 0 ] && return 0
  local out status
  # Test files never ship in the bundle, so they are exempt (they may import deepspace/worker).
  out=$(grep "$flags" --include='*.ts' --include='*.tsx' --exclude='*.test.ts' --exclude='*.test.tsx' --exclude='*.spec.ts' -e "$pattern" "$@" 2>&1)
  status=$?
  if [ "$status" -eq 2 ]; then
    report HARD "$ref" "Check could not run: $name" "$out"
  elif [ "$status" -eq 0 ]; then
    report "$severity" "$ref" "$name" "$out"
  fi
}

if [ ${#ALLSRC[@]} -eq 0 ]; then
  echo "guardrail-check: no src/ found; run from the app root."
  exit 1
fi

echo "guardrail-check: scanning ${ALLSRC[*]}"

# ── §1.15 Worker runtime must not leak into the browser bundle ─────────────
check HARD "§1.15" "deepspace/worker imported from browser code" \
  "from ['\"]deepspace/worker" -rnE "${CLIENT[@]}"
check HARD "§1.15" "Shared schema imports deepspace/worker (use deepspace/schema)" \
  "from ['\"]deepspace/worker" -rnE "${SCHEMAS[@]}"

# ── §1.6 Email / LLM integrations only from server actions ──────────────────
check HARD "§1.6" "Email or LLM integration called from browser code" \
  "integration\.(post|get|put|delete)\(\s*['\"\`](resend|openai|anthropic|cerebras|gemini)/" -rnE "${CLIENT[@]}"

# ── §1.1 Identity only from the verified JWT ────────────────────────────────
check HARD "§1.1" "Actor identity read from request params (use ctx.userId)" \
  "params\.(userId|actorId|callerId|volunteerId)\b" -rnE "${SERVER[@]}"

# ── §1.8 Credentials never stored, logged, or returned ──────────────────────
check HARD "§1.8" "Token written to browser storage" \
  "(localStorage|sessionStorage)\.setItem\([^)]*(token|jwt)" -rniE "${CLIENT[@]}"
check HARD "§1.8" "Credential passed to console logging" \
  "console\.[a-z]+\([^)]*(callerJwt|APP_OWNER_JWT|getAuthToken\(\))" -rnE "${ALLSRC[@]}"
check HARD "§1.8" "callerJwt returned in a response" \
  "return[^;]*callerJwt" -rnE "${SERVER[@]}"

# ── §1.17 / §1.10 No hard deletes of sessions, claims, or audit entries ────
check HARD "§1.17" "Hard delete of sessions, claims, or audit log" \
  "(tools|ctx\.records)\.(remove|delete|deleteWhere)\(\s*['\"](session_requests|claims|audit_log)['\"]" -rnE "${SERVER[@]}"

# ── Route tiers: a (protected) folder outside (app)/ gates nothing ─────────
if [ -d src/pages ]; then
  out=$(find src/pages -type d -name '(protected)' ! -path 'src/pages/(app)/(protected)' 2>&1)
  [ -n "$out" ] && report HARD "§2 Routes" "(protected) folder outside (app)/ — it gates nothing" "$out"
fi

# ── §1.4 Users schema stays private ─────────────────────────────────────────
USERS_SCHEMA=src/schemas/users-schema.ts
if [ -f "$USERS_SCHEMA" ]; then
  check HARD "§1.4" "Users schema readable by all members" \
    "member:\s*\{\s*read:\s*true" -HnE "$USERS_SCHEMA"
  if ! grep -qE "roster:\s*['\"]read-policy['\"]" "$USERS_SCHEMA"; then
    report HARD "§1.4" "Users schema missing roster: 'read-policy' (decision P1)" "$USERS_SCHEMA"
  fi
fi

# ── §1.10 Audit log is append-only for every role ───────────────────────────
AUDIT_SCHEMA=src/schemas/audit-log-schema.ts
if [ -f "$AUDIT_SCHEMA" ]; then
  check HARD "§1.10" "Audit log allows update or delete" \
    "(update|delete):\s*(true|'own'|\"own\")" -HnE "$AUDIT_SCHEMA"
fi

# ── §1.6 Integration proxy stays closed to the browser ──────────────────────
# Regression guard for the Day 1 finding: the scaffold's catch-all
# /api/integrations/:name/:endpoint route forwarded any integration for any
# caller with the owner's JWT. It must keep the allowlist gate and require
# sign-in for every call it does allow.
HTTP_ROUTES=src/server/http-routes.ts
if [ -f "$HTTP_ROUTES" ] && grep -q "/api/integrations/:name/:endpoint" "$HTTP_ROUTES"; then
  if ! grep -qE "BROWSER_INTEGRATIONS\.has\(" "$HTTP_ROUTES"; then
    report HARD "§1.6" "Integration catch-all route has no browser allowlist gate" "$HTTP_ROUTES"
  fi
  check HARD "§1.6" "Integration route lets anonymous callers through for developer billing" \
    "if \(!auth && billingMode === 'user'\)" -HnE "$HTTP_ROUTES"
  out=$(grep -nE "new Set<string>\(\[[^]]*['\"][^]]*\]\)" "$HTTP_ROUTES" | grep BROWSER_INTEGRATIONS || true)
  [ -n "$out" ] && report ADVISORY "§1.6" "Browser integration allowlist is non-empty — confirm each entry is reviewed and rate-limited" "$out"
fi

# ── Advisory: patterns that usually mean a guardrail was missed ─────────────
check ADVISORY "§2 UI" "Browser dialog (use ConfirmModal / Modal / useToast)" \
  "window\.(confirm|alert|prompt)\(" -rnE "${CLIENT[@]}"

mapfile -t CLIENT_NO_UI < <(existing src/pages src/lib src/main.tsx src/hooks)
check ADVISORY "§2 UI" "Native <select> (use the kit's Select)" \
  "<select[ >]" -rnE "${CLIENT_NO_UI[@]}"
check ADVISORY "§2 UI" "UI kit imported from 'deepspace' (use src/components/ui)" \
  "import \{[^}]*\b(Button|Modal|ConfirmModal|EmptyState|Badge|Select|Tabs)\b[^}]*\} from ['\"]deepspace['\"]" -rnE "${CLIENT[@]}"
check ADVISORY "§2 Auth" "useUser() destructured wrongly (use const { user } = useUser())" \
  "\{\s*id\s*\}\s*=\s*useUser\(" -rnE "${CLIENT[@]}"
check ADVISORY "§1.16" "Client environment check — confirm it is not a security decision" \
  "(isProduction|isLocalDev)\(\)" -rnE "${CLIENT[@]}"
check ADVISORY "§1.6" "Integration called from browser — confirm it is not paid or sensitive" \
  "integration\.(post|get|put|delete)\(" -rnE "${CLIENT[@]}"

echo ""
echo "guardrail-check: ${hard_hits} hard hit(s), ${advisory_hits} advisory hit(s)."
if [ "$hard_hits" -gt 0 ]; then
  echo "guardrail-check: FAIL - fix the hard hits above (see GUARDRAILS.md)."
  exit 1
fi
echo "guardrail-check: PASS"
exit 0
