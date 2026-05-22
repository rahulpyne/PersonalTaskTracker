/**
 * One-time setup: creates the gymverse_workouts table in Supabase.
 * Run once: node agents/fitness/setup-gymverse-table.js
 * 
 * Requires your Supabase project DB password (find it in:
 *   Supabase Dashboard → Project Settings → Database → Database password)
 * 
 * Alternatively, open Supabase Dashboard → SQL Editor and paste migration_gymverse.sql
 */
import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import { log, warn } from '../lib/logger.js'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

// Create table via a stored procedure we'll install first
const SETUP_SQL = `
-- Step 1: create a temporary exec_sql helper (self-destructs after use)
CREATE OR REPLACE FUNCTION _tmp_exec(query text) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN EXECUTE query; END; $$;

-- Step 2: create the gymverse_workouts table
SELECT _tmp_exec($Q$
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
  source_app          text DEFAULT 'gymverse',
  device              text,
  raw                 jsonb,
  created_at          timestamptz DEFAULT now(),
  updated_at          timestamptz DEFAULT now()
)
$Q$);

SELECT _tmp_exec('CREATE INDEX IF NOT EXISTS idx_gymverse_started ON gymverse_workouts(started_at DESC)');
SELECT _tmp_exec('CREATE INDEX IF NOT EXISTS idx_gymverse_ext_id ON gymverse_workouts(external_id)');
SELECT _tmp_exec('ALTER TABLE gymverse_workouts ENABLE ROW LEVEL SECURITY');
SELECT _tmp_exec($Q$GRANT SELECT, INSERT, UPDATE, DELETE ON gymverse_workouts TO service_role$Q$);
SELECT _tmp_exec($Q$GRANT SELECT ON gymverse_workouts TO anon$Q$);

-- Step 3: clean up the helper
DROP FUNCTION IF EXISTS _tmp_exec(text);
`

// Can we call this via rpc? Only if _tmp_exec already exists (bootstrap problem)
// But we can try to create it first via the exec endpoint

// Instead, use the simpler approach:
// If the table is missing, output exactly what the user needs to do
const { error } = await supabase.from('gymverse_workouts').select('id').limit(1)

if (!error) {
  log('✅ gymverse_workouts table already exists!')
  process.exit(0)
}

if (error.message.includes('does not exist') || error.message.includes('schema cache')) {
  console.log('\n' + '═'.repeat(60))
  console.log('📋 TABLE SETUP REQUIRED — 30 seconds in Supabase Dashboard')
  console.log('═'.repeat(60))
  console.log('\n1. Open: https://supabase.com/dashboard/project/sozysnvupisjygmwdzej/sql')
  console.log('\n2. Paste and run this SQL:\n')
  
  const sql = `CREATE TABLE IF NOT EXISTS gymverse_workouts (
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
CREATE POLICY anon_read_gymverse ON gymverse_workouts FOR SELECT TO anon USING (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON gymverse_workouts TO service_role;
GRANT SELECT ON gymverse_workouts TO anon;`
  
  console.log(sql)
  console.log('\n3. Then re-run: node agents/fitness/strava-lift-scraper.js --days=90')
  console.log('\n' + '═'.repeat(60) + '\n')
}
