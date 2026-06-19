/**
 * Strava Lift Scraper
 *
 * Fetches photos from recent Strava WeightTraining activities,
 * uses Gemini Vision to extract per-set exercise data (weight_lbs, reps,
 * is_warmup, is_dropset, superset_group), and upserts results into
 * gymverse_workouts with full per-set JSONB, muscle groups text[],
 * total_volume_lbs, and workout_date.
 *
 * Usage (standalone):
 *   node agents/fitness/strava-lift-scraper.js
 *   node agents/fitness/strava-lift-scraper.js --days=90
 *   node agents/fitness/strava-lift-scraper.js --days=90 --dry-run
 *
 * Also exported as run(supabase, opts) for the orchestrator auto-trigger.
 */

import 'dotenv/config'
import fs   from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { createSupabaseClient } from '../lib/supabase.js'
import { log, warn } from '../lib/logger.js'

const __dir       = path.dirname(fileURLToPath(import.meta.url))
const CONFIG_FILE = path.join(__dir, 'strava-config.json')

// ── CLI args (used when running standalone) ───────────────────────────────────
const args          = process.argv.slice(2)
const LOOKBACK      = Number(args.find(a => a.startsWith('--days='))?.split('=')[1] ?? 14)
const DRY_RUN       = args.includes('--dry-run')
const SKIP_EXISTING = args.includes('--skip-existing')  // skip activities already in DB (saves Gemini API cost on backfills)

// ── Strava token refresh ──────────────────────────────────────────────────────
async function getToken() {
  if (!fs.existsSync(CONFIG_FILE))
    throw new Error('No strava-config.json — run strava-oauth.js first')
  let cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'))
  if (Date.now() / 1000 >= cfg.expires_at - 300) {
    log('StravaLiftScraper: refreshing token')
    const r = await fetch('https://www.strava.com/oauth/token', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id:     process.env.STRAVA_CLIENT_ID,
        client_secret: process.env.STRAVA_CLIENT_SECRET,
        grant_type:    'refresh_token',
        refresh_token: cfg.refresh_token,
      }),
    })
    const d = await r.json()
    cfg.access_token  = d.access_token
    cfg.refresh_token = d.refresh_token
    cfg.expires_at    = d.expires_at
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2))
  }
  return cfg.access_token
}

// ── Strava API helpers ────────────────────────────────────────────────────────
async function stravaGet(path, token) {
  const r = await fetch(`https://www.strava.com/api/v3${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!r.ok) {
    const text = await r.text()
    throw new Error(`Strava ${path} → ${r.status}: ${text}`)
  }
  return r.json()
}

async function fetchWeightActivities(token, lookbackDays) {
  const after = Math.floor((Date.now() - lookbackDays * 86_400_000) / 1000)
  const activities = []
  let page = 1
  while (true) {
    const batch = await stravaGet(
      `/athlete/activities?after=${after}&per_page=100&page=${page}`,
      token
    )
    if (!Array.isArray(batch) || !batch.length) break
    const strength = batch.filter(a =>
      ['WeightTraining', 'Crossfit', 'Workout', 'HIIT'].includes(a.sport_type || a.type)
    )
    activities.push(...strength)
    if (batch.length < 100) break
    page++
  }
  return activities
}

async function fetchActivityPhotos(activityId, token) {
  try {
    const photos = await stravaGet(
      `/activities/${activityId}/photos?photo_sources=true&size=1024`,
      token
    )
    return Array.isArray(photos) ? photos : []
  } catch (e) {
    warn(`StravaLiftScraper: photos fetch failed for ${activityId} — ${e.message}`)
    return []
  }
}

// ── Image download → base64 ───────────────────────────────────────────────────
async function imageToBase64(url) {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`Image fetch ${r.status}: ${url}`)
  const buf = await r.arrayBuffer()
  const contentType = r.headers.get('content-type') || 'image/jpeg'
  const mimeType = contentType.split(';')[0].trim()
  return { data: Buffer.from(buf).toString('base64'), mimeType }
}

// ── Gemini Vision: extract per-set workout data ───────────────────────────────
const VISION_PROMPT = `
You are an expert fitness data extractor. Carefully analyse this gym workout
photo and extract every piece of workout information visible.

Return ONLY a valid JSON object — no markdown fences, no extra text.

━━ What to look for ━━
• Whiteboards, mirrors, gym screens, phone displays showing sets / reps / weights
• Bar + plates loaded (identify plate sizes: 45, 35, 25, 10, 5, 2.5 lbs)
• Dumbbells or machine weight stacks (read the label if visible)
• Exercise being performed (infer from body position, equipment, setting)
• Supersets (exercises paired together — same letter label, e.g. "A1 / A2")
• Warm-up sets vs working sets (lighter first sets)
• Drop-sets (same exercise, weight reduced mid-set)
• Any written notes: PR, RPE, paused, tempo, etc.

━━ Weight conversion ━━
• Always convert to lbs: if kg shown, multiply × 2.205 then round to nearest 5
• Bar alone = 45 lbs (standard Olympic), 35 lbs (women's), 15 lbs (EZ-curl)
• Total bar weight = bar + both sides of plates

━━ JSON schema ━━
{
  "workout_type": "strength | hypertrophy | powerlifting | crossfit | circuit",
  "exercises": [
    {
      "name": "string",              // canonical name, e.g. "Barbell Bench Press"
      "muscle_groups": {
        "primary":   ["string"],     // e.g. ["chest", "triceps"]
        "secondary": ["string"]      // e.g. ["front_delts", "core"]
      },
      "sets": [
        {
          "set_num":        1,       // 1-indexed
          "weight_lbs":     225,     // total weight in lbs (null if bodyweight/unknown)
          "weight_kg":      102.1,   // weight_lbs / 2.205 (null if weight_lbs null)
          "reps":           5,       // reps performed (null if not visible)
          "is_warmup":      false,   // true if clearly a lighter warm-up set
          "is_dropset":     false,   // true if weight was reduced from previous set
          "superset_group": null     // "A", "B", etc. if paired; null otherwise
        }
      ],
      "total_sets":         3,       // count of working sets (excl. warmups)
      "top_set_weight_lbs": 225,     // heaviest weight_lbs across all sets
      "top_set_reps":       5,       // reps at top_set_weight
      "volume_lbs":         3375,    // sum(weight_lbs × reps) for this exercise
      "e1rm_lbs":           253,     // Epley: top_weight × (1 + top_reps/30), round to int
      "notes":              null     // any visible note, e.g. "PR", "RPE 8", "paused"
    }
  ],
  "total_volume_lbs": 8950,          // sum of all exercise volume_lbs
  "confidence": "high | medium | low",
  "image_description": "string"      // brief description (≤ 20 words)
}

━━ Exercise naming conventions ━━
Use these exact canonical names where applicable:
• Flat barbell bench press → "Barbell Bench Press"
• Incline barbell press / barbell incline press → "Barbell Incline Press"
• Decline barbell press / barbell decline press → "Decline Barbell Bench Press"
• Incline dumbbell press → "Incline Dumbbell Press"
• Plate-loaded incline machine → "Plate Loaded Incline Chest Press Machine"
When in doubt about flat vs incline vs decline, look at bench angle in the image.

━━ Rules ━━
1. If no workout data is visible (pure selfie, no equipment/whiteboard), return exercises: []
2. Never invent exercises not evidenced in the image
3. If only one set is visible, create a single-element sets array
4. If reps are not visible, set reps: null; still record the weight if visible
5. Warm-up sets still go in the sets array but mark is_warmup: true
6. volume_lbs for an exercise = sum of (weight_lbs × reps) for sets where both are non-null
7. Return ONLY the JSON object
`.trim()

async function analyseImage({ data, mimeType }, activityName, caption, gemini) {
  const model = gemini.getGenerativeModel({
    model: process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite',
  })

  const contextNote = [
    activityName && `Activity name: "${activityName}"`,
    caption      && `Photo caption: "${caption}"`,
  ].filter(Boolean).join('\n')

  const textPart = contextNote
    ? `${VISION_PROMPT}\n\nAdditional context:\n${contextNote}`
    : VISION_PROMPT

  const result = await model.generateContent({
    contents: [{
      role: 'user',
      parts: [
        { inlineData: { mimeType, data } },
        { text: textPart },
      ],
    }],
    generationConfig: { temperature: 0.1 },
  })

  const raw     = result.response.text().trim()
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
  return JSON.parse(cleaned)
}

// ── Merge exercises across photos (dedup by name, merge sets) ─────────────────
function mergeExercises(allExtractions) {
  const byName = new Map()

  for (const extracted of allExtractions) {
    for (const ex of (extracted.exercises ?? [])) {
      const key = ex.name?.toLowerCase().trim()
      if (!key) continue

      if (!byName.has(key)) {
        byName.set(key, {
          name:          ex.name,
          muscle_groups: ex.muscle_groups ?? { primary: [], secondary: [] },
          sets:          [],
          notes:         ex.notes ?? null,
        })
      }

      const stored = byName.get(key)

      // Merge muscle groups (union)
      if (ex.muscle_groups?.primary)
        for (const m of ex.muscle_groups.primary)
          if (!stored.muscle_groups.primary.includes(m))
            stored.muscle_groups.primary.push(m)
      if (ex.muscle_groups?.secondary)
        for (const m of ex.muscle_groups.secondary)
          if (!stored.muscle_groups.secondary.includes(m))
            stored.muscle_groups.secondary.push(m)

      // Merge sets (avoid duplicates by set_num + weight + reps)
      for (const s of (ex.sets ?? [])) {
        const dup = stored.sets.find(
          x => x.set_num === s.set_num &&
               x.weight_lbs === s.weight_lbs &&
               x.reps === s.reps
        )
        if (!dup) stored.sets.push(s)
      }
    }
  }

  // Finalise each exercise
  const exercises = []
  for (const ex of byName.values()) {
    // Sort sets by set_num
    ex.sets.sort((a, b) => (a.set_num ?? 0) - (b.set_num ?? 0))

    const workingSets = ex.sets.filter(s => !s.is_warmup)
    const total_sets  = workingSets.length || ex.sets.length

    // Top set = highest weight among working sets (or all sets)
    const setsWithWeight = (workingSets.length ? workingSets : ex.sets)
      .filter(s => s.weight_lbs != null)
    const topSet = setsWithWeight.sort((a, b) => (b.weight_lbs ?? 0) - (a.weight_lbs ?? 0))[0]

    const top_set_weight_lbs = topSet?.weight_lbs ?? null
    const top_set_reps       = topSet?.reps       ?? null

    // Volume = sum(weight × reps) for all sets with both values
    const volume_lbs = ex.sets.reduce((sum, s) => {
      if (s.weight_lbs != null && s.reps != null) return sum + s.weight_lbs * s.reps
      return sum
    }, 0) || null

    const volume_kg = volume_lbs ? +( volume_lbs / 2.205).toFixed(1) : null

    // Epley e1RM
    const e1rm_lbs = (top_set_weight_lbs && top_set_reps)
      ? Math.round(top_set_weight_lbs * (1 + top_set_reps / 30))
      : null

    exercises.push({
      name:             ex.name,
      muscle_groups:    ex.muscle_groups,
      sets:             ex.sets,
      total_sets,
      top_set_weight_lbs,
      top_set_reps,
      volume_lbs:       volume_lbs ? Math.round(volume_lbs) : null,
      volume_kg,
      e1rm_lbs,
      notes:            ex.notes,
    })
  }

  return exercises
}

// ── Build DB row ──────────────────────────────────────────────────────────────
function buildRow(act, exercises, totalVolumeLbs, bestConfidence, imageDescriptions, analysedCount, photoCount) {
  const totalVolumeKg = totalVolumeLbs > 0
    ? +(totalVolumeLbs / 2.205).toFixed(1)
    : null

  // Flat list of all muscle groups for the GIN-indexed text[] column
  const muscleSet = new Set()
  for (const ex of exercises) {
    for (const m of (ex.muscle_groups?.primary   ?? [])) muscleSet.add(m)
    for (const m of (ex.muscle_groups?.secondary ?? [])) muscleSet.add(m)
  }

  const workoutDate = act.start_date?.slice(0, 10) ?? null

  return {
    external_id:        `strava:${act.id}`,
    workout_name:       act.name,
    workout_date:       workoutDate,
    started_at:         act.start_date,
    ended_at:           null,
    duration_secs:      act.elapsed_time  || null,
    active_energy_kcal: act.calories      || null,
    total_volume_lbs:   totalVolumeLbs > 0 ? Math.round(totalVolumeLbs) : null,
    total_volume_kg:    totalVolumeKg,
    muscle_groups:      muscleSet.size ? [...muscleSet].sort() : null,
    exercises:          exercises.length ? exercises : null,
    source_app:         'strava_photos',
    raw: {
      strava_activity_id: act.id,
      photo_count:        photoCount,
      analysed_photos:    analysedCount,
      confidence:         bestConfidence,
      image_descriptions: imageDescriptions,
      scraped_at:         new Date().toISOString(),
    },
  }
}

// ── Canonical lift key (mirrors dashboard logic) ─────────────────────────────
const CANONICAL_MAP = [
  { key:'bench',    terms:['bench press','chest press','barbell bench','flat bench',
                            'incline bench press','incline barbell','barbell incline',
                            'decline bench','decline barbell','decline press'] },
  { key:'squat',    terms:['barbell squat','back squat','front squat',' squat'] },
  { key:'deadlift', terms:['deadlift','sumo dead','romanian dead','rdl'] },
  { key:'ohp',      terms:['overhead press','military press','shoulder press','smith machine overhead','ohp','arnold press','dumbbell overhead','seated overhead'] },
  { key:'row',      terms:['barbell row','bent over row','chest supported','cable row','seated row','machine row'] },
]
function toCanonicalKey(name) {
  const n = (name||'').toLowerCase()
  for (const { key, terms } of CANONICAL_MAP)
    if (terms.some(t => n.includes(t))) return key
  return null
}

// ── Exercise name normaliser ──────────────────────────────────────────────────
// Fixes capitalization and punctuation so the same exercise scraped on different
// days doesn't end up as two separate PR rows.
function normaliseExerciseName(raw) {
  if (!raw) return raw
  return raw
    .trim()
    // Step 1: Title-case every word
    .replace(/\b\w+\b/g, w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    // Step 2: Restore known uppercase acronyms
    .replace(/\bEz\b/g,  'EZ')
    .replace(/\bOhp\b/g, 'OHP')
    .replace(/\bRdl\b/g, 'RDL')
    .replace(/\bT-bar\b/gi, 'T-Bar')
    // Step 3: Collapse EZ-Bar / EZ Bar variants → "EZ Bar"
    .replace(/EZ[-–]\s*Bar\b/gi, 'EZ Bar')
    // Step 4: Singular "Tricep" not "Triceps" for consistency
    .replace(/\bTriceps\b/g, 'Tricep')
    // Step 5: Drop trailing comma-separated qualifiers that Gemini sometimes adds
    // e.g. "Lat Pulldown, Overhand Grip" vs "Lat Pulldown" — keep base name
    // (only collapse if the qualifier after the comma is a grip/stance descriptor)
    .replace(/,\s*(Overhand|Underhand|Neutral|Pronated|Supinated|Wide|Narrow|Close|Standard)\s*Grip$/i, '')
    .trim()
}

// ── PR maintenance — upsert gymverse_exercise_prs ────────────────────────────
async function upsertExercisePRs(supabase, workouts) {
  // Aggregate all appearances of each exercise across all provided workouts
  const byExercise = {}

  for (const w of workouts) {
    const date        = w.workout_date || w.started_at?.slice(0, 10)
    const workoutName = w.workout_name
    const workoutId   = w.external_id

    for (const ex of (w.exercises || [])) {
      const rawName = ex.name
      if (!rawName) continue
      // Skip "Unknown …" entries — they carry no usable exercise data
      if (/^unknown\b/i.test(rawName.trim())) continue
      const name = normaliseExerciseName(rawName)
      if (!byExercise[name]) byExercise[name] = []
      byExercise[name].push({
        date,
        workout_name: workoutName,
        workout_id:   workoutId,
        e1rm_lbs:     ex.e1rm_lbs     ?? null,
        top_weight_lbs: ex.top_set_weight_lbs ?? null,
        top_reps:     ex.top_set_reps  ?? null,
        volume_lbs:   ex.volume_lbs    ?? null,
      })
    }
  }

  let upserted = 0
  for (const [exercise_name, appearances] of Object.entries(byExercise)) {
    // Sort chronologically
    appearances.sort((a, b) => (a.date||'') < (b.date||'') ? -1 : 1)

    // Find the all-time best entry
    const best = appearances.reduce((b, a) => {
      const aE = a.e1rm_lbs ?? 0, bE = b?.e1rm_lbs ?? 0
      return aE > bE ? a : b
    }, null)

    if (!best) continue

    const canonical_key = toCanonicalKey(exercise_name)

    // Keep up to 50 appearances for the history chart (enough for ~1 year of weekly sessions)
    const history = appearances.slice(-50).map(a => ({
      date:           a.date,
      workout_name:   a.workout_name,
      e1rm_lbs:       a.e1rm_lbs,
      top_weight_lbs: a.top_weight_lbs,
      top_reps:       a.top_reps,
      volume_lbs:     a.volume_lbs,
    }))

    const { error } = await supabase
      .from('gymverse_exercise_prs')
      .upsert({
        exercise_name,
        canonical_key,
        best_e1rm_lbs:    best.e1rm_lbs,
        best_weight_lbs:  best.top_weight_lbs,
        best_reps:        best.top_reps,
        best_volume_lbs:  appearances.reduce((m, a) => Math.max(m, a.volume_lbs ?? 0), 0) || null,
        achieved_at:      best.date,
        workout_id:       best.workout_id,
        history,
      }, { onConflict: 'exercise_name', ignoreDuplicates: false })

    if (error) warn(`  PR upsert error [${exercise_name}] — ${error.message}`)
    else upserted++
  }

  log(`StravaLiftScraper: PR rows upserted — ${upserted} exercises`)
}

// ── Core run function (exported for orchestrator) ─────────────────────────────
export async function run(supabase, opts = {}) {
  const lookbackDays  = opts.lookbackDays  ?? LOOKBACK
  const dryRun        = opts.dryRun        ?? DRY_RUN
  const skipExisting  = opts.skipExisting  ?? SKIP_EXISTING

  const gemini = new GoogleGenerativeAI(process.env.GEMINI_API_KEY)

  log(`StravaLiftScraper: starting — lookback ${lookbackDays}d${dryRun ? ' [DRY RUN]' : ''}${skipExisting ? ' [skip-existing]' : ''}`)

  const token = await getToken()

  const activities = await fetchWeightActivities(token, lookbackDays)
  log(`StravaLiftScraper: ${activities.length} strength activity(s) found`)

  if (!activities.length) {
    log('StravaLiftScraper: nothing to process')
    return { processed: 0, saved: 0 }
  }

  // ── Build set of already-scraped activity IDs (for --skip-existing / backfill mode) ──
  let existingIds = new Set()
  if (skipExisting) {
    const { data: existing } = await supabase.from('gymverse_workouts').select('external_id')
    existingIds = new Set((existing || []).map(r => String(r.external_id)))
    log(`StravaLiftScraper: ${existingIds.size} workouts already in DB — will skip`)
  }

  let totalPhotos = 0, analysedPhotos = 0, saved = 0
  const confRank = { high: 3, medium: 2, low: 1 }

  for (const act of activities) {
    log(`\nStravaLiftScraper: ── ${act.name} (${act.id}) ${act.start_date?.slice(0,10)} ──`)

    // Skip activities already in DB when running backfill with --skip-existing
    if (skipExisting && existingIds.has(String(act.id))) {
      log('  already in DB — skipping (--skip-existing)')
      continue
    }

    const photos = await fetchActivityPhotos(act.id, token)
    if (!photos.length) { log('  no photos — skipping'); continue }

    log(`  ${photos.length} photo(s)`)
    totalPhotos += photos.length

    const allExtractions   = []
    const imageDescriptions = []
    let bestConfidence = 'low'

    for (const [pi, photo] of photos.entries()) {
      const url =
        photo.urls?.['1024'] ??
        photo.urls?.['600']  ??
        photo.urls?.['100']  ??
        Object.values(photo.urls ?? {})[0]

      if (!url) { warn(`  photo ${pi+1}: no URL — skipping`); continue }

      log(`  photo ${pi+1}/${photos.length}: ${url.slice(0,60)}…`)

      let imgB64
      try { imgB64 = await imageToBase64(url) }
      catch (e) { warn(`  download failed — ${e.message}`); continue }

      let extracted
      try { extracted = await analyseImage(imgB64, act.name, photo.caption, gemini) }
      catch (e) { warn(`  vision failed — ${e.message}`); continue }

      analysedPhotos++
      log(`  → conf: ${extracted.confidence} | exercises: ${extracted.exercises?.length ?? 0} | ${extracted.image_description?.slice(0,60) ?? ''}`)

      allExtractions.push(extracted)
      if (extracted.image_description) imageDescriptions.push(extracted.image_description)
      if (confRank[extracted.confidence] > confRank[bestConfidence])
        bestConfidence = extracted.confidence
    }

    if (!allExtractions.some(e => e.exercises?.length)) {
      log('  no workout data extracted — skipping')
      continue
    }

    const exercises = mergeExercises(allExtractions)

    // Recompute total volume from merged exercises (more accurate than per-photo estimates)
    const totalVolumeLbs = exercises.reduce((s, ex) => s + (ex.volume_lbs ?? 0), 0)

    log(`  exercises: ${exercises.map(e =>
      `${e.name}${e.top_set_weight_lbs ? ` ${e.top_set_weight_lbs}lbs×${e.top_set_reps ?? '?'}` : ''}`
    ).join(', ')}`)
    if (totalVolumeLbs > 0)
      log(`  total volume: ${Math.round(totalVolumeLbs).toLocaleString()} lbs (${+(totalVolumeLbs/2.205).toFixed(0)} kg)`)

    const row = buildRow(act, exercises, totalVolumeLbs, bestConfidence, imageDescriptions, analysedPhotos, photos.length)

    if (dryRun) {
      log('  [DRY RUN] row preview:\n' + JSON.stringify(row, null, 2).slice(0, 600))
      continue
    }

    const { error } = await supabase
      .from('gymverse_workouts')
      .upsert(row, { onConflict: 'external_id', ignoreDuplicates: false })

    if (error) warn(`  DB upsert error — ${error.message}`)
    else { log('  ✅ saved'); saved++ }
  }

  // ── Refresh PR table from full history (runs unconditionally, not gated on saved > 0) ──
  // This ensures re-runs always rebuild correct all-time history even with no new scraped acts.
  if (!dryRun) {
    try {
      const { data: allWorkouts } = await supabase
        .from('gymverse_workouts')
        .select('external_id,workout_name,workout_date,started_at,exercises')
        .order('workout_date', { ascending: true })
      if (allWorkouts?.length) {
        await upsertExercisePRs(supabase, allWorkouts)
      } else {
        log('StravaLiftScraper: no workouts in DB yet — skipping PR refresh')
      }
    } catch(e) {
      warn(`StravaLiftScraper: PR maintenance failed — ${e.message}`)
    }
  }

  log(`\nStravaLiftScraper: done`)
  log(`  activities   : ${activities.length}`)
  log(`  photos found : ${totalPhotos}`)
  log(`  photos analysed: ${analysedPhotos}`)
  log(`  workouts saved : ${saved}`)

  return { processed: activities.length, saved }
}

// ── Standalone entry point ────────────────────────────────────────────────────
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const supabase = createSupabaseClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY,
  )
  run(supabase, { lookbackDays: LOOKBACK, dryRun: DRY_RUN })
    .catch(e => { console.error('StravaLiftScraper: fatal —', e); process.exit(1) })
}
