import { useState, useMemo } from 'react'
import { BarChart, LineChart, YearHeatmap } from './Charts'
import { Flame } from './Icons'
import { computeStreak } from '../lib/history'

function SplitBar({ tasks }) {
  const w = tasks.filter(t => t.cat === 'work').length
  const p = tasks.filter(t => t.cat === 'personal').length
  const total = Math.max(1, w + p)
  const wPct  = Math.round(w / total * 100)
  const pPct  = 100 - wPct
  return (
    <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 14, flex: 1 }}>
      <div style={{ display: 'flex', height: 48, borderRadius: 10, overflow: 'hidden', border: '1px solid var(--line)' }}>
        <div style={{ width: `${wPct}%`, background: 'var(--work)', transition: 'width .6s cubic-bezier(.2,.7,.2,1)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontFamily: 'var(--mono)', fontSize: 11 }}>
          {wPct > 14 && `${wPct}%`}
        </div>
        <div style={{ width: `${pPct}%`, background: 'var(--personal)', transition: 'width .6s cubic-bezier(.2,.7,.2,1)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontFamily: 'var(--mono)', fontSize: 11 }}>
          {pPct > 14 && `${pPct}%`}
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--ink-2)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: 'var(--work)', marginRight: 6, verticalAlign: '1px' }} />Work</span>
          <span>{w}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: 'var(--personal)', marginRight: 6, verticalAlign: '1px' }} />Personal</span>
          <span>{p}</span>
        </div>
      </div>
    </div>
  )
}

export default function Insights({ tasks, history }) {
  const [range, setRange]           = useState('week')
  const [streakOpen, setStreakOpen] = useState(false)

  const streak = useMemo(() => computeStreak(history.daily), [history])

  const barData = useMemo(() => {
    const d = history.daily
    if (range === 'day') {
      return d.slice(-14).map((p, i, arr) => {
        const isToday = i === arr.length - 1
        return { k: p.date, label: new Date(p.date).toLocaleDateString('en', { weekday: 'short' })[0] + (isToday ? '·' : ''), v: p.count, isToday }
      })
    }
    if (range === 'week') {
      const arr = d.slice(-56)
      return Array.from({ length: 8 }, (_, i) => {
        const slice = arr.slice(i * 7, (i + 1) * 7)
        const sum = slice.reduce((a, b) => a + b.count, 0)
        return { k: 'w' + i, label: i === 7 ? 'this' : String(i - 7), v: sum, isToday: i === 7 }
      })
    }
    const months = {}
    d.forEach(p => {
      const dt = new Date(p.date)
      const key = dt.getFullYear() + '-' + (dt.getMonth() + 1)
      months[key] = (months[key] || 0) + p.count
    })
    const keys = Object.keys(months).slice(-6)
    return keys.map((k, i) => {
      const [y, m] = k.split('-')
      const dt = new Date(parseInt(y), parseInt(m) - 1, 1)
      return { k, label: dt.toLocaleString('en', { month: 'short' }), v: months[k], isToday: i === keys.length - 1 }
    })
  }, [range, history])

  const streakDots = history.daily.slice(-14).map((p, i, arr) => ({
    on: p.count > 0, today: i === arr.length - 1,
  }))

  const todayCount = history.daily[history.daily.length - 1]?.count ?? 0
  const weekCount  = history.daily.slice(-7).reduce((a, b) => a + b.count, 0)
  const pendingCount = tasks.filter(t => !t.done).length
  const doneCount    = tasks.filter(t => t.done).length
  const pct = Math.round(doneCount / Math.max(1, doneCount + pendingCount) * 100)

  return (
    <div className="insights">
      <div className="grid">
        {/* Streak card */}
        <div className={`card streak-card ${streakOpen ? 'open span-12' : 'span-5'}`}
          onClick={() => setStreakOpen(o => !o)} role="button" tabIndex={0}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setStreakOpen(o => !o) } }}>
          <div className="title">
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <Flame alive={streak > 0} size={12} /> Day streak
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontFamily: 'var(--sans)', textTransform: 'none', letterSpacing: 0, fontSize: 11 }}>
                {streakOpen ? 'last 12 months' : 'active 2 wks'}
              </span>
              <span className={`chev`} aria-hidden="true">
                <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
              </span>
            </span>
          </div>
          <div className="big">{streak}<span className="unit">days</span></div>
          <div className="small">Consecutive days with at least one task done. {streakOpen ? 'Each square = one day.' : 'Click to see the full year.'}</div>
          <div className="compact">
            <div className="streak-dots">
              {streakDots.map((dot, i) => (
                <div key={i} className={`streak-dot ${dot.on ? 'on' : ''} ${dot.today ? 'today' : ''}`} />
              ))}
            </div>
            <div className="streak-axis"><span>2 weeks ago</span><span>today</span></div>
          </div>
          <div className="expand">
            <div className="inner">
              {streakOpen && <YearHeatmap daily={history.daily} />}
            </div>
          </div>
        </div>

        {/* Snapshot */}
        <div className="card span-4">
          <div className="title"><span>Snapshot</span></div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginTop: 10 }}>
            {[
              { v: todayCount,   l: 'Done today' },
              { v: weekCount,    l: 'Done this week' },
              { v: pendingCount, l: 'Pending' },
              { v: `${pct}%`,   l: 'Inbox done' },
            ].map(({ v, l }) => (
              <div key={l}>
                <div style={{ fontFamily: 'var(--serif)', fontSize: 42, lineHeight: 1, letterSpacing: '-.02em' }}>{v}</div>
                <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '.14em', marginTop: 6 }}>{l}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Split */}
        <div className="card span-3">
          <div className="title"><span>Split</span></div>
          <SplitBar tasks={tasks} />
        </div>

        {/* Completion bar chart */}
        <div className="card span-7">
          <div className="title">
            <span>Completion</span>
            <div className="seg-tabs">
              {['day', 'week', 'month'].map(r => (
                <button key={r} className={range === r ? 'on' : ''} onClick={(e) => { e.stopPropagation(); setRange(r) }}>
                  {r.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
          <BarChart data={barData} label={range === 'day' ? 'last 14 days' : range === 'week' ? 'last 8 weeks' : 'last 6 months'} />
        </div>

        {/* 12-month line chart */}
        <div className="card span-5">
          <div className="title">
            <span>Work vs Personal — 12 months</span>
            <div className="legend">
              <span className="item"><span className="sw" style={{ background: 'var(--work)' }} />WORK</span>
              <span className="item"><span className="sw" style={{ background: 'var(--personal)' }} />PERSONAL</span>
            </div>
          </div>
          <LineChart data={history.monthly} />
        </div>
      </div>
    </div>
  )
}
