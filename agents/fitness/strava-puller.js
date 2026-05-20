/**
 * Agent 7a — Strava Activity Puller
 *
 * Runs nightly. Fetches activities from the Strava API and upserts them
 * into fitness_activities. Handles token refresh automatically.
 *
 * Data pulled per activity:
 *   type, name, start time, distance, duration, moving time,
 *   elevation gain, avg/max heart rate, calories, average speed
 */
import 'dotenv/config'
import fs   from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { log, warn } from '../lib/logger.js'

const __dir       = path.dirname(fileURLToPath(import.meta.url))
const CONFIG_FILE = path.join(__dir, 'strava-config.json')

// Map Strava sport types → internal lowercase slugs
const TYPE_MAP = {
  Run:            'run',
  TrailRun:       'run',
  Ride:           'ride',
  VirtualRide:    'ride',
  MountainBikeRide: 'ride',
  GravelRide:     'ride',
  Swim:           'swim',
  Walk:           'walk',
  Hike:           'hike',
  WeightTraining: 'strength',
  Crossfit:       'hiit',
  HIIT:           'hiit',
  Yoga:           'yoga',
  Pilates:        'yoga',
  Workout:        'workout',
  Elliptical:     'cardio',
  StairStepper:   'cardio',
  Rowing:         'cardio',
}

async function refreshIfNeeded(config) {
  if (Date.now() / 1000 < config.expires_at - 300) return config  // still valid

  log('StravaFetcher: refreshing access token')
  const resp = await fetch('https://www.strava.com/oauth/token', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({
      client_id:     process.env.STRAVA_CLIENT_ID,
      client_secret: process.env.STRAVA_CLIENT_SECRET,
      grant_type:    'refresh_token',
      refresh_token: config.refresh_token,
    }),
  })
  const data = await resp.json()
  config.access_token  = data.access_token
  config.refresh_token = data.refresh_token
  config.expires_at    = data.expires_at
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2))
  return config
}

export async function run(supabase, { lookbackDays = 7 } = {}) {
  log('StravaFetcher: starting')

  if (!fs.existsSync(CONFIG_FILE)) {
    warn('StravaFetcher: not configured — run: node agents/fitness/strava-oauth.js')
    return { synced: 0 }
  }

  let config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'))
  config = await refreshIfNeeded(config)

  const after = Math.floor((Date.now() - lookbackDays * 86_400_000) / 1000)
  let page = 1, total = 0, synced = 0

  while (true) {
    const resp = await fetch(
      `https://www.strava.com/api/v3/athlete/activities?after=${after}&per_page=100&page=${page}`,
      { headers: { Authorization: `Bearer ${config.access_token}` } }
    )
    const activities = await resp.json()

    if (!Array.isArray(activities) || activities.length === 0) break

    for (const a of activities) {
      total++
      const row = {
        source:           'strava',
        external_id:      `strava:${a.id}`,
        type:             TYPE_MAP[a.sport_type] || TYPE_MAP[a.type] || 'workout',
        name:             a.name,
        started_at:       a.start_date,
        duration_secs:    a.elapsed_time     || null,
        moving_secs:      a.moving_time      || null,
        distance_m:       a.distance         || null,
        elevation_gain_m: a.total_elevation_gain || null,
        avg_hr:           a.average_heartrate ? Math.round(a.average_heartrate) : null,
        max_hr:           a.max_heartrate     ? Math.round(a.max_heartrate)     : null,
        calories:         a.calories          || null,
        avg_speed_kmh:    a.average_speed     ? +(a.average_speed * 3.6).toFixed(2) : null,
        raw:              a,
      }

      const { error } = await supabase
        .from('fitness_activities')
        .upsert(row, { onConflict: 'external_id' })

      if (error) warn(`StravaFetcher: upsert error (${a.id}) — ${error.message}`)
      else synced++
    }

    if (activities.length < 100) break   // last page
    page++
  }

  log(`StravaFetcher: ${total} fetched, ${synced} upserted`)
  return { synced }
}
