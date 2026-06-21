#!/usr/bin/env bash
#
# Deploy the calendar-write edge function + set its Google secrets from your
# existing agents/.env and agents/accounts.json. Gives the app instant Google
# Calendar sync on block add / reschedule / delete.
#
# Prereqs:  brew install supabase/tap/supabase  &&  supabase login
# Usage:    bash scripts/deploy-calendar-fn.sh
#
set -euo pipefail
cd "$(dirname "$0")/.."                 # repo root
REF="${SUPABASE_PROJECT_REF:-sozysnvupisjygmwdzej}"

command -v supabase >/dev/null || { echo "❌ Install the CLI: brew install supabase/tap/supabase && supabase login"; exit 1; }
[ -f agents/.env ]          || { echo "❌ agents/.env not found"; exit 1; }
[ -f agents/accounts.json ] || { echo "❌ agents/accounts.json not found"; exit 1; }

CID=$(grep '^GOOGLE_CLIENT_ID='     agents/.env | cut -d= -f2-)
CSECRET=$(grep '^GOOGLE_CLIENT_SECRET=' agents/.env | cut -d= -f2-)
GTOKEN=$(node -e "console.log(require('./agents/accounts.json')[0].refreshToken)")

echo "Setting function secrets on project $REF …"
supabase secrets set --project-ref "$REF" \
  GOOGLE_CLIENT_ID="$CID" \
  GOOGLE_CLIENT_SECRET="$CSECRET" \
  GOOGLE_CALENDAR_REFRESH_TOKEN="$GTOKEN" >/dev/null

echo "Deploying calendar-write …"
supabase functions deploy calendar-write --project-ref "$REF"
echo "✅ Done — instant Google Calendar sync is live."
