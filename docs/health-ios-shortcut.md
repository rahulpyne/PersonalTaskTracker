# Apple Health → Dashboard: iOS Shortcut

This Shortcut reads today's Apple Health metrics — including body weight — and
pushes them to your Supabase `fitness_daily_metrics` table via the `health-sync`
Edge Function.

Run it **once a day** (morning automation recommended) or trigger it manually.

---

## Prerequisites

The `health-sync` Edge Function must be deployed and have `HEALTH_WEBHOOK_SECRET` set.

```bash
cd /path/to/PersonalTaskTracker
npx supabase functions deploy health-sync --no-verify-jwt
# Then in Supabase Dashboard → Edge Functions → health-sync → Secrets:
#   HEALTH_WEBHOOK_SECRET = <your secret>
```

Endpoint: `https://sozysnvupisjygmwdzej.supabase.co/functions/v1/health-sync`

---

## Shortcut steps (build in the Shortcuts app)

### 1 — Today's date

| Action | Setting |
|---|---|
| **Format Date** | Date: `Current Date` · Format: `Custom` · Format string: `yyyy-MM-dd` |
| Save result as | `today` |

---

### 2 — Steps

| Action | Setting |
|---|---|
| **Find Health Samples** | Type: `Steps` · Sort: `Start Date Latest First` · Limit: `1` |
| **Get Details of Health Sample** | Detail: `Value` |
| Save result as | `steps` |

---

### 3 — Active calories

| Action | Setting |
|---|---|
| **Find Health Samples** | Type: `Active Energy Burned` · Sort: Latest First · Limit: `1` |
| **Get Details of Health Sample** | Detail: `Value` |
| Save result as | `activeCals` |

---

### 4 — Resting heart rate

| Action | Setting |
|---|---|
| **Find Health Samples** | Type: `Resting Heart Rate` · Sort: Latest First · Limit: `1` |
| **Get Details of Health Sample** | Detail: `Value` |
| Save result as | `restingHR` |

---

### 5 — HRV

| Action | Setting |
|---|---|
| **Find Health Samples** | Type: `Heart Rate Variability` · Sort: Latest First · Limit: `1` |
| **Get Details of Health Sample** | Detail: `Value` |
| Save result as | `hrv` |

---

### 6 — Body weight ⬅ new

| Action | Setting |
|---|---|
| **Find Health Samples** | Type: `Body Mass` · Sort: `Start Date Latest First` · Limit: `1` |
| **Get Details of Health Sample** | Detail: `Value` |
| Save result as | `weightLbs` |

> **Unit note:** Apple Health shows weight in **lbs** on US devices. The Shortcut
> sends `weight_lbs` and the Edge Function converts to kg before storing.
> If your Health app is set to kg, rename the variable `weightKg` and change the
> JSON key below to `"weight_kg"` instead.

---

### 7 — VO₂ Max (optional)

| Action | Setting |
|---|---|
| **Find Health Samples** | Type: `VO₂ Max` · Sort: Latest First · Limit: `1` |
| **Get Details of Health Sample** | Detail: `Value` |
| Save result as | `vo2max` |

---

### 8 — Sleep (optional)

| Action | Setting |
|---|---|
| **Find Health Samples** | Type: `Sleep Analysis` · Filter: `Value is Asleep In Bed` · Sort: Latest First · Limit: `20` |
| **Calculate Statistics** | Input: result · Statistic: `Sum` of `Value` |
| Save result as | `sleepHrs` |

---

### 9 — Send to Supabase

| Action | Setting |
|---|---|
| **Get Contents of URL** | URL: `https://sozysnvupisjygmwdzej.supabase.co/functions/v1/health-sync` |
| Method | `POST` |
| Headers | `Content-Type: application/json` |
| | `X-Webhook-Secret: <your HEALTH_WEBHOOK_SECRET>` |
| Request body | `JSON` (see payload below) |

**JSON body** — tap each field to insert the matching variable:

```json
{
  "date":        "[today]",
  "steps":       [steps],
  "active_cals": [activeCals],
  "resting_hr":  [restingHR],
  "hrv":         [hrv],
  "weight_lbs":  [weightLbs],
  "vo2_max":     [vo2max],
  "sleep_hrs":   [sleepHrs]
}
```

---

### 10 — Confirm (optional)

| Action | Setting |
|---|---|
| **Show Notification** | Title: `Health synced ✅` · Body: `[today] · [weightLbs] lbs` |

---

## Automation — run every morning

**Shortcuts → Automation → New Automation:**

| Setting | Value |
|---|---|
| Trigger | `Time of Day` |
| Time | `07:30 AM` (after your first weigh-in) |
| Repeat | `Daily` |
| Run | this shortcut |
| Ask before running | **OFF** |

Weight is most accurate first thing in the morning before eating, so 7:30 AM
gives you yesterday's sleep data plus today's weigh-in in one shot.

---

## Test with curl

```bash
curl -X POST https://sozysnvupisjygmwdzej.supabase.co/functions/v1/health-sync \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Secret: YOUR_SECRET" \
  -d '{
    "date":        "2026-05-21",
    "steps":       11240,
    "active_cals": 520,
    "resting_hr":  54,
    "hrv":         61,
    "weight_lbs":  183.4,
    "vo2_max":     52.1,
    "sleep_hrs":   7.3
  }'
# Expected: {"ok":true,"saved":1,"total":1}
```

Check it landed:
```bash
# In Supabase Dashboard → Table Editor → fitness_daily_metrics
# Look for today's row — weight_kg should be 83.2 (183.4 / 2.205)
```

---

## If you already have the Shortcut (adding weight to existing)

If you already have a health shortcut and just want to add the weight step:

1. Open the Shortcut in edit mode
2. **Before the "Get Contents of URL" step**, insert:
   - `Find Health Samples` → `Body Mass` → Latest First → Limit 1
   - `Get Details of Health Sample` → `Value` → save as `weightLbs`
3. In the JSON body of `Get Contents of URL`, add:
   ```
   "weight_lbs": [weightLbs]
   ```
4. Done — the Edge Function already handles the conversion.

---

## How the dashboard uses it

```
fitness_daily_metrics.weight_kg
  ↓ (most recent non-null row)
FitnessDashboard → bodyweightLbs = Math.round(weight_kg × 2.205)
  ↓
StrengthComparison — pre-fills bodyweight field (still editable)
StrengthInsightCard — uses correct BW for ExRx percentile calculation
```
