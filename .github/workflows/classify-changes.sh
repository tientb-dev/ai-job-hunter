#!/usr/bin/env bash
# Prints code=<bool> and pdf=<bool> to $GITHUB_OUTPUT (stdout if unset).
# Fails open: anything uncertain runs every job.
# Input: EVENT, BASE, HEAD; or FILES (newline-separated) for local scenario tests.
set -u
out="${GITHUB_OUTPUT:-/dev/stdout}"
all() {
  echo "$1 Running everything."
  printf 'code=true\npdf=true\n' >> "$out"
  exit 0
}

if [ -z "${FILES+x}" ]; then
  [ "${EVENT:-}" = pull_request ] || all "Not a pull request."
  [ -n "${BASE:-}" ] && [ -n "${HEAD:-}" ] || all "Missing base/head SHA."
  FILES=$(git diff --name-only "$BASE...$HEAD") || all "Diff failed."
fi
[ -n "$FILES" ] || all "No changed files detected."

code=false
pdf=false
while IFS= read -r f; do
  case "$f" in
    docs/*.md | *.md | LICENSE) ;;
    *) code=true ;;
  esac
  case "$f" in
    apps/api/src/extraction/* | apps/api/test/unit/pdf-* | apps/api/package.json | \
      apps/api/jest.config.* | apps/api/tsconfig* | package.json | pnpm-lock.yaml | \
      pnpm-workspace.yaml | .npmrc | .github/workflows/*) pdf=true ;;
  esac
done <<< "$FILES"

printf '%s\n' "$FILES"
echo "code=$code pdf=$pdf"
printf 'code=%s\npdf=%s\n' "$code" "$pdf" >> "$out"
