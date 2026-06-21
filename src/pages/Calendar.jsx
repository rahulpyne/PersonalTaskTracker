import { useState, useEffect, useMemo, useCallback } from 'react'
import { fetchCalendarEvents, fetchLatestPlan, fetchTaskBlocks, approveBlock, approveAllProposed,
         completeBlock, rescheduleBlock, removeBlock, createBlock } from '../lib/calendar'

const DAY_MS = 86_400_000
const DAYS   = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const PLAN_KEYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']

// Source → colour
const SRC = {
  google:   { bg: 'rgba(66,133,244,0.14)',  bar: '#4285f4', label: 'Google' },
  calendly: { bg: 'rgba(120,99,230,0.16)',  bar: '#7863e6', label: 'Calendly' },
  fitness:  { bg: 'rgba(240,140,40,0.16)',  bar: 'oklch(72% 0.18 50)', label: 'Fitness plan' },
}

function mondayOf(d) {
  const x = new Date(d); x.setHours(0, 0, 0, 0)
  const dow = x.getDay() === 0 ? 6 : x.getDay() - 1
  x.setDate(x.getDate() - dow)
  return x
}
const sameDay = (a, b) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
const minsInto = (d) => d.getHours() * 60 + d.getMinutes()
const fmtHour  = (h) => `${((h + 11) % 12) + 1}${h < 12 ? 'a' : 'p'}`
const fmtTime  = (d) => d.toLocaleTimeString('en', { hour: 'numeric', minute: '2-digit' })

export default function Calendar() {
  const [weekStart, setWeekStart] = useState(() => mondayOf(new Date()))
  const [events,    setEvents]    = useState([])
  const [blocks,    setBlocks]    = useState([])
  const [plan,      setPlan]      = useState(null)
  const [loading,   setLoading]   = useState(true)
  const [error,     setError]     = useState(null)

  const weekDates = useMemo(
    () => Array.from({ length: 7 }, (_, i) => new Date(weekStart.getTime() + i * DAY_MS)),
    [weekStart]
  )

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    const from = weekStart.toISOString()
    const to   = new Date(weekStart.getTime() + 7 * DAY_MS).toISOString()
    // Independent — a missing table shouldn't hide the others
    const [evsRes, planRes, blkRes] = await Promise.allSettled([
      fetchCalendarEvents(from, to),
      fetchLatestPlan(),
      fetchTaskBlocks(from, to),
    ])
    if (evsRes.status === 'fulfilled') setEvents(evsRes.value)
    else { setEvents([]); setError(evsRes.reason?.message || 'calendar fetch failed') }
    setPlan(planRes.status === 'fulfilled' ? planRes.value : null)
    setBlocks(blkRes.status === 'fulfilled' ? blkRes.value : [])
    setLoading(false)
  }, [weekStart])

  const onApprove = useCallback(async (id) => {
    setBlocks(bs => bs.map(b => b.id === id ? { ...b, status: 'approved' } : b))
    try { await approveBlock(id) } catch { load() }
  }, [load])

  const onApproveAll = useCallback(async () => {
    setBlocks(bs => bs.map(b => b.status === 'proposed' ? { ...b, status: 'approved' } : b))
    try { await approveAllProposed() } catch { load() }
  }, [load])

  const [editing, setEditing] = useState(null)   // block being edited, or { add: true }

  const onComplete = useCallback(async (block) => {
    setEditing(null)
    setBlocks(bs => bs.map(b => b.id === block.id ? { ...b, status: 'done' } : b))
    try { await completeBlock(block) } catch (e) { alert('Could not complete: ' + e.message); load() }
  }, [load])

  const onDelete = useCallback(async (block) => {
    setEditing(null)
    setBlocks(bs => bs.filter(b => b.id !== block.id))
    try { await removeBlock(block) } catch (e) { alert('Could not delete: ' + e.message); load() }
  }, [load])

  const onSaveEdit = useCallback(async (block, { title, category, startISO, endISO }) => {
    setEditing(null)
    if (block) { try { await rescheduleBlock(block, startISO, endISO) } catch (e) { alert(e.message) } }
    else       { try { await createBlock({ title, category, startISO, endISO }) } catch (e) { alert(e.message) } }
    load()
  }, [load])

  useEffect(() => { load() }, [load])

  // Split timed vs all-day, parse dates once
  const parsed = useMemo(() => events.map(e => ({
    ...e, _start: new Date(e.start_at), _end: new Date(e.end_at),
  })), [events])

  const timed  = parsed.filter(e => !e.all_day)
  const allDay = parsed.filter(e => e.all_day)

  const parsedBlocks = useMemo(() => blocks.map(b => ({
    ...b, _start: new Date(b.start_at), _end: new Date(b.end_at),
  })), [blocks])

  const proposedCount = blocks.filter(b => b.status === 'proposed').length

  // Hour window: fit to events + blocks, clamped to a sensible default
  const [hStart, hEnd] = useMemo(() => {
    let lo = 7, hi = 21
    for (const e of [...timed, ...parsedBlocks]) {
      lo = Math.min(lo, e._start.getHours())
      hi = Math.max(hi, e._end.getHours() + (e._end.getMinutes() > 0 ? 1 : 0))
    }
    return [Math.max(0, Math.min(lo, 7)), Math.min(24, Math.max(hi, 21))]
  }, [timed, parsedBlocks])

  const hours = Array.from({ length: hEnd - hStart }, (_, i) => hStart + i)
  const ROW_H = 52
  const gridH = hours.length * ROW_H

  const planFor = (i) => {
    const raw = plan?.plan?.[PLAN_KEYS[i]]
    if (!raw || raw.type === 'rest') return null
    return raw
  }

  const today = new Date()
  const _a = weekDates[0], _b = weekDates[6]
  const _mo = (d) => d.toLocaleDateString('en', { month: 'long' })
  const monthLabel = _a.getMonth() === _b.getMonth()
    ? `${_mo(_a)} ${_a.getDate()} – ${_b.getDate()}, ${_b.getFullYear()}`
    : `${_mo(_a)} ${_a.getDate()} – ${_mo(_b)} ${_b.getDate()}, ${_b.getFullYear()}`

  return (
    <div style={{ padding: '0 0 80px' }}>
      {/* ── Header / controls ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 18 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 26, letterSpacing: '-0.02em' }}>Calendar</h1>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--ink-3)', marginTop: 4 }}>{monthLabel}</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {proposedCount > 0 && (
            <button onClick={onApproveAll} style={{
              fontFamily: 'var(--mono)', fontSize: 12, padding: '6px 12px', borderRadius: 8,
              border: '1px solid var(--good)', background: 'color-mix(in oklch, var(--good) 14%, transparent)',
              color: 'var(--ink)', cursor: 'pointer', fontWeight: 600,
            }}>✓ Approve {proposedCount} block{proposedCount !== 1 ? 's' : ''}</button>
          )}
          <NavBtn onClick={() => setEditing({ add: true })}>+ Add block</NavBtn>
          <NavBtn onClick={() => setWeekStart(d => new Date(d.getTime() - 7 * DAY_MS))}>‹</NavBtn>
          <NavBtn onClick={() => setWeekStart(mondayOf(new Date()))}>Today</NavBtn>
          <NavBtn onClick={() => setWeekStart(d => new Date(d.getTime() + 7 * DAY_MS))}>›</NavBtn>
        </div>
      </div>

      {editing && (
        <BlockModal
          block={editing.add ? null : editing}
          defaultDate={weekDates[0]}
          onClose={() => setEditing(null)}
          onSave={onSaveEdit}
          onComplete={onComplete}
          onDelete={onDelete}
        />
      )}

      {/* ── Legend ── */}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 14, fontFamily: 'var(--mono)', fontSize: 10.5, color: 'var(--ink-3)' }}>
        {Object.values(SRC).map(s => (
          <span key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: s.bar }} /> {s.label}
          </span>
        ))}
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 10, height: 10, borderRadius: 3, border: '1px dashed var(--ink-3)' }} /> Task block (▸ = auto-scheduled)
        </span>
      </div>

      {error && (/calendar_events|schema cache/i.test(error)
        ? <Banner>Calendar not set up yet — create the <code>calendar_events</code> table and run the sync (see setup). Your fitness plan still shows below.</Banner>
        : <Banner>Couldn't load calendar — {error}</Banner>)}
      {!error && !loading && events.length === 0 && (
        <Banner>No synced events yet. Connect Google Calendar &amp; Calendly, then run the calendar sync. Your fitness plan is shown below regardless.</Banner>
      )}

      {/* ── Day headers ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '48px repeat(7, 1fr)', borderBottom: '1px solid var(--line)' }}>
        <div />
        {weekDates.map((d, i) => {
          const isToday = sameDay(d, today)
          return (
            <div key={i} style={{ textAlign: 'center', padding: '6px 2px 8px' }}>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--ink-3)', letterSpacing: '.08em' }}>{DAYS[i]}</div>
              <div style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                width: 26, height: 26, marginTop: 3, borderRadius: '50%', fontSize: 13,
                background: isToday ? 'var(--ink)' : 'transparent',
                color: isToday ? 'var(--bg)' : 'var(--ink-2)', fontWeight: isToday ? 600 : 400,
              }}>{d.getDate()}</div>
            </div>
          )
        })}
      </div>

      {/* ── All-day + planned fitness row ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '48px repeat(7, 1fr)', borderBottom: '1px solid var(--line)', minHeight: 34 }}>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 8.5, color: 'var(--ink-3)', padding: '6px 4px', textAlign: 'right' }}>all-day</div>
        {weekDates.map((d, i) => {
          const dayAllDay = allDay.filter(e => e._start <= new Date(d.getTime() + DAY_MS) && e._end > d)
          const p = planFor(i)
          return (
            <div key={i} style={{ borderLeft: '1px solid var(--line)', padding: 3, display: 'flex', flexDirection: 'column', gap: 3 }}>
              {dayAllDay.map(e => <Chip key={e.id} src={SRC[e.source] || SRC.google} title={e.title} />)}
              {p && <Chip src={SRC.fitness} title={`${cap(p.type)}${p.durationMins ? ` · ${p.durationMins}m` : ''}`} planned />}
            </div>
          )
        })}
      </div>

      {/* ── Time grid ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '48px repeat(7, 1fr)', position: 'relative' }}>
        {/* Hour labels */}
        <div style={{ position: 'relative', height: gridH }}>
          {hours.map((h, i) => (
            <div key={h} style={{ position: 'absolute', top: i * ROW_H - 6, right: 6, fontFamily: 'var(--mono)', fontSize: 9.5, color: 'var(--ink-3)' }}>{fmtHour(h)}</div>
          ))}
        </div>

        {/* Day columns */}
        {weekDates.map((d, di) => {
          const dayEvents = layoutDay(timed.filter(e => sameDay(e._start, d)))
          const isToday = sameDay(d, today)
          const nowTop = isToday ? ((minsInto(today) - hStart * 60) / ((hEnd - hStart) * 60)) * gridH : null
          return (
            <div key={di} style={{ position: 'relative', height: gridH, borderLeft: '1px solid var(--line)' }}>
              {/* hour lines */}
              {hours.map((h, i) => (
                <div key={h} style={{ position: 'absolute', top: i * ROW_H, left: 0, right: 0, borderTop: '1px solid var(--line)', opacity: 0.5 }} />
              ))}
              {/* now indicator */}
              {nowTop != null && nowTop >= 0 && nowTop <= gridH && (
                <div style={{ position: 'absolute', top: nowTop, left: 0, right: 0, height: 0, borderTop: '2px solid var(--bad)', zIndex: 3 }}>
                  <span style={{ position: 'absolute', left: 0, top: -3, width: 6, height: 6, borderRadius: '50%', background: 'var(--bad)' }} />
                </div>
              )}
              {/* events */}
              {dayEvents.map(e => {
                const top = ((minsInto(e._start) - hStart * 60) / ((hEnd - hStart) * 60)) * gridH
                const h   = Math.max(18, ((e._end - e._start) / 60000 / ((hEnd - hStart) * 60)) * gridH)
                const s   = SRC[e.source] || SRC.google
                return (
                  <div key={e.id} title={`${e.title} · ${fmtTime(e._start)}–${fmtTime(e._end)}${e.location ? ` · ${e.location}` : ''}`}
                    style={{
                      position: 'absolute', top, height: h - 2,
                      left: `calc(${(e._col / e._cols) * 100}% + 2px)`,
                      width: `calc(${100 / e._cols}% - 4px)`,
                      background: s.bg, borderLeft: `2.5px solid ${s.bar}`, borderRadius: 5,
                      padding: '2px 5px', overflow: 'hidden', zIndex: 2, fontSize: 11, lineHeight: 1.25,
                    }}>
                    <div style={{ fontWeight: 600, color: 'var(--ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.title || '(busy)'}</div>
                    {h > 30 && <div style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--ink-3)' }}>{fmtTime(e._start)}</div>}
                  </div>
                )
              })}
              {/* auto-scheduled task blocks */}
              {parsedBlocks.filter(b => sameDay(b._start, d)).map(b => {
                const top = ((minsInto(b._start) - hStart * 60) / ((hEnd - hStart) * 60)) * gridH
                const h   = Math.max(18, ((b._end - b._start) / 60000 / ((hEnd - hStart) * 60)) * gridH)
                const col = b.category === 'work' ? 'oklch(58% 0.13 250)' : 'oklch(62% 0.13 160)'
                const isProposed = b.status === 'proposed'
                const isDone = b.status === 'done'
                return (
                  <div key={b.id} title={`${b.title} · ${fmtTime(b._start)}–${fmtTime(b._end)} · ${b.status} · click to edit`}
                    onClick={() => setEditing(b)}
                    style={{
                      position: 'absolute', top, height: h - 2, right: 2, left: '38%',
                      background: `color-mix(in oklch, ${col} ${isDone ? 6 : 14}%, transparent)`,
                      border: `1px ${isProposed ? 'dashed' : 'solid'} ${col}`, borderRadius: 5, opacity: isDone ? 0.6 : 1,
                      padding: '2px 5px', overflow: 'hidden', zIndex: 2, fontSize: 10.5, lineHeight: 1.2, cursor: 'pointer',
                    }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                      <span style={{ fontWeight: 600, color: 'var(--ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1, textDecoration: isDone ? 'line-through' : 'none' }}>{isDone ? '✓' : '▸'} {b.title}</span>
                      {isProposed && (
                        <button onClick={(ev) => { ev.stopPropagation(); onApprove(b.id) }} title="Approve → add to Google Calendar"
                          style={{ border: 0, background: col, color: '#fff', borderRadius: 4, fontSize: 9, lineHeight: 1, padding: '2px 4px', cursor: 'pointer', flexShrink: 0 }}>✓</button>
                      )}
                    </div>
                    {h > 28 && <div style={{ fontFamily: 'var(--mono)', fontSize: 8.5, color: 'var(--ink-3)' }}>{isDone ? 'done' : isProposed ? 'proposed' : b.status === 'approved' ? 'approved' : 'scheduled'}</div>}
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// Greedy column layout for overlapping events within one day
function layoutDay(evs) {
  const sorted = [...evs].sort((a, b) => a._start - b._start || b._end - a._end)
  const cols = [] // array of last-end-time per column
  for (const e of sorted) {
    let placed = false
    for (let c = 0; c < cols.length; c++) {
      if (e._start >= cols[c]) { e._col = c; cols[c] = e._end; placed = true; break }
    }
    if (!placed) { e._col = cols.length; cols.push(e._end) }
  }
  // Resolve total columns per cluster (simple: use max across the day)
  const total = Math.max(1, cols.length)
  for (const e of sorted) e._cols = total
  return sorted
}

const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s)

function Chip({ src, title, planned }) {
  return (
    <div style={{
      background: src.bg, borderLeft: `2px solid ${src.bar}`, borderRadius: 4,
      padding: '2px 5px', fontSize: 10, color: 'var(--ink)', whiteSpace: 'nowrap',
      overflow: 'hidden', textOverflow: 'ellipsis', fontStyle: planned ? 'italic' : 'normal',
    }} title={title}>{planned ? '◇ ' : ''}{title}</div>
  )
}

function NavBtn({ children, onClick }) {
  return (
    <button onClick={onClick} style={{
      fontFamily: 'var(--mono)', fontSize: 12, padding: '6px 12px', borderRadius: 8,
      border: '1px solid var(--line)', background: 'transparent', color: 'var(--ink-2)', cursor: 'pointer',
    }}>{children}</button>
  )
}

function Banner({ children }) {
  return (
    <div style={{
      background: 'var(--bg-2)', border: '1px solid var(--line)', borderRadius: 10,
      padding: '10px 14px', marginBottom: 14, fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.5,
    }}>{children}</div>
  )
}

// Add (block=null) or edit an existing block. Local time in/out.
function BlockModal({ block, defaultDate, onClose, onSave, onComplete, onDelete }) {
  const init = block ? new Date(block.start_at) : (defaultDate ? new Date(defaultDate) : new Date())
  if (!block) init.setHours(9, 0, 0, 0)
  const initDur = block
    ? Math.round((new Date(block.end_at) - new Date(block.start_at)) / 60000)
    : 30
  const pad = (n) => String(n).padStart(2, '0')

  const [title, setTitle]       = useState(block?.title || '')
  const [category, setCategory] = useState(block?.category || 'personal')
  const [date, setDate]         = useState(`${init.getFullYear()}-${pad(init.getMonth() + 1)}-${pad(init.getDate())}`)
  const [time, setTime]         = useState(`${pad(init.getHours())}:${pad(init.getMinutes())}`)
  const [dur, setDur]           = useState(initDur)
  const isDone = block?.status === 'done'

  const submit = () => {
    if (!title.trim()) return
    const [y, m, d] = date.split('-').map(Number)
    const [hh, mm]  = time.split(':').map(Number)
    const start = new Date(y, m - 1, d, hh, mm, 0, 0)
    const end   = new Date(start.getTime() + dur * 60000)
    onSave(block, { title: title.trim(), category, startISO: start.toISOString(), endISO: end.toISOString() })
  }

  const field = { width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--line)', background: 'var(--bg)', color: 'var(--ink)', fontSize: 13, fontFamily: 'inherit' }
  const label = { fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--ink-3)', letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: 4, display: 'block' }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: 14, padding: 22, width: 380, maxWidth: '90vw', boxShadow: '0 20px 60px rgba(0,0,0,0.25)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>{block ? 'Edit block' : 'Add block'}</h2>
          <button onClick={onClose} style={{ border: 0, background: 'transparent', fontSize: 20, color: 'var(--ink-3)', cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>

        <div style={{ marginBottom: 12 }}>
          <label style={label}>Title</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What is this block for?" style={field} autoFocus={!block} />
        </div>
        <div style={{ marginBottom: 12 }}>
          <label style={label}>Category</label>
          <div style={{ display: 'flex', gap: 8 }}>
            {['work', 'personal'].map(c => (
              <button key={c} onClick={() => setCategory(c)} style={{
                flex: 1, padding: '7px', borderRadius: 8, cursor: 'pointer', fontSize: 12, textTransform: 'capitalize',
                border: `1px solid ${category === c ? 'var(--ink)' : 'var(--line)'}`,
                background: category === c ? 'var(--ink)' : 'transparent', color: category === c ? 'var(--bg)' : 'var(--ink-2)',
              }}>{c}</button>
            ))}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, marginBottom: 18 }}>
          <div style={{ flex: 1.4 }}><label style={label}>Date</label><input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={field} /></div>
          <div style={{ flex: 1 }}><label style={label}>Start</label><input type="time" value={time} onChange={(e) => setTime(e.target.value)} style={field} /></div>
          <div style={{ flex: 0.9 }}><label style={label}>Mins</label><input type="number" min="5" step="5" value={dur} onChange={(e) => setDur(+e.target.value)} style={field} /></div>
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {block && !isDone && (
            <button onClick={() => onComplete(block)} style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid var(--good)', background: 'color-mix(in oklch, var(--good) 14%, transparent)', color: 'var(--ink)', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>✓ Done</button>
          )}
          {block && (
            <button onClick={() => onDelete(block)} style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid var(--bad)', background: 'transparent', color: 'var(--bad)', cursor: 'pointer', fontSize: 12 }}>Delete</button>
          )}
          <div style={{ flex: 1 }} />
          <button onClick={submit} style={{ padding: '8px 16px', borderRadius: 8, border: 0, background: 'var(--ink)', color: 'var(--bg)', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>{block ? 'Save' : 'Add'}</button>
        </div>
      </div>
    </div>
  )
}
