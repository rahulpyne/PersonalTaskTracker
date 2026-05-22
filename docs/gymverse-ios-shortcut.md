# GymVerse → Dashboard: iOS Shortcut Setup

GymVerse has no public API. It **does** write workout sessions to Apple HealthKit
(type: Traditional Strength Training) after every session. This Shortcut reads
those sessions and syncs them to your Supabase `gymverse_workouts` table.

---

## What syncs

| Field | Source | Notes |
|---|---|---|
| Workout UUID | HealthKit | Used for deduplication — safe to run repeatedly |
| Start / end time | HealthKit | Exact timestamps |
| Duration | HealthKit | In seconds |
| Active calories burned | HealthKit | GymVerse writes this |
| Workout name | **Manual** | You set this in the Shortcut prompt |
| Total volume (kg) | **Manual** | Optional — enter or skip |
| Individual exercises | **Not available** | GymVerse doesn't write sets/reps to HealthKit |

---

## Step 1 — Deploy the Edge Function

```bash
cd /path/to/PersonalTaskTracker

# Install Supabase CLI if needed
npm i -g supabase

# Log in
npx supabase login

# Link to your project
npx supabase link --project-ref sozysnvupisjygmwdzej

# Run the migration
npx supabase db push --file supabase/migration_gymverse.sql

# Deploy the edge function
npx supabase functions deploy gymverse-sync --no-verify-jwt
```

Then in **Supabase Dashboard → Edge Functions → gymverse-sync → Secrets**, add:
```
GYMVERSE_WEBHOOK_SECRET = <pick a strong random string, e.g. openssl rand -hex 32>
```

Your endpoint will be:
```
https://sozysnvupisjygmwdzej.supabase.co/functions/v1/gymverse-sync
```

---

## Step 2 — Create the iOS Shortcut

Open the **Shortcuts** app on your iPhone and create a new shortcut with these steps:

### Actions (in order)

**1. Find Health Samples**
- Sample type: `Workouts`
- Filter: `Workout Type` `is` `Traditional Strength Training`
- Sort: `Start Date` — `Latest First`
- Limit: `1`

**2. Get Details of Health Sample**  
From the result of step 1, get:
- `UUID` → save as variable **workoutUUID**
- `Start Date` → save as variable **startDate**
- `End Date` → save as variable **endDate**
- `Duration` → save as variable **durationSecs** *(in seconds — set unit to Seconds)*
- `Active Energy Burned` → save as variable **activeCals** *(in kcal)*

**3. Ask for Input** *(optional but recommended)*  
- Prompt: `Workout name? (e.g. Push A, Lower B, Pull A)`
- Default: `Strength`
- Save as variable **workoutName**

**4. Ask for Input** *(optional)*  
- Prompt: `Total volume (kg)? Enter 0 to skip`
- Input type: `Number`
- Default: `0`
- Save as variable **volumeKg**

**5. Get Contents of URL**
- URL: `https://sozysnvupisjygmwdzej.supabase.co/functions/v1/gymverse-sync`
- Method: `POST`
- Headers:
  - `Content-Type`: `application/json`
  - `X-Webhook-Secret`: `<your GYMVERSE_WEBHOOK_SECRET>`
- Request body: `JSON`
  ```json
  {
    "external_id":        "[workoutUUID]",
    "workout_name":       "[workoutName]",
    "started_at":         "[startDate]",
    "ended_at":           "[endDate]",
    "duration_secs":      [durationSecs],
    "active_energy_kcal": [activeCals],
    "total_volume_kg":    [volumeKg],
    "device":             "iPhone"
  }
  ```

**6. Show Notification**
- Title: `GymVerse synced ✅`
- Body: `[workoutName] → dashboard`

---

## Step 3 — Add Automation Trigger

In **Shortcuts → Automation → New Automation**:
- Trigger: `App` → `GymVerse` → `Is Closed`
- Run shortcut: the one you just built
- Ask before running: **OFF**

This fires automatically whenever you close GymVerse after a workout.

---

## Step 4 — Test it

1. Open GymVerse, do (or finish) a workout, close the app
2. Check the Shortcuts notification — should show "GymVerse synced ✅"
3. Verify in **Supabase Dashboard → Table Editor → gymverse_workouts**

Or test manually with curl:
```bash
curl -X POST https://sozysnvupisjygmwdzej.supabase.co/functions/v1/gymverse-sync \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Secret: YOUR_SECRET" \
  -d '{
    "external_id":        "test-manual-001",
    "workout_name":       "Push A",
    "started_at":         "2026-05-21T18:30:00",
    "ended_at":           "2026-05-21T19:22:00",
    "duration_secs":      3120,
    "active_energy_kcal": 318,
    "total_volume_kg":    3240,
    "device":             "iPhone"
  }'
# Expected: {"ok":true,"saved":1,"skipped":0,"total":1}
```

---

## Backfill historical workouts

To load all past GymVerse workouts from HealthKit at once, change step 1 to:
- Limit: **remove limit** (or set to 200)
- Filter: `Start Date` `is after` `2025-01-01`

Then wrap step 5 in a **Repeat with Each** loop, building one payload per workout.

---

## Adding exercise detail

GymVerse doesn't write individual exercises to HealthKit. Two options:

**Option A — In-Shortcut prompt** (quick)  
Add an "Ask for Input" step after the calories step:
- Prompt: `Exercises? (e.g. Bench 90x5, Squat 120x5)`
- Parse with a Text action and pass as a string in `exercises_note`

**Option B — Supabase dashboard entry** (structured)  
After the shortcut syncs the session, open the dashboard → GymVerse section → click the workout row → tap "Add exercises" (future feature).

---

## Local development alternative

If you prefer not to use the hosted Edge Function, run the local webhook instead:

```bash
# In agents/.env, add:
# GYMVERSE_WEBHOOK_PORT=3002
# GYMVERSE_WEBHOOK_SECRET=<same secret>

node agents/fitness/gymverse-webhook.js
# Listening on :3002 — POST /gymverse-sync

# Expose to iPhone (same Wi-Fi):
# Use your Mac's local IP: http://192.168.x.x:3002/gymverse-sync
# Or expose publicly:
npx cloudflared tunnel --url http://localhost:3002
```
