CREATE TABLE IF NOT EXISTS gymverse_workouts (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id         text        UNIQUE,
  workout_name        text,
  started_at          timestamptz NOT NULL,
  ended_at            timestamptz,
  duration_secs       int,
  active_energy_kcal  numeric,
  total_volume_kg     numeric,
  exercises           jsonb,
  source_app          text        DEFAULT 'gymverse',
  device              text,
  raw                 jsonb,
  created_at          timestamptz DEFAULT now(),
  updated_at          timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_gymverse_started ON gymverse_workouts(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_gymverse_ext_id  ON gymverse_workouts(external_id);
ALTER TABLE gymverse_workouts ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='gymverse_workouts' AND policyname='anon_read_gymverse') THEN
    CREATE POLICY anon_read_gymverse ON gymverse_workouts FOR SELECT TO anon USING (true);
  END IF;
END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON gymverse_workouts TO service_role;
GRANT SELECT ON gymverse_workouts TO anon;
