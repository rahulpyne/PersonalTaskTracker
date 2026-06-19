#!/usr/bin/env node
/**
 * Strava MCP Server
 *
 * Exposes Strava API as MCP tools for Claude Code.
 * Reads OAuth tokens from strava-config.json and auto-refreshes when expired.
 *
 * Configure in .claude/mcp.json:
 *   { "strava": { "command": "node", "args": ["agents/fitness/strava-mcp.js"] } }
 *
 * Tools:
 *   strava_get_activities      – List recent activities (filterable)
 *   strava_get_activity        – Full detail for one activity by ID
 *   strava_get_athlete         – Athlete profile
 *   strava_get_athlete_stats   – All-time totals (YTD + recent)
 *   strava_get_zones           – Athlete heart-rate zones
 *   strava_get_starred_segments– Starred segments
 *   strava_sync_to_supabase    – Pull latest activities into Supabase
 */

import { McpServer }           from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z }                   from 'zod'
import 'dotenv/config'
import fs   from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dir      = path.dirname(fileURLToPath(import.meta.url))
const CONFIG_F   = path.join(__dir, 'strava-config.json')
const BASE       = 'https://www.strava.com/api/v3'

// ── Token management ─────────────────────────────────────────────────────────

function loadConfig() {
  if (!fs.existsSync(CONFIG_F)) throw new Error('strava-config.json not found — run: node agents/fitness/strava-oauth.js')
  return JSON.parse(fs.readFileSync(CONFIG_F, 'utf-8'))
}

async function getToken() {
  let cfg = loadConfig()
  if (Date.now() / 1000 < cfg.expires_at - 60) return cfg.access_token

  // Refresh
  const resp = await fetch('https://www.strava.com/oauth/token', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id:     process.env.STRAVA_CLIENT_ID     || cfg.client_id,
      client_secret: process.env.STRAVA_CLIENT_SECRET || cfg.client_secret,
      grant_type:    'refresh_token',
      refresh_token: cfg.refresh_token,
    }),
  })
  const data = await resp.json()
  if (!resp.ok) throw new Error(`Token refresh failed: ${data.message ?? resp.status}`)

  cfg = { ...cfg, access_token: data.access_token, refresh_token: data.refresh_token, expires_at: data.expires_at }
  fs.writeFileSync(CONFIG_F, JSON.stringify(cfg, null, 2))
  return cfg.access_token
}

async function stravaGet(path, params = {}) {
  const token  = await getToken()
  const url    = new URL(`${BASE}${path}`)
  for (const [k, v] of Object.entries(params)) if (v !== undefined) url.searchParams.set(k, v)
  const resp   = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } })
  const data   = await resp.json()
  if (!resp.ok) throw new Error(`Strava ${resp.status}: ${data.message ?? JSON.stringify(data)}`)
  return data
}

// ── Type maps ─────────────────────────────────────────────────────────────────

const TYPE_MAP = {
  Run:'run', TrailRun:'run', Ride:'ride', VirtualRide:'ride', MountainBikeRide:'ride',
  GravelRide:'ride', Swim:'swim', Walk:'walk', Hike:'hike',
  WeightTraining:'strength', Crossfit:'hiit', HIIT:'hiit', Yoga:'yoga', Pilates:'yoga',
  Workout:'workout', Elliptical:'cardio', StairStepper:'cardio', Rowing:'cardio',
}

// ── MCP Server ────────────────────────────────────────────────────────────────

const server = new McpServer({
  name:    'strava',
  version: '1.0.0',
})

// ── Tool: get activities ──────────────────────────────────────────────────────
server.tool(
  'strava_get_activities',
  'Fetch recent Strava activities. Optionally filter by days, type, or limit.',
  {
    days:  z.number().int().min(1).max(365).default(30).describe('How many days back to look (default 30)'),
    type:  z.enum(['run','ride','swim','walk','hike','strength','hiit','yoga','workout','cardio','all']).default('all').describe('Activity type filter'),
    limit: z.number().int().min(1).max(200).default(20).describe('Max activities to return (default 20)'),
  },
  async ({ days, type, limit }) => {
    const after = Math.floor((Date.now() - days * 86_400_000) / 1000)
    const raw   = await stravaGet('/athlete/activities', { after, per_page: limit })
    const acts  = raw
      .map(a => ({
        id:            a.id,
        name:          a.name,
        type:          TYPE_MAP[a.sport_type] ?? TYPE_MAP[a.type] ?? 'workout',
        sport_type:    a.sport_type,
        date:          a.start_date_local?.slice(0, 10),
        distance_km:   a.distance ? +(a.distance / 1000).toFixed(2) : null,
        duration_min:  a.moving_time ? Math.round(a.moving_time / 60) : null,
        elevation_m:   a.total_elevation_gain ?? null,
        avg_hr:        a.average_heartrate ? Math.round(a.average_heartrate) : null,
        max_hr:        a.max_heartrate ? Math.round(a.max_heartrate) : null,
        avg_pace_km:   a.average_speed ? `${Math.floor(1000/a.average_speed/60)}:${String(Math.round(1000/a.average_speed%60)).padStart(2,'0')}/km` : null,
        calories:      a.calories ?? null,
        suffer_score:  a.suffer_score ?? null,
        pr_count:      a.pr_count ?? 0,
        kudos:         a.kudos_count ?? 0,
        strava_url:    `https://www.strava.com/activities/${a.id}`,
      }))
      .filter(a => type === 'all' || a.type === type)

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({ count: acts.length, days, type, activities: acts }, null, 2),
      }],
    }
  }
)

// ── Tool: get single activity ─────────────────────────────────────────────────
server.tool(
  'strava_get_activity',
  'Get full detail for a single Strava activity by ID, including splits, best efforts, and laps.',
  {
    id: z.number().int().describe('Strava activity ID'),
  },
  async ({ id }) => {
    const a = await stravaGet(`/activities/${id}`, { include_all_efforts: true })
    const result = {
      id:            a.id,
      name:          a.name,
      description:   a.description,
      type:          TYPE_MAP[a.sport_type] ?? 'workout',
      sport_type:    a.sport_type,
      date:          a.start_date_local,
      distance_km:   a.distance ? +(a.distance / 1000).toFixed(3) : null,
      duration_min:  a.elapsed_time ? +(a.elapsed_time / 60).toFixed(1) : null,
      moving_min:    a.moving_time ? +(a.moving_time / 60).toFixed(1) : null,
      elevation_m:   a.total_elevation_gain,
      avg_hr:        a.average_heartrate ? Math.round(a.average_heartrate) : null,
      max_hr:        a.max_heartrate,
      avg_cadence:   a.average_cadence,
      avg_watts:     a.average_watts,
      kilojoules:    a.kilojoules,
      calories:      a.calories,
      suffer_score:  a.suffer_score,
      pr_count:      a.pr_count,
      achievement_count: a.achievement_count,
      avg_speed_kmh: a.average_speed ? +(a.average_speed * 3.6).toFixed(2) : null,
      splits_km:     (a.splits_metric ?? []).map((s, i) => ({
        km:      i + 1,
        time:    `${Math.floor(s.elapsed_time/60)}:${String(s.elapsed_time%60).padStart(2,'0')}`,
        pace:    s.average_speed ? `${Math.floor(1000/s.average_speed/60)}:${String(Math.round(1000/s.average_speed%60)).padStart(2,'0')}/km` : null,
        avg_hr:  s.average_heartrate ? Math.round(s.average_heartrate) : null,
        elev_m:  s.elevation_difference,
      })),
      best_efforts:  (a.best_efforts ?? []).map(b => ({
        name:     b.name,
        time:     `${Math.floor(b.elapsed_time/60)}:${String(b.elapsed_time%60).padStart(2,'0')}`,
        pr_rank:  b.pr_rank,
      })),
      gear:          a.gear ? { name: a.gear.name, distance_km: +(a.gear.distance/1000).toFixed(0) } : null,
      strava_url:    `https://www.strava.com/activities/${a.id}`,
    }
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
  }
)

// ── Tool: get athlete profile ─────────────────────────────────────────────────
server.tool(
  'strava_get_athlete',
  'Get the authenticated athlete\'s profile from Strava.',
  {},
  async () => {
    const a = await stravaGet('/athlete')
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          id:          a.id,
          name:        `${a.firstname} ${a.lastname}`,
          username:    a.username,
          city:        a.city,
          country:     a.country,
          weight_kg:   a.weight,
          premium:     a.premium,
          summit:      a.summit,
          follower_count: a.follower_count,
          friend_count:   a.friend_count,
          created:     a.created_at?.slice(0, 10),
          profile_url: `https://www.strava.com/athletes/${a.id}`,
        }, null, 2),
      }],
    }
  }
)

// ── Tool: get athlete stats ───────────────────────────────────────────────────
server.tool(
  'strava_get_athlete_stats',
  'Get athlete all-time and year-to-date totals from Strava: distance, time, elevation, activities.',
  {},
  async () => {
    const cfg    = loadConfig()
    const athleteId = cfg.athlete?.id
    if (!athleteId) throw new Error('No athlete ID in strava-config.json')
    const s = await stravaGet(`/athletes/${athleteId}/stats`)

    const fmt = t => ({
      activities:  t.count,
      distance_km: +(t.distance / 1000).toFixed(1),
      duration_hrs: +(t.moving_time / 3600).toFixed(1),
      elevation_km: +(t.elevation_gain / 1000).toFixed(2),
    })

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          all_time: {
            runs:     fmt(s.all_run_totals),
            rides:    fmt(s.all_ride_totals),
            swims:    fmt(s.all_swim_totals),
          },
          ytd: {
            runs:     fmt(s.ytd_run_totals),
            rides:    fmt(s.ytd_ride_totals),
            swims:    fmt(s.ytd_swim_totals),
          },
          recent: {
            runs:     fmt(s.recent_run_totals),
            rides:    fmt(s.recent_ride_totals),
            swims:    fmt(s.recent_swim_totals),
          },
          biggest_ride_km:     s.biggest_ride_distance ? +(s.biggest_ride_distance/1000).toFixed(1) : null,
          biggest_climb_m:     s.biggest_climb_elevation_gain,
        }, null, 2),
      }],
    }
  }
)

// ── Tool: get heart rate zones ────────────────────────────────────────────────
server.tool(
  'strava_get_zones',
  'Get the athlete\'s configured heart rate and power zones from Strava.',
  {},
  async () => {
    const data = await stravaGet('/athlete/zones')
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
  }
)

// ── Tool: starred segments ────────────────────────────────────────────────────
server.tool(
  'strava_get_starred_segments',
  'List the athlete\'s starred Strava segments with PR times.',
  {
    limit: z.number().int().min(1).max(50).default(10).describe('Max segments to return'),
  },
  async ({ limit }) => {
    const segs = await stravaGet('/segments/starred', { per_page: limit })
    const result = segs.map(s => ({
      id:           s.id,
      name:         s.name,
      type:         s.activity_type,
      distance_km:  +(s.distance / 1000).toFixed(2),
      avg_grade:    s.average_grade,
      max_grade:    s.maximum_grade,
      elevation_m:  s.elevation_high - s.elevation_low,
      climb_cat:    s.climb_category,
      kom_time:     s.xoms?.kom,
      pr_time:      s.athlete_pr_effort ? `${Math.floor(s.athlete_pr_effort.elapsed_time/60)}:${String(s.athlete_pr_effort.elapsed_time%60).padStart(2,'0')}` : null,
      effort_count: s.effort_count,
      star_count:   s.star_count,
      strava_url:   `https://www.strava.com/segments/${s.id}`,
    }))
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
  }
)

// ── Tool: sync to Supabase ────────────────────────────────────────────────────
server.tool(
  'strava_sync_to_supabase',
  'Pull recent Strava activities into the Supabase fitness_activities table. Same logic as the nightly cron.',
  {
    days: z.number().int().min(1).max(365).default(7).describe('How many days back to sync (default 7)'),
  },
  async ({ days }) => {
    // Dynamically import the puller so this tool stays standalone
    const { createClient } = await import('@supabase/supabase-js')
    const sb = createClient(
      process.env.SUPABASE_URL    ?? process.env.VITE_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY ?? process.env.VITE_SUPABASE_ANON_KEY,
      { auth: { persistSession: false } }
    )

    const { run } = await import('./strava-puller.js')
    const { synced } = await run(sb, { lookbackDays: days })

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({ ok: true, synced, days, message: `Synced ${synced} activities from the last ${days} days into Supabase.` }, null, 2),
      }],
    }
  }
)

// ── Tool: create manual activity ─────────────────────────────────────────────
server.tool(
  'strava_create_activity',
  'Manually create a new activity on Strava (for activities not tracked by GPS).',
  {
    name:          z.string().describe('Activity name'),
    sport_type:    z.string().describe('e.g. Run, Ride, Swim, WeightTraining, Yoga, Walk, HIIT'),
    start_date:    z.string().describe('ISO datetime e.g. 2026-06-03T08:30:00Z'),
    duration_secs: z.number().int().describe('Duration in seconds'),
    distance_m:    z.number().optional().describe('Distance in metres (optional)'),
    description:   z.string().optional().describe('Activity description (optional)'),
  },
  async ({ name, sport_type, start_date, duration_secs, distance_m, description }) => {
    const token = await getToken()
    const body  = { name, sport_type, start_date_local: start_date, elapsed_time: duration_secs }
    if (distance_m)   body.distance    = distance_m
    if (description)  body.description = description

    const resp = await fetch(`${BASE}/activities`, {
      method:  'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    })
    const data = await resp.json()
    if (!resp.ok) throw new Error(`Create activity failed: ${data.message ?? resp.status}`)

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          ok:         true,
          id:         data.id,
          name:       data.name,
          strava_url: `https://www.strava.com/activities/${data.id}`,
        }, null, 2),
      }],
    }
  }
)

// ── Tool: get running routes ──────────────────────────────────────────────────
server.tool(
  'strava_get_routes',
  'List saved routes from the athlete\'s Strava account.',
  {
    limit: z.number().int().min(1).max(30).default(10).describe('Max routes to return'),
  },
  async ({ limit }) => {
    const cfg = loadConfig()
    const routes = await stravaGet(`/athletes/${cfg.athlete?.id}/routes`, { per_page: limit })
    const result = routes.map(r => ({
      id:          r.id,
      name:        r.name,
      description: r.description,
      type:        r.type === 1 ? 'ride' : 'run',
      distance_km: +(r.distance / 1000).toFixed(2),
      elevation_m: r.elevation_gain,
      estimated_moving_time_min: r.estimated_moving_time ? Math.round(r.estimated_moving_time / 60) : null,
      strava_url:  `https://www.strava.com/routes/${r.id}`,
    }))
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
  }
)

// ── Start server ─────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
  process.stderr.write('[strava-mcp] Server started\n')
}

main().catch(err => {
  process.stderr.write(`[strava-mcp] Fatal: ${err.message}\n`)
  process.exit(1)
})
