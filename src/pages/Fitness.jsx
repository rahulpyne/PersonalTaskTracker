/**
 * Fitness page — data-first stub
 * Reads from: fitness_activities, fitness_daily_metrics, fitness_goals,
 *             fitness_plans, fitness_insights
 * UX polish deferred — focus here is verifying data flows end-to-end.
 */
import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

// ── Mini data hook ─────────────────────────────────────────────────────────────
function useFitnessData() {
  const [data,    setData]    = useState(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)

  useEffect(() => {
    async function load() {
      try {
        const [activities, metrics, goals, plans, insights] = await Promise.all([
          supabase.from('fitness_activities')
            .select('id,source,type,name,started_at,distance_m,duration_secs,avg_hr,calories,elevation_gain_m')
            .order('started_at', { ascending: false })
            .limit(50),
          supabase.from('fitness_daily_metrics')
            .select('date,steps,active_cals,exercise_mins,resting_hr,hrv,sleep_hrs,vo2_max')
            .order('date', { ascending: false })
            .limit(30),
          supabase.from('fitness_goals')
            .select('*')
            .eq('status', 'active'),
          supabase.from('fitness_plans')
            .select('*')
            .order('week_start', { ascending: false })
            .limit(1)
            .maybeSingle(),
          supabase.from('fitness_insights')
            .select('*')
            .order('week_start', { ascending: false })
            .limit(1)
            .maybeSingle(),
        ])

        setData({
          activities: activities.data ?? [],
          metrics:    metrics.data    ?? [],
          goals:      goals.data      ?? [],
          plan:       plans.data,
          insight:    insights.data,
        })
      } catch (e) {
        setError(e.message)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  return { data, loading, error }
}

// ── Formatters ─────────────────────────────────────────────────────────────────
const fmtKm   = (m)  => m  != null ? (m / 1000).toFixed(1) + ' km' : '—'
const fmtMin  = (s)  => s  != null ? Math.round(s / 60) + ' min'   : '—'
const fmtDate = (iso) => iso ? new Date(iso).toLocaleDateString('en', { month: 'short', day: 'numeric' }) : '—'

// ── Component ──────────────────────────────────────────────────────────────────
export default function Fitness() {
  const { data, loading, error } = useFitnessData()

  const mono = { fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--ink-3)', letterSpacing: '.04em' }
  const card = { background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 10, padding: '16px 20px', marginBottom: 16 }

  if (loading) return (
    <div style={{ ...mono, padding: 32 }}>LOADING FITNESS DATA…</div>
  )

  if (error) return (
    <div style={{ ...mono, padding: 32, color: 'var(--bad)' }}>
      Error: {error}<br />
      <small>Make sure you have run the Supabase fitness migration.</small>
    </div>
  )

  const { activities, metrics, goals, plan, insight } = data
  const connected = { strava: activities.some(a => a.source === 'strava'), appleHealth: metrics.length > 0 }

  return (
    <div style={{ padding: '0 0 48px' }}>

      {/* ── Connection status ── */}
      <div style={{ ...card, display: 'flex', gap: 24 }}>
        <span style={mono}>DATA SOURCES</span>
        <StatusDot label="Strava"       active={connected.strava}       />
        <StatusDot label="Apple Health" active={connected.appleHealth}  />
      </div>

      {/* ── Latest insight ── */}
      {insight && (
        <div style={card}>
          <div style={{ ...mono, marginBottom: 8 }}>WEEKLY INSIGHT · {fmtDate(insight.week_start + 'T00:00:00')}</div>
          <p style={{ margin: '0 0 12px', lineHeight: 1.6 }}>{insight.summary}</p>
          {insight.insights?.list?.map((s, i) => (
            <div key={i} style={{ ...mono, marginBottom: 4, color: 'var(--ink-2)' }}>→ {s}</div>
          ))}
          {insight.highlights && (
            <div style={{ display: 'flex', gap: 24, marginTop: 12, flexWrap: 'wrap' }}>
              <Stat label="Distance"   value={fmtKm(insight.highlights.totalKm * 1000)} />
              <Stat label="Active days" value={insight.highlights.activeDays} />
              <Stat label="Avg steps"  value={insight.highlights.avgSteps?.toLocaleString()} />
              <Stat label="Avg sleep"  value={insight.highlights.avgSleep + 'h'} />
              <Stat label="Avg HRV"    value={insight.highlights.avgHRV + ' ms'} />
            </div>
          )}
        </div>
      )}

      {/* ── Goals ── */}
      {goals.length > 0 && (
        <div style={card}>
          <div style={{ ...mono, marginBottom: 12 }}>ACTIVE GOALS</div>
          {goals.map(g => (
            <div key={g.id} style={{ marginBottom: 8, display: 'flex', justifyContent: 'space-between' }}>
              <span>{g.title}</span>
              <span style={mono}>{g.target_value} {g.unit}{g.target_date ? ` · by ${fmtDate(g.target_date + 'T00:00:00')}` : ''}</span>
            </div>
          ))}
        </div>
      )}

      {/* ── This week's plan ── */}
      {plan && (
        <div style={card}>
          <div style={{ ...mono, marginBottom: 12 }}>TRAINING PLAN · WEEK OF {fmtDate(plan.week_start + 'T00:00:00')}</div>
          {Object.entries(plan.plan).map(([day, details]) => (
            <div key={day} style={{ display: 'flex', gap: 12, marginBottom: 8, alignItems: 'baseline' }}>
              <span style={{ ...mono, width: 80, textTransform: 'uppercase' }}>{day.slice(0, 3)}</span>
              <span style={{ ...mono, width: 70, color: 'var(--ink-2)', textTransform: 'uppercase' }}>{details.type}</span>
              <span style={{ ...mono, width: 55 }}>{details.durationMins > 0 ? details.durationMins + ' min' : 'REST'}</span>
              <span style={{ color: 'var(--ink-2)', fontSize: 13 }}>{details.notes}</span>
            </div>
          ))}
        </div>
      )}

      {/* ── Recent activities ── */}
      <div style={card}>
        <div style={{ ...mono, marginBottom: 12 }}>
          RECENT ACTIVITIES ({activities.length})
          {!connected.strava && <span style={{ marginLeft: 8, color: 'var(--bad)' }}>· Strava not connected</span>}
        </div>
        {activities.length === 0 ? (
          <div style={mono}>No activities yet — connect Strava or send data from Apple Health.</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={mono}>
                {['Date', 'Type', 'Name', 'Distance', 'Duration', 'Avg HR', 'Cals', 'Source'].map(h => (
                  <th key={h} style={{ textAlign: 'left', padding: '4px 8px 8px 0', fontWeight: 500 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {activities.map(a => (
                <tr key={a.id} style={{ borderTop: '1px solid var(--line)' }}>
                  <td style={{ ...mono, padding: '6px 8px 6px 0' }}>{fmtDate(a.started_at)}</td>
                  <td style={{ ...mono, padding: '6px 8px 6px 0', textTransform: 'uppercase' }}>{a.type}</td>
                  <td style={{ padding: '6px 8px 6px 0', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.name || '—'}</td>
                  <td style={{ ...mono, padding: '6px 8px 6px 0' }}>{fmtKm(a.distance_m)}</td>
                  <td style={{ ...mono, padding: '6px 8px 6px 0' }}>{fmtMin(a.duration_secs)}</td>
                  <td style={{ ...mono, padding: '6px 8px 6px 0' }}>{a.avg_hr ? a.avg_hr + ' bpm' : '—'}</td>
                  <td style={{ ...mono, padding: '6px 8px 6px 0' }}>{a.calories ?? '—'}</td>
                  <td style={{ ...mono, padding: '6px 8px 6px 0' }}>{a.source}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Daily metrics ── */}
      <div style={card}>
        <div style={{ ...mono, marginBottom: 12 }}>
          DAILY HEALTH METRICS ({metrics.length} days)
          {!connected.appleHealth && <span style={{ marginLeft: 8, color: 'var(--bad)' }}>· Apple Health not connected</span>}
        </div>
        {metrics.length === 0 ? (
          <div style={mono}>
            No metrics yet — set up the iOS Shortcut to POST to the health webhook.<br />
            <code style={{ fontSize: 11, opacity: .7 }}>node agents/fitness/health-webhook.js</code>
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={mono}>
                {['Date', 'Steps', 'Exercise', 'Active cal', 'Resting HR', 'HRV', 'Sleep', 'VO₂ max'].map(h => (
                  <th key={h} style={{ textAlign: 'left', padding: '4px 8px 8px 0', fontWeight: 500 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {metrics.map(m => (
                <tr key={m.date} style={{ borderTop: '1px solid var(--line)' }}>
                  <td style={{ ...mono, padding: '6px 8px 6px 0' }}>{fmtDate(m.date + 'T00:00:00')}</td>
                  <td style={{ ...mono, padding: '6px 8px 6px 0' }}>{m.steps?.toLocaleString() ?? '—'}</td>
                  <td style={{ ...mono, padding: '6px 8px 6px 0' }}>{m.exercise_mins ? m.exercise_mins + ' min' : '—'}</td>
                  <td style={{ ...mono, padding: '6px 8px 6px 0' }}>{m.active_cals ?? '—'}</td>
                  <td style={{ ...mono, padding: '6px 8px 6px 0' }}>{m.resting_hr ? m.resting_hr + ' bpm' : '—'}</td>
                  <td style={{ ...mono, padding: '6px 8px 6px 0' }}>{m.hrv ? m.hrv + ' ms' : '—'}</td>
                  <td style={{ ...mono, padding: '6px 8px 6px 0' }}>{m.sleep_hrs ? m.sleep_hrs + 'h' : '—'}</td>
                  <td style={{ ...mono, padding: '6px 8px 6px 0' }}>{m.vo2_max ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

    </div>
  )
}

function StatusDot({ label, active }) {
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'var(--mono)', fontSize: 11 }}>
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: active ? 'var(--good, #4ade80)' : 'var(--ink-3)' }} />
      {label}
    </span>
  )
}

function Stat({ label, value }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--ink-3)' }}>{label}</div>
      <div style={{ fontFamily: 'var(--mono)', fontSize: 14, marginTop: 2 }}>{value ?? '—'}</div>
    </div>
  )
}
