-- ══════════════════════════════════════════════════════════════════════════════
-- Analytics cache + Exercise PR tracking
-- Run in: Supabase Dashboard → SQL Editor
--   https://supabase.com/dashboard/project/sozysnvupisjygmwdzej/sql
-- ══════════════════════════════════════════════════════════════════════════════

-- ── 1. Add weight_kg to fitness_daily_metrics ─────────────────────────────────
ALTER TABLE fitness_daily_metrics
  ADD COLUMN IF NOT EXISTS weight_kg numeric;   -- body mass in kg (Apple Health)

-- ── 2. Exercise PR tracker ────────────────────────────────────────────────────
-- One row per exercise name; updated whenever the scraper finds a new all-time best.
CREATE TABLE IF NOT EXISTS gymverse_exercise_prs (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  exercise_name    text        NOT NULL,
  canonical_key    text,                       -- 'bench' | 'squat' | 'deadlift' | 'ohp' | 'row' | null
  best_e1rm_lbs    numeric,
  best_weight_lbs  numeric,
  best_reps        int,
  best_volume_lbs  numeric,                   -- peak single-session volume for this exercise
  achieved_at      date,
  workout_id       text,                      -- external_id of the workout that set the PR
  history          jsonb DEFAULT '[]'::jsonb, -- [{date, e1rm_lbs, top_weight_lbs, top_reps, workout_name}]
  updated_at       timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_gep_name ON gymverse_exercise_prs(exercise_name);
CREATE INDEX        IF NOT EXISTS idx_gep_key  ON gymverse_exercise_prs(canonical_key);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION _gep_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;
DROP TRIGGER IF EXISTS trg_gep_updated_at ON gymverse_exercise_prs;
CREATE TRIGGER trg_gep_updated_at
  BEFORE UPDATE ON gymverse_exercise_prs
  FOR EACH ROW EXECUTE FUNCTION _gep_updated_at();

-- ── 3. General analytics cache ────────────────────────────────────────────────
-- Key/value store for computed summaries that are expensive to recalculate.
CREATE TABLE IF NOT EXISTS fitness_analytics_cache (
  cache_key    text        PRIMARY KEY,
  data         jsonb       NOT NULL,
  computed_at  timestamptz DEFAULT now(),
  expires_at   timestamptz             -- null = never expires
);

-- ── 4. RLS + grants ───────────────────────────────────────────────────────────
ALTER TABLE gymverse_exercise_prs   ENABLE ROW LEVEL SECURITY;
ALTER TABLE fitness_analytics_cache ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='gymverse_exercise_prs'   AND policyname='anon_read_prs')   THEN
    CREATE POLICY anon_read_prs   ON gymverse_exercise_prs   FOR SELECT TO anon USING (true); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='fitness_analytics_cache' AND policyname='anon_read_cache') THEN
    CREATE POLICY anon_read_cache ON fitness_analytics_cache FOR SELECT TO anon USING (true); END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON gymverse_exercise_prs   TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON fitness_analytics_cache TO service_role;
GRANT SELECT ON gymverse_exercise_prs   TO anon;
GRANT SELECT ON fitness_analytics_cache TO anon;
