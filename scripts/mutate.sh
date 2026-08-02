#!/usr/bin/env bash
#
# mutate.sh — run one mutation against a Go file and report honestly.
#
# Mutation testing answers a question no coverage number does: if I break this
# rule, does a test notice? It is the only way to tell a guard that works from
# a guard that merely exists.
#
# This script exists because doing it by hand produced three WRONG answers in
# one session, each of which looked like a result:
#
#   1. A mutant that did not COMPILE was counted as caught. Every mutation in
#      that batch "passed" while proving nothing — the package was broken for
#      an unrelated reason and `go test` printed FAIL for all of them.
#   2. `timeout 240 go test ...` was used to bound a run. macOS has no
#      `timeout` binary, so the command produced "command not found", the
#      output contained no "FAIL", and the mutant was reported as SURVIVED.
#      A security guard was recorded as untested when it was in fact fine.
#   3. A run was killed by an outer timeout before its restore line, leaving a
#      removed authorization check sitting in a shared working tree with
#      another agent that could have committed it.
#
# So: restore is a trap, not a last line. Build failure is its own verdict.
# Timeouts come from `go test -timeout`. And the mutation is verified to have
# actually changed the file before any conclusion is drawn.
#
# Usage:
#   scripts/mutate.sh <file> <python-expr-file> <pkg> [pkg...]
#
# The python expression file is executed with `src` bound to the file's text
# and must produce `out`. Example:
#
#   out = src.replace('if !canManage {', 'if false {', 1)
#
set -uo pipefail

if [ $# -lt 3 ]; then
  sed -n '2,40p' "$0" | sed 's/^# \{0,1\}//'
  exit 2
fi

TARGET=$1; MUTATION=$2; shift 2
PKGS=("$@")
GOTEST_TIMEOUT=${GOTEST_TIMEOUT:-300s}

[ -f "$TARGET" ]   || { echo "mutate: no such file: $TARGET" >&2; exit 2; }
[ -f "$MUTATION" ] || { echo "mutate: no such mutation: $MUTATION" >&2; exit 2; }

SNAPSHOT=$(mktemp -t mutate.XXXXXX)
cp "$TARGET" "$SNAPSHOT"

# The whole point. Fires on success, failure, timeout, and interrupt alike.
restore() {
  cp "$SNAPSHOT" "$TARGET"
  rm -f "$SNAPSHOT"
}
trap restore EXIT INT TERM

# --- skipped tests catch nothing ---
#
# Most of the meaningful tests here are integration tests that SKIP when Mongo
# is unavailable. A skipped test cannot fail, so without REQUIRE_INFRA every
# mutant survives and the run reads as "none of this is covered" when the truth
# is "none of this ran". That is the most expensive way to be wrong, because it
# looks like a finding.
if [ "${REQUIRE_INFRA:-}" != "1" ]; then
  echo "INCONCLUSIVE  set REQUIRE_INFRA=1 — skipped tests cannot catch a mutant" >&2
  exit 3
fi

# --- baseline: the tests must build AND pass before a mutant means anything ---
if ! go vet "${PKGS[@]}" >/dev/null 2>&1; then
  echo "INCONCLUSIVE  baseline does not build — fix that first"
  exit 3
fi
if ! go test "${PKGS[@]}" -count=1 -timeout "$GOTEST_TIMEOUT" >/dev/null 2>&1; then
  echo "INCONCLUSIVE  baseline tests already fail — a mutant proves nothing"
  exit 3
fi

# --- apply ---
python3 - "$TARGET" "$MUTATION" <<'PY'
import sys, pathlib
target, mutation = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
src = target.read_text()
scope = {"src": src}
exec(mutation.read_text(), scope)
if "out" not in scope:
    raise SystemExit("mutation did not define `out`")
target.write_text(scope["out"])
PY

# --- did it actually change anything? A no-op edit silently "passes". ---
if diff -q "$SNAPSHOT" "$TARGET" >/dev/null; then
  echo "NOT-APPLIED   the mutation changed nothing — check the pattern"
  exit 4
fi

# --- a mutant that cannot compile is not a caught mutant ---
if ! go vet "${PKGS[@]}" >/dev/null 2>&1; then
  echo "INCONCLUSIVE  mutant does not compile — it tests nothing"
  exit 3
fi

if go test "${PKGS[@]}" -count=1 -timeout "$GOTEST_TIMEOUT" >/dev/null 2>&1; then
  echo "SURVIVED      no test noticed this change"
  exit 1
fi
echo "CAUGHT        a test failed, as it should"
exit 0
