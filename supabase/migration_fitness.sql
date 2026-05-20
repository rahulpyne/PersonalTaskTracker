-- ── Fitness tracking tables ───────────────────────────────────────────────────
-- Run in Supabase Dashboard → SQL Editor

-- 1. Activities — individual workout sessions from Strava or Apple Health
CREATE TABLE IF NOT EXISTS fitness_activities (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  source           text        NOT NULL CHECK (source IN ('strava', 'apple_health')),
  external_id      text        UNIQUE,                          -- e.g. "strava:12345678"
  type             text        NOT NULL,                        -- run|ride|swim|walk|hike|strength|yoga|hiit|workout
  name             text,
  started_at       timestamptz NOT NULL,
  duration_secs    int,                                         -- elapsed time
  moving_secs      int,                                         -- moving time (Strava)
  distance_m       numeric,
  elevation_gain_m numeric,
  avg_hr           int,
  max_hr           int,
  calories         int,
  avg_speed_kmh    numeric,
  raw              jsonb,                                       -- full API response preserved
  created_at       timestamptz DEFAULT now()
);

-- 2. Daily metrics — Apple Health summary per day
CREATE TABLE IF NOT EXISTS fitness_daily_metrics (
  id               uuid  PRIMARY KEY DEFAULT gen_random_uuid(),
  date             date  NOT NULL UNIQUE,
  steps            int,
  active_cals      int,
  total_cals       int,
  exercise_mins    int,
  stand_hours      int,
  resting_hr       int,
  avg_hr           int,
  hrv              numeric,   -- heart rate variability (ms)
  vo2_max          numeric,
  sleep_hrs        numeric,
  sleep_deep_hrs   numeric,
  sleep_rem_hrs    numeric,
  raw              jsonb,
  created_at       timestamptz DEFAULT now()
);

-- 3. Goals — user-defined targets
CREATE TABLE IF NOT EXISTS fitness_goals (
  id           uuid  PRIMARY KEY DEFAULT gen_random_uuid(),
  type         text  NOT NULL,    -- weekly_distance_km|monthly_sessions|weight_kg|custom
  title        text  NOT NULL,
  target_value numeric,
  unit         text,              -- km|sessions|kg|min|%
  target_date  date,
  status       text  DEFAULT 'active' CHECK (status IN ('active', 'completed', 'abandoned')),
  created_at   timestamptz DEFAULT now()
);

-- 4. Weekly training plans — AI-generated
CREATE TABLE IF NOT EXISTS fitness_plans (
  id          uuid  PRIMARY KEY DEFAULT gen_random_uuid(),
  week_start  date  NOT NULL UNIQUE,
  goal_ids    uuid[],
  plan        jsonb NOT NULL,   -- { monday: { type, duration, notes }, … }
  rationale   text,
  created_at  timestamptz DEFAULT now()
);

-- 5. Weekly insights — AI summary + highlights
CREATE TABLE IF NOT EXISTS fitness_insights (
  id          uuid  PRIMARY KEY DEFAULT gen_random_uuid(),
  week_start  date  NOT NULL UNIQUE,
  summary     text,
  highlights  jsonb,   -- { totalKm, activeDays, avgSteps, avgSleep, avgHRV }
  insights    jsonb,   -- { list: string[], weeklyPlan: {}, goalProgress: [] }
  created_at  timestamptz DEFAULT now()
);

-- ── Indexes ───────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_fitness_activities_started ON fitness_activities(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_fitness_activities_type    ON fitness_activities(type);
CREATE INDEX IF NOT EXISTS idx_fitness_daily_metrics_date ON fitness_daily_metrics(date DESC);
CREATE INDEX IF NOT EXISTS idx_fitness_goals_status       ON fitness_goals(status);

-- ── RLS ───────────────────────────────────────────────────────────────────────
ALTER TABLE fitness_activities    ENABLE ROW LEVEL SECURITY;
ALTER TABLE fitness_daily_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE fitness_goals         ENABLE ROW LEVEL SECURITY;
ALTER TABLE fitness_plans         ENABLE ROW LEVEL SECURITY;
ALTER TABLE fitness_insights      ENABLE ROW LEVEL SECURITY;

-- anon can read (frontend)
CREATE POLICY "anon_read_activities"    ON fitness_activities    FOR SELECT TO anon USING (true);
CREATE POLICY "anon_read_metrics"       ON fitness_daily_metrics FOR SELECT TO anon USING (true);
CREATE POLICY "anon_read_goals"         ON fitness_goals         FOR SELECT TO anon USING (true);
CREATE POLICY "anon_read_plans"         ON fitness_plans         FOR SELECT TO anon USING (true);
CREATE POLICY "anon_read_insights"      ON fitness_insights      FOR SELECT TO anon USING (true);

-- service_role can do everything (agents)
GRANT SELECT, INSERT, UPDATE, DELETE ON fitness_activities    TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON fitness_daily_metrics TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON fitness_goals         TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON fitness_plans         TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON fitness_insights      TO service_role;
