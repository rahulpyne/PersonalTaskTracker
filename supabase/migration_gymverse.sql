-- ══════════════════════════════════════════════════════════════════════════════
-- GymVerse Workouts — full per-set schema
-- Run in: Supabase Dashboard → SQL Editor  (supabase.com/dashboard/project/sozysnvupisjygmwdzej/sql)
-- ══════════════════════════════════════════════════════════════════════════════

-- ── 1. Main table ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS gymverse_workouts (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- identity & dedup
  external_id         text        UNIQUE,       -- "strava:18498955079" or "hk:UUID"
  workout_name        text,                     -- "Push A", "Back/Bicep", etc.
  workout_date        date,                     -- derived from started_at (for daily roll-ups)

  -- timing
  started_at          timestamptz NOT NULL,
  ended_at            timestamptz,
  duration_secs       int,                      -- total elapsed time (seconds)

  -- energy
  active_energy_kcal  numeric,

  -- volume (always in lbs — source of truth; kg stored for reference)
  total_volume_lbs    numeric,                  -- Σ weight_lbs × reps across all working sets
  total_volume_kg     numeric,                  -- same ÷ 2.205

  -- muscles worked (aggregated array for fast querying)
  -- e.g. {"chest","triceps","front_delts","core"}
  muscle_groups       text[],

  -- ── exercises JSONB schema ────────────────────────────────────────────────
  -- Array of exercise objects:
  -- {
  --   "name":          "Barbell Bench Press",
  --   "muscle_groups": { "primary": ["chest","triceps"], "secondary": ["front_delts"] },
  --   "sets": [
  --     {
  --       "set_num":       1,
  --       "weight_lbs":    215,
  --       "weight_kg":     97.5,
  --       "reps":          8,
  --       "is_warmup":     false,
  --       "is_dropset":    false,
  --       "superset_group": null,   -- e.g. "A" if paired, null otherwise
  --       "notes":         null     -- "RPE 8", "paused", etc.
  --     }
  --   ],
  --   "total_sets":         3,
  --   "top_set_weight_lbs": 225,
  --   "top_set_reps":       6,
  --   "volume_lbs":         3535,   -- this exercise only
  --   "volume_kg":          1603.4,
  --   "e1rm_lbs":           244,    -- Epley: weight × (1 + reps/30)
  --   "notes":              null
  -- }
  exercises           jsonb,

  source_app          text        DEFAULT 'strava_photos',
  raw                 jsonb,
  created_at          timestamptz DEFAULT now(),
  updated_at          timestamptz DEFAULT now()
);

-- ── 2. Indexes ────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_gv_started     ON gymverse_workouts(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_gv_date        ON gymverse_workouts(workout_date DESC);
CREATE INDEX IF NOT EXISTS idx_gv_ext_id      ON gymverse_workouts(external_id);
CREATE INDEX IF NOT EXISTS idx_gv_muscles     ON gymverse_workouts USING GIN (muscle_groups);

-- ── 3. Auto-update updated_at ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION _gv_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;
DROP TRIGGER IF EXISTS trg_gv_updated_at ON gymverse_workouts;
CREATE TRIGGER trg_gv_updated_at
  BEFORE UPDATE ON gymverse_workouts
  FOR EACH ROW EXECUTE FUNCTION _gv_updated_at();

-- ── 4. Day-level volume view ──────────────────────────────────────────────────
-- Aggregates all sessions in a day into one row.
-- Use this for the "Lift 50,000 kg this month" goal progress.
CREATE OR REPLACE VIEW gymverse_daily_volume AS
SELECT
  workout_date                                              AS date,
  COUNT(*)                                                 AS sessions,
  ROUND(SUM(total_volume_lbs)::numeric, 0)                AS total_volume_lbs,
  ROUND(SUM(total_volume_kg)::numeric,  1)                AS total_volume_kg,
  SUM(duration_secs)                                       AS total_duration_secs,
  ROUND(SUM(active_energy_kcal)::numeric, 0)              AS total_kcal,
  -- all distinct muscle groups worked that day
  ARRAY(
    SELECT DISTINCT unnest(muscle_groups)
    FROM   gymverse_workouts g2
    WHERE  g2.workout_date = g.workout_date
    ORDER  BY 1
  )                                                        AS muscle_groups,
  -- all workout names that day
  ARRAY_AGG(workout_name ORDER BY started_at)              AS workout_names
FROM gymverse_workouts g
WHERE workout_date IS NOT NULL
GROUP BY workout_date
ORDER BY workout_date DESC;

-- ── 5. Monthly volume summary (for goal tracking) ─────────────────────────────
CREATE OR REPLACE VIEW gymverse_monthly_volume AS
SELECT
  DATE_TRUNC('month', workout_date)::date                 AS month,
  COUNT(DISTINCT workout_date)                            AS training_days,
  COUNT(*)                                               AS sessions,
  ROUND(SUM(total_volume_lbs)::numeric, 0)               AS total_volume_lbs,
  ROUND(SUM(total_volume_kg)::numeric,  1)               AS total_volume_kg,
  SUM(duration_secs)                                      AS total_duration_secs
FROM gymverse_workouts
WHERE workout_date IS NOT NULL
GROUP BY DATE_TRUNC('month', workout_date)
ORDER BY month DESC;

-- ── 6. RLS & grants ──────────────────────────────────────────────────────────
ALTER TABLE gymverse_workouts ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'gymverse_workouts'
    AND   policyname = 'anon_read_gymverse'
  ) THEN
    CREATE POLICY anon_read_gymverse
      ON gymverse_workouts FOR SELECT TO anon USING (true);
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON gymverse_workouts TO service_role;
GRANT SELECT ON gymverse_workouts     TO anon;
GRANT SELECT ON gymverse_daily_volume  TO anon, service_role;
GRANT SELECT ON gymverse_monthly_volume TO anon, service_role;
