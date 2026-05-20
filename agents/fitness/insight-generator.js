/**
 * Agent 7c — Fitness Insight Generator
 *
 * Runs once per week (Sunday night). Aggregates the past 7 days of
 * fitness_activities + fitness_daily_metrics, then calls Gemini to:
 *
 *  1. Write a concise weekly summary
 *  2. Surface 3–5 actionable insights (HRV trend, load balance, sleep impact, etc.)
 *  3. Assess progress against all active goals
 *  4. Generate a structured day-by-day training plan for the coming week
 *
 * Results are stored in fitness_insights and fitness_plans.
 */
import { jsonPrompt } from '../lib/llm.js'
import { log, warn }  from '../lib/logger.js'

// ── Helpers ────────────────────────────────────────────────────────────────────

const mean = (arr, key) => {
  const vals = arr.map(x => x[key]).filter(v => v != null)
  return vals.length ? +(vals.reduce((s, v) => s + v, 0) / vals.length).toFixed(1) : null
}

const sum = (arr, key) =>
  arr.reduce((s, x) => s + (x[key] ?? 0), 0)

const fmt = {
  km:  (m) => m != null ? (m / 1000).toFixed(1) + ' km' : 'N/A',
  min: (s) => s != null ? Math.round(s / 60) + ' min' : 'N/A',
  hr:  (v) => v != null ? v + ' bpm' : 'N/A',
  hrv: (v) => v != null ? v + ' ms' : 'N/A',
}

function buildPrompt({ activities, metrics, goals, prevSummary }) {
  const totalDistM  = sum(activities, 'distance_m')
  const activeDays  = new Set(activities.map(a => a.started_at.slice(0, 10))).size
  const avgHRV      = mean(metrics, 'hrv')
  const avgSleep    = mean(metrics, 'sleep_hrs')
  const avgSteps    = mean(metrics, 'steps')
  const avgRestHR   = mean(metrics, 'resting_hr')

  const actLines = activities.map(a =>
    `  • ${a.type.toUpperCase()} "${a.name}" ${a.started_at.slice(0, 10)}: ` +
    `dist=${fmt.km(a.distance_m)} dur=${fmt.min(a.duration_secs)} ` +
    `avgHR=${fmt.hr(a.avg_hr)} cal=${a.calories ?? '?'}`
  ).join('\n') || '  (no activities recorded)'

  const metLines = metrics.map(m =>
    `  ${m.date}: steps=${m.steps ?? '?'} sleep=${m.sleep_hrs ?? '?'}h ` +
    `restHR=${m.resting_hr ?? '?'} HRV=${m.hrv ?? '?'} exerciseMins=${m.exercise_mins ?? '?'}`
  ).join('\n') || '  (no daily metrics)'

  const goalLines = goals.map(g =>
    `  • [${g.type}] "${g.title}": target ${g.target_value} ${g.unit}` +
    (g.target_date ? ` by ${g.target_date}` : '')
  ).join('\n') || '  (no active goals)'

  return `
You are a personal fitness coach reviewing the past 7 days of data for an athlete.

WEEK OVERVIEW:
  Total distance   : ${fmt.km(totalDistM)}
  Activities       : ${activities.length} across ${activeDays} active days
  Avg daily steps  : ${avgSteps ?? 'N/A'}
  Avg sleep        : ${avgSleep != null ? avgSleep + ' h/night' : 'N/A'}
  Avg resting HR   : ${fmt.hr(avgRestHR)}
  Avg HRV          : ${fmt.hrv(avgHRV)}

ACTIVITIES (past 7 days):
${actLines}

DAILY HEALTH METRICS:
${metLines}

ACTIVE GOALS:
${goalLines}

${prevSummary ? `LAST WEEK SUMMARY (for context): ${prevSummary}` : ''}

Generate a response as valid JSON with exactly this shape:
{
  "summary": "2-3 sentence paragraph summarising the week — tone: coach-like, positive but honest",
  "highlights": {
    "totalKm":   ${(totalDistM / 1000).toFixed(1)},
    "activeDays": ${activeDays},
    "avgSteps":  ${avgSteps ?? 0},
    "avgSleep":  ${avgSleep ?? 0},
    "avgHRV":    ${avgHRV ?? 0},
    "avgRestHR": ${avgRestHR ?? 0}
  },
  "insights": [
    "Specific, data-backed insight (e.g. 'HRV up 8% vs last week — recovery improving')",
    "Another insight referencing actual numbers",
    "Third insight — could be about sleep/training balance, consistency, load trends"
  ],
  "goalProgress": [
    {
      "goalTitle": "...",
      "status": "on_track | ahead | behind | no_data",
      "assessment": "One sentence — e.g. 'You logged 22 km, 73% of your 30 km weekly target'",
      "recommendation": "What to adjust next week"
    }
  ],
  "weeklyPlan": {
    "monday":    { "type": "run|ride|swim|strength|yoga|cardio|rest", "durationMins": 0, "notes": "Concise instruction" },
    "tuesday":   { "type": "...", "durationMins": 0, "notes": "..." },
    "wednesday": { "type": "...", "durationMins": 0, "notes": "..." },
    "thursday":  { "type": "...", "durationMins": 0, "notes": "..." },
    "friday":    { "type": "...", "durationMins": 0, "notes": "..." },
    "saturday":  { "type": "...", "durationMins": 0, "notes": "..." },
    "sunday":    { "type": "...", "durationMins": 0, "notes": "..." }
  }
}

Rules:
- insights must reference actual numbers from the data
- weeklyPlan must be realistic given this week's load and recovery indicators
- if no activity data exists, still produce a starter plan appropriate for a beginner
`.trim()
}

// ── Main ──────────────────────────────────────────────────────────────────────

export async function run(supabase, llm) {
  log('FitnessInsights: starting')

  // Week boundaries
  const now       = new Date()
  const weekStart = new Date(now)
  weekStart.setDate(now.getDate() - 7)
  weekStart.setHours(0, 0, 0, 0)
  const weekStartISO = weekStart.toISOString().slice(0, 10)

  const thisWeekISO = new Date(now.setHours(0, 0, 0, 0)).toISOString().slice(0, 10)

  // Fetch past 7 days of activities
  const { data: activities, error: e1 } = await supabase
    .from('fitness_activities')
    .select('type,name,started_at,distance_m,duration_secs,moving_secs,avg_hr,max_hr,calories,elevation_gain_m')
    .gte('started_at', weekStart.toISOString())
    .order('started_at', { ascending: false })
  if (e1) { warn(`FitnessInsights: activities error — ${e1.message}`); return }

  // Fetch daily metrics
  const { data: metrics, error: e2 } = await supabase
    .from('fitness_daily_metrics')
    .select('date,steps,active_cals,exercise_mins,resting_hr,avg_hr,hrv,vo2_max,sleep_hrs,sleep_deep_hrs,sleep_rem_hrs')
    .gte('date', weekStartISO)
    .order('date', { ascending: false })
  if (e2) { warn(`FitnessInsights: metrics error — ${e2.message}`); return }

  // Active goals
  const { data: goals } = await supabase
    .from('fitness_goals')
    .select('*')
    .eq('status', 'active')

  // Last week's summary for context
  const { data: prev } = await supabase
    .from('fitness_insights')
    .select('summary')
    .lt('week_start', weekStartISO)
    .order('week_start', { ascending: false })
    .limit(1)
    .maybeSingle()

  log(`FitnessInsights: ${activities?.length ?? 0} activities · ${metrics?.length ?? 0} metric days · ${goals?.length ?? 0} goals`)

  if (!activities?.length && !metrics?.length) {
    log('FitnessInsights: no data yet — skipping until Strava/Apple Health are connected')
    return
  }

  try {
    const insight = await jsonPrompt(llm, buildPrompt({
      activities:  activities  ?? [],
      metrics:     metrics     ?? [],
      goals:       goals       ?? [],
      prevSummary: prev?.summary ?? null,
    }))

    // Save insight
    const { error: e3 } = await supabase
      .from('fitness_insights')
      .upsert({
        week_start: weekStartISO,
        summary:    insight.summary,
        highlights: insight.highlights,
        insights:   {
          list:         insight.insights,
          goalProgress: insight.goalProgress,
          weeklyPlan:   insight.weeklyPlan,
        },
      }, { onConflict: 'week_start' })
    if (e3) warn(`FitnessInsights: insight upsert error — ${e3.message}`)
    else    log(`FitnessInsights: insights saved for week of ${weekStartISO}`)

    // Save training plan
    if (insight.weeklyPlan) {
      const { error: e4 } = await supabase
        .from('fitness_plans')
        .upsert({
          week_start: thisWeekISO,   // plan is for the COMING week
          goal_ids:   (goals ?? []).map(g => g.id),
          plan:       insight.weeklyPlan,
          rationale:  insight.summary,
        }, { onConflict: 'week_start' })
      if (e4) warn(`FitnessInsights: plan upsert error — ${e4.message}`)
      else    log('FitnessInsights: weekly training plan saved')
    }

    log(`FitnessInsights: done — "${insight.summary?.slice(0, 80)}…"`)
  } catch (e) {
    warn(`FitnessInsights: LLM error — ${e.message}`)
  }
}
