import { useState, useEffect, useRef, useMemo } from 'react'

function useWidth() {
  const ref = useRef(null)
  const [w, setW] = useState(560)
  useEffect(() => {
    if (!ref.current) return
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, e.contentRect.width)))
    ro.observe(ref.current)
    return () => ro.disconnect()
  }, [])
  return [ref, w]
}

export function BarChart({ data, label }) {
  const [ref, w] = useWidth()
  const h = 200
  const padL = 28, padR = 8, padT = 14, padB = 24
  const innerW = w - padL - padR
  const innerH = h - padT - padB
  const maxV = Math.max(4, ...data.map(d => d.v))
  const bw = innerW / data.length
  const ticks = useMemo(() => {
    const t = []; const step = Math.ceil(maxV / 3)
    for (let i = 0; i <= 3; i++) t.push(i * step)
    return t
  }, [maxV])

  return (
    <div ref={ref} className="chart-wrap" style={{ minWidth: 0 }}>
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
        {ticks.map((t, i) => {
          const y = padT + innerH - (t / Math.max(1, ticks[ticks.length - 1])) * innerH
          return (
            <g key={i}>
              <line x1={padL} x2={w - padR} y1={y} y2={y} stroke="var(--line)" strokeDasharray={i === 0 ? '' : '2 4'} />
              <text x={padL - 6} y={y + 3} textAnchor="end" fontSize="9" fontFamily="var(--mono)" fill="var(--ink-3)">{t}</text>
            </g>
          )
        })}
        {data.map((d, i) => {
          const bh = (d.v / Math.max(1, ticks[ticks.length - 1])) * innerH
          const x = padL + i * bw + bw * 0.18
          const bWidth = bw * 0.64
          const y = padT + innerH - bh
          return (
            <g key={d.k}>
              <rect x={x} y={padT + innerH} width={bWidth} height={0} rx="3"
                fill={d.isToday ? 'var(--ink)' : 'var(--work)'} opacity={d.isToday ? 1 : 0.85}>
                <animate attributeName="y" from={padT + innerH} to={y} dur="0.6s" begin={`${i * 0.03}s`} fill="freeze" calcMode="spline" keySplines="0.2 0.7 0.2 1" />
                <animate attributeName="height" from="0" to={bh} dur="0.6s" begin={`${i * 0.03}s`} fill="freeze" calcMode="spline" keySplines="0.2 0.7 0.2 1" />
              </rect>
              {(data.length <= 12 || i % Math.ceil(data.length / 8) === 0) && (
                <text x={x + bWidth / 2} y={h - 8} textAnchor="middle" fontSize="9.5" fontFamily="var(--mono)" fill="var(--ink-3)">{d.label}</text>
              )}
            </g>
          )
        })}
      </svg>
      {label && <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--ink-3)', textAlign: 'right', marginTop: 4, letterSpacing: '.04em' }}>{label}</div>}
    </div>
  )
}

export function LineChart({ data }) {
  const [ref, w] = useWidth()
  const h = 240
  const padL = 30, padR = 12, padT = 18, padB = 26
  const innerW = w - padL - padR
  const innerH = h - padT - padB
  const maxV = Math.max(20, ...data.map(d => Math.max(d.work, d.personal))) * 1.1
  const [hi, setHi] = useState(null)

  const xAt = (i) => padL + (i / (data.length - 1)) * innerW
  const yAt = (v) => padT + innerH - (v / maxV) * innerH
  const buildPath = (key) => data.map((d, i) => `${i === 0 ? 'M' : 'L'} ${xAt(i).toFixed(2)} ${yAt(d[key]).toFixed(2)}`).join(' ')
  const buildArea = (key) => {
    const top = data.map((d, i) => `${i === 0 ? 'M' : 'L'} ${xAt(i).toFixed(2)} ${yAt(d[key]).toFixed(2)}`).join(' ')
    return `${top} L ${xAt(data.length - 1)} ${padT + innerH} L ${xAt(0)} ${padT + innerH} Z`
  }
  const ticks = [0, Math.round(maxV / 2), Math.round(maxV)]

  const onMove = (e) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const px = (e.clientX - rect.left) * (w / rect.width)
    const idx = Math.max(0, Math.min(data.length - 1, Math.round(((px - padL) / innerW) * (data.length - 1))))
    setHi(idx)
  }

  return (
    <div ref={ref} className="chart-wrap">
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none"
        onMouseMove={onMove} onMouseLeave={() => setHi(null)} style={{ cursor: 'crosshair' }}>
        <defs>
          <linearGradient id="workG" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="var(--work)" stopOpacity=".22" />
            <stop offset="100%" stopColor="var(--work)" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="persG" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="var(--personal)" stopOpacity=".22" />
            <stop offset="100%" stopColor="var(--personal)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {ticks.map((t, i) => {
          const y = yAt(t)
          return (
            <g key={i}>
              <line x1={padL} x2={w - padR} y1={y} y2={y} stroke="var(--line)" strokeDasharray={i === 0 ? '' : '2 4'} />
              <text x={padL - 8} y={y + 3} textAnchor="end" fontSize="9.5" fontFamily="var(--mono)" fill="var(--ink-3)">{t}</text>
            </g>
          )
        })}
        <path d={buildArea('work')} fill="url(#workG)" />
        <path d={buildArea('personal')} fill="url(#persG)" />
        <path d={buildPath('work')} fill="none" stroke="var(--work)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          pathLength="1" style={{ strokeDasharray: '1 1', animation: 'draw 1.1s cubic-bezier(.2,.7,.2,1) forwards' }} />
        <path d={buildPath('personal')} fill="none" stroke="var(--personal)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          pathLength="1" style={{ strokeDasharray: '1 1', animation: 'draw 1.1s .15s cubic-bezier(.2,.7,.2,1) forwards' }} />
        {data.map((d, i) => (
          <text key={i} x={xAt(i)} y={h - 8} textAnchor="middle" fontSize="9.5" fontFamily="var(--mono)" fill="var(--ink-3)">
            {d.month.toUpperCase()}
          </text>
        ))}
        {hi !== null && (
          <g>
            <line x1={xAt(hi)} x2={xAt(hi)} y1={padT} y2={padT + innerH} stroke="var(--ink-3)" strokeDasharray="2 3" opacity=".5" />
            <circle cx={xAt(hi)} cy={yAt(data[hi].work)} r="4" fill="var(--bg)" stroke="var(--work)" strokeWidth="2" />
            <circle cx={xAt(hi)} cy={yAt(data[hi].personal)} r="4" fill="var(--bg)" stroke="var(--personal)" strokeWidth="2" />
          </g>
        )}
        <style>{`@keyframes draw { to { stroke-dasharray: 1 0; } }`}</style>
      </svg>
      {hi !== null && (
        <div style={{ position: 'absolute', top: 6, right: 10, fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--ink-2)', background: 'var(--bg)', border: '1px solid var(--line)', padding: '6px 10px', borderRadius: 8, display: 'flex', gap: 10, alignItems: 'center' }}>
          <span style={{ color: 'var(--ink)' }}>{data[hi].month} {data[hi].year}</span>
          <span style={{ color: 'oklch(0.45 0.13 235)' }}>W {data[hi].work}</span>
          <span style={{ color: 'oklch(0.5 0.13 55)' }}>P {data[hi].personal}</span>
        </div>
      )}
    </div>
  )
}

export function YearHeatmap({ daily }) {
  const wrapRef = useRef(null)
  const [hover, setHover] = useState(null)

  const { columns, monthLabels, levels, total, best } = useMemo(() => {
    const today = new Date(); today.setHours(0, 0, 0, 0)
    const todayDow = today.getDay()
    const arr = daily.slice(-371)
    const cells = []
    const totalSlots = 53 * 7
    const padFront = totalSlots - arr.length - (6 - todayDow)
    for (let i = 0; i < padFront; i++) cells.push(null)
    arr.forEach(p => cells.push(p))
    while (cells.length < totalSlots) cells.push(null)

    const counts = arr.map(d => d.count).filter(c => c > 0).sort((a, b) => a - b)
    const q = (p) => counts.length ? counts[Math.floor(counts.length * p)] || 1 : 1
    const t2 = q(0.4), t3 = q(0.7), t4 = q(0.9)
    const levelOf = (c) => c <= 0 ? 0 : c <= 1 ? 1 : c <= t2 ? 2 : c <= t3 ? 3 : 4

    const columns = []
    for (let c = 0; c < 53; c++) {
      const col = []
      for (let r = 0; r < 7; r++) col.push(cells[c * 7 + r])
      columns.push(col)
    }

    const monthLabels = []
    let lastMonth = -1
    columns.forEach((col, ci) => {
      const first = col.find(d => d)
      if (!first) return
      const m = new Date(first.date).getMonth()
      if (m !== lastMonth) {
        monthLabels.push({ col: ci + 1, label: new Date(first.date).toLocaleString('en', { month: 'short' }) })
        lastMonth = m
      }
    })

    const total = arr.reduce((a, b) => a + b.count, 0)
    const best = Math.max(0, ...arr.map(d => d.count))
    return { columns, monthLabels, levels: levelOf, total, best }
  }, [daily])

  const showTip = (e, day) => {
    if (!day || !wrapRef.current) return
    const wrapRect = wrapRef.current.getBoundingClientRect()
    const target = e.currentTarget.getBoundingClientRect()
    const x = target.left + target.width / 2 - wrapRect.left
    const y = target.top - wrapRect.top
    const dt = new Date(day.date)
    const label = `${day.count} ${day.count === 1 ? 'task' : 'tasks'} · ${dt.toLocaleDateString('en', { weekday: 'short', month: 'short', day: 'numeric' })}`
    setHover({ x, y, label })
  }

  const todayKey = (() => { const t = new Date(); t.setHours(0, 0, 0, 0); return t.toISOString().slice(0, 10) })()
  const dayLabels = ['', 'Mon', '', 'Wed', '', 'Fri', '']

  return (
    <div className="heatmap" ref={wrapRef}>
      <div className="heatmap-scroll">
        <div className="heatmap-grid">
          <div className="heatmap-rows">
            {dayLabels.map((d, i) => <span key={i}>{d}</span>)}
          </div>
          <div className="heatmap-cols">
            <div className="heatmap-months">
              {monthLabels.map((m, i) => (
                <span key={i} style={{ gridColumn: `${Math.max(1, m.col)} / span 4` }}>{m.label}</span>
              ))}
            </div>
            <div className="heatmap-cells">
              {columns.map((col, ci) => (
                <div className="heatmap-col" key={ci}>
                  {col.map((day, ri) => {
                    const lvl = day ? levels(day.count) : 0
                    const isToday = day && day.date === todayKey
                    return (
                      <div key={ri}
                        className={`hm-cell ${day ? 'l' + lvl : 'empty'} ${isToday ? 'today' : ''}`}
                        style={{ animationDelay: `${(ci * 7 + ri) * 1.2}ms` }}
                        onMouseEnter={(e) => showTip(e, day)}
                        onMouseLeave={() => setHover(null)}
                      />
                    )
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
      {hover && <div className="hm-tooltip show" style={{ left: hover.x, top: hover.y }}>{hover.label}</div>}
      <div className="heatmap-foot">
        <span>{total} tasks completed · best day {best}</span>
        <span className="heatmap-legend">
          LESS
          <span className="swatches">
            {[0, 1, 2, 3, 4].map(l => <span key={l} className={`sw hm-cell l${l}`} style={{ animation: 'none', opacity: 1 }} />)}
          </span>
          MORE
        </span>
      </div>
    </div>
  )
}
