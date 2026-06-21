#!/usr/bin/env bash
#
# Push the agents' .env values + accounts.json into GitHub Actions secrets,
# so the hosted cron workflows can run. Reads secrets from local files at
# runtime — nothing sensitive is stored in this script.
#
# Prereqs:  brew install gh   &&   gh auth login
# Usage:    bash agents/scripts/push-gh-secrets.sh
#
set -euo pipefail

cd "$(dirname "$0")/.."          # → agents/
REPO="${GH_REPO:-rahulpyne/PersonalTaskTracker}"

command -v gh >/dev/null || { echo "❌ gh not installed — run: brew install gh && gh auth login"; exit 1; }
[ -f .env ]          || { echo "❌ agents/.env not found"; exit 1; }
[ -f accounts.json ] || { echo "❌ agents/accounts.json not found"; exit 1; }

echo "Pushing secrets to $REPO …"

# Each KEY=VALUE in .env → a repo secret (value may contain '=' / special chars)
while IFS= read -r line || [ -n "$line" ]; do
  [[ "$line" =~ ^[A-Za-z_][A-Za-z0-9_]*= ]] || continue   # skip blanks/comments
  key="${line%%=*}"
  val="${line#*=}"
  printf '%s' "$val" | gh secret set "$key" --repo "$REPO" >/dev/null
  echo "  ✓ $key"
done < .env

# Google refresh tokens live in accounts.json → one secret
gh secret set ACCOUNTS_JSON --repo "$REPO" < accounts.json >/dev/null
echo "  ✓ ACCOUNTS_JSON"

echo "Done. Trigger a run: gh workflow run 'Calendar + Task Scheduler' --repo $REPO"
