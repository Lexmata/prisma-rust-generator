#!/usr/bin/env bash
# Run cargo check + clippy + fmt --check across all compile-test fixtures.
set -euo pipefail

shopt -s nullglob
ROOT=$(dirname "$(realpath "$0")")/..
FAILED=()

for dir in "$ROOT"/test/compile/*/; do
  echo "==> verifying ${dir%/}"
  (
    cd "$dir"
    cargo fmt --all -- --check
    cargo clippy --all-targets -- -D warnings
    cargo check --all-targets
  ) || FAILED+=("$dir")
done

if (( ${#FAILED[@]} > 0 )); then
  echo "FAILED fixtures:"; printf '  %s\n' "${FAILED[@]}"
  exit 1
fi
echo "All compile fixtures green."
