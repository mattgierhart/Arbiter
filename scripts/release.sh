#!/bin/bash
#
# Local release helper for Arbiter (Obsidian plugin).
# Bumps version in manifest.json, package.json, versions.json, commits, and
# tags. Push the tag to trigger the release.yml workflow which builds and
# creates the GitHub Release that BRAT consumes.
#
# Usage:
#   bash scripts/release.sh <new-version>     # e.g., bash scripts/release.sh 0.3.0
#   bash scripts/release.sh --dry-run 0.3.0   # show what would change without touching files

set -euo pipefail

DRY_RUN=0
if [[ "${1:-}" == "--dry-run" ]]; then
    DRY_RUN=1
    shift
fi

NEW_VERSION="${1:-}"
if [[ -z "$NEW_VERSION" ]]; then
    echo "Usage: $0 [--dry-run] <new-version>" >&2
    exit 1
fi

if [[ ! "$NEW_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "Error: version must be MAJOR.MINOR.PATCH (got '$NEW_VERSION')" >&2
    exit 1
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

if ! git diff-index --quiet HEAD --; then
    echo "Error: working tree has uncommitted changes. Commit or stash first." >&2
    exit 1
fi

CURRENT=$(node -p "require('./manifest.json').version")
MIN_APP=$(node -p "require('./manifest.json').minAppVersion")

echo "Releasing $CURRENT -> $NEW_VERSION (minAppVersion: $MIN_APP)"

if [[ $DRY_RUN -eq 1 ]]; then
    echo "[dry-run] would update manifest.json version: $CURRENT -> $NEW_VERSION"
    echo "[dry-run] would update package.json version: $CURRENT -> $NEW_VERSION"
    echo "[dry-run] would add to versions.json: \"$NEW_VERSION\": \"$MIN_APP\""
    echo "[dry-run] would commit: 'release: $NEW_VERSION'"
    echo "[dry-run] would tag: $NEW_VERSION"
    exit 0
fi

node -e "
const fs = require('fs');
const m = JSON.parse(fs.readFileSync('./manifest.json', 'utf8'));
m.version = '$NEW_VERSION';
fs.writeFileSync('./manifest.json', JSON.stringify(m, null, '\t') + '\n');

const p = JSON.parse(fs.readFileSync('./package.json', 'utf8'));
p.version = '$NEW_VERSION';
fs.writeFileSync('./package.json', JSON.stringify(p, null, '\t') + '\n');

const v = JSON.parse(fs.readFileSync('./versions.json', 'utf8'));
v['$NEW_VERSION'] = m.minAppVersion;
fs.writeFileSync('./versions.json', JSON.stringify(v, null, '\t') + '\n');
"

git add manifest.json package.json versions.json
git commit -m "release: $NEW_VERSION"
git tag "$NEW_VERSION"

echo ""
echo "Tagged $NEW_VERSION locally. Push with:"
echo "    git push && git push origin $NEW_VERSION"
echo ""
echo "Once pushed, .github/workflows/release.yml will build and create the GitHub Release."
echo "BRAT in your vault will pick up the update on its next check (or via 'BRAT: Check for updates')."
