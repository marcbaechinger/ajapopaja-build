#!/bin/bash
# Unit test for scripts/setup-hostnames.sh.
#
# Exercises the script against a temporary file (via $HOSTS_FILE) so the real
# /etc/hosts is never touched. Covers:
#   1. install -> both hostnames present
#   2. re-run  -> no duplicated entries (regression)
#   3. --remove -> managed block gone
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="$ROOT/scripts/setup-hostnames.sh"

TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "ok: $*"; }

# 1. Install into an empty file.
: > "$TMP"
HOSTS_FILE="$TMP" bash "$SCRIPT"
grep -qE '^127\.0\.0\.1[[:space:]]+ajapopaja$' "$TMP"            || fail "produced 'ajapopaja' entry missing"
grep -qE '^127\.0\.0\.1[[:space:]]+ajapopaja\.stage$' "$TMP"     || fail "produced 'ajapopaja.stage' entry missing"
pass "install creates both entries"

# 2. Re-run over a pre-existing entry (simulates a manual hosts line plus an
#    older managed block): exactly one of each hostname line must remain.
HOSTS_FILE="$TMP" bash "$SCRIPT"
HOSTS_FILE="$TMP" bash "$SCRIPT"
PROD_COUNT="$(grep -cE '^127\.0\.0\.1[[:space:]]+ajapopaja$' "$TMP")"
STAGE_COUNT="$(grep -cE '^127\.0\.0\.1[[:space:]]+ajapopaja\.stage$' "$TMP")"
[ "$PROD_COUNT" -eq 1 ]  || fail "expected 1 'ajapopaja' entry, got $PROD_COUNT"
[ "$STAGE_COUNT" -eq 1 ] || fail "expected 1 'ajapopaja.stage' entry, got $STAGE_COUNT"
pass "re-running does not duplicate entries"

# 3. Remove: managed block disappears, unrelated entries are preserved.
{
  cat "$TMP"
  echo "9.9.9.9 untouched.example"
} > "$TMP.new" && mv "$TMP.new" "$TMP"
HOSTS_FILE="$TMP" bash "$SCRIPT" --remove
! grep -qE '^127\.0\.0\.1[[:space:]]+ajapopaja(\.stage)?$' "$TMP" || fail "'--remove' left entries behind"
grep -qE '^9\.9\.9\.9[[:space:]]+untouched\.example$' "$TMP"     || fail "'--remove' removed unrelated entries"
pass "--remove deletes only the managed block"

echo "All setup-hostnames tests passed."
