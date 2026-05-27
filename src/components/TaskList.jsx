import { useState, useEffect, useRef, useCallback } from 'react'
import { IconCheck, IconPencil, IconTrash, IconPlus } from './Icons'
import { fetchSubtasks, toggleSubtask, generateSubtasks } from '../lib/tasks'
import { subtaskToUI } from '../lib/adapter'

// ── Helpers ───────────────────────────────────────────────────────────────────

function prettyDate(ms) {
  if (!ms) return ''
  const d   = new Date(ms)
  const now = new Date(); now.setHours(0, 0, 0, 0)
  const yest = new Date(now); yest.setDate(yest.getDate() - 1)
  const dd  = new Date(d); dd.setHours(0, 0, 0, 0)
  if (dd.getTime() === now.getTime())  return 'today'
  if (dd.getTime() === yest.getTime()) return 'yesterday'
  const days = Math.round((now - dd) / 86_400_000)
  if (days < 7) return `${days}d ago`
  return d.toLocaleDateString('en', { month: 'short', day: 'numeric' })
}

// Parse 🔗 [Title](URL) markdown links from notes
function parseLinks(notes) {
  if (!notes) return []
  const md = [...notes.matchAll(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g)]
  if (md.length) return md.map(m => ({ title: m[1], url: m[2] }))
  const bare = [...notes.matchAll(/https?:\/\/[^\s,)>]+/g)]
  return bare.map(m => {
    try { return { title: new URL(m[0]).hostname.replace('www.', ''), url: m[0] } } catch { return null }
  }).filter(Boolean)
}

function stripLinks(notes) {
  return (notes || '').replace(/🔗\s*/g, '').replace(/\[([^\]]+)\]\(https?:\/\/[^)]+\)/g, '').trim()
}

// ── WeightDots ────────────────────────────────────────────────────────────────
function WeightDots({ weight = 2, done = false }) {
  const col = done
    ? 'var(--ink-3)'
    : weight === 3 ? 'var(--good)' : weight === 2 ? 'var(--warn)' : 'var(--bad)'
  return (
    <span className="weight-dots" title={`Satisfaction impact: ${weight}/3`}>
      {[1, 2, 3].map(i => (
        <span key={i} className="dot" style={{
          background: i <= weight && !done ? col : 'var(--line-2)',
          opacity: done ? 0.4 : 1,
        }} />
      ))}
    </span>
  )
}

// ── SparkleIcon ───────────────────────────────────────────────────────────────
function SparkleIcon() {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor" aria-hidden>
      <path d="M8 .5 L9.4 6.1 L15 7 L9.4 7.9 L8 13.5 L6.6 7.9 L1 7 L6.6 6.1 Z"/>
      <path d="M13 .5 L13.5 2.5 L15.5 3 L13.5 3.5 L13 5.5 L12.5 3.5 L10.5 3 L12.5 2.5 Z" opacity=".55"/>
      <path d="M2.5 10.5 L2.9 12 L4.5 12.5 L2.9 13 L2.5 14.5 L2.1 13 L.5 12.5 L2.1 12 Z" opacity=".45"/>
    </svg>
  )
}

// ── SubtaskItem ───────────────────────────────────────────────────────────────
function SubtaskItem({ sub, onToggle }) {
  const links    = parseLinks(sub.notes)
  const noteText = stripLinks(sub.notes)
  const pLabel   = sub.prio === 'high' ? 'H' : sub.prio === 'medium' ? 'M' : 'L'
  const pClass   = `subtask-prio prio-${sub.prio === 'high' ? 'high' : sub.prio === 'medium' ? 'med' : 'low'}`

  return (
    <div className={`subtask-item ${sub.done ? 'done' : ''}`}
         style={{ animationDelay: `${sub.position * 40}ms` }}>
      <button
        className="subtask-check"
        onClick={() => onToggle(sub.id, !sub.done)}
        aria-label={sub.done ? 'Mark incomplete' : 'Mark complete'}
      >
        <IconCheck size={9} />
      </button>

      <div className="subtask-body">
        <span className="subtask-title">{sub.title}</span>

        {links.length > 0 && (
          <div className="subtask-links">
            {links.map((l, i) => (
              <a key={i} href={l.url} target="_blank" rel="noopener noreferrer"
                 className="link-chip" onClick={e => e.stopPropagation()}>
                <svg viewBox="0 0 24 24" width="10" height="10" fill="none"
                     stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
                  <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
                </svg>
                {l.title}
              </a>
            ))}
          </div>
        )}

        {noteText && !links.length && (
          <span className="subtask-note">{noteText}</span>
        )}
      </div>

      <div className="subtask-meta">
        <span className={pClass}>{pLabel}</span>
        <WeightDots weight={sub.weight} done={sub.done} />
      </div>
    </div>
  )
}

// ── SubtaskPanel ──────────────────────────────────────────────────────────────
// genSeed: bumped by TaskItem after each AI generation → triggers reload from DB
// aiGenerating: true while TaskItem is calling the edge function
// aiError: error string from TaskItem's generation attempt
function SubtaskPanel({ task, visible, genSeed = 0, aiGenerating = false, aiError = null }) {
  const [subs,    setSubs]    = useState([])
  const [loading, setLoading] = useState(false)
  const [loaded,  setLoaded]  = useState(false)

  // Initial load when task first opens
  useEffect(() => {
    if (!visible || loaded) return
    setLoading(true)
    fetchSubtasks(task.id)
      .then(rows => { setSubs(rows.map(subtaskToUI)); setLoaded(true) })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [visible, loaded, task.id])

  // Reload from DB whenever a new generation completes (genSeed increments)
  useEffect(() => {
    if (genSeed === 0) return
    setLoading(true)
    fetchSubtasks(task.id)
      .then(rows => setSubs(rows.map(subtaskToUI)))
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [genSeed, task.id])

  const handleToggle = useCallback(async (id, done) => {
    setSubs(prev => prev.map(s => s.id === id ? { ...s, done } : s))
    try { await toggleSubtask(id, done) }
    catch { setSubs(prev => prev.map(s => s.id === id ? { ...s, done: !done } : s)) }
  }, [])

  if (!visible) return null

  const pending = subs.filter(s => !s.done)
  const done    = subs.filter(s =>  s.done)
  const pct     = subs.length ? Math.round((done.length / subs.length) * 100) : 0
  const busy    = loading || aiGenerating

  return (
    <div className="subtask-panel">

      {/* Header — label + inline spinner when busy */}
      <div className="subtask-header">
        <span className="subtask-label">
          {aiGenerating
            ? 'Generating steps…'
            : subs.length > 0
              ? <>{pending.length} step{pending.length !== 1 ? 's' : ''} left · <b>{pct}%</b> done</>
              : 'AI sub-tasks'}
        </span>
        {busy && <span className="ai-spinner" style={{ marginLeft: 'auto' }} />}
      </div>

      {aiError && <div className="subtask-error">⚠ {aiError}</div>}

      {/* Shimmer skeleton while generating or initial-loading */}
      {busy && subs.length === 0 && (
        <div className="subtask-skeleton">
          {[68, 82, 55].map((w, i) => (
            <div key={i} className="skel-row">
              <div className="skel-check" />
              <div className="skel-line" style={{ width: `${w}%` }} />
              <div className="skel-badge" />
            </div>
          ))}
        </div>
      )}

      {/* Subtask list */}
      {!busy && subs.length > 0 && (
        <>
          <div className="subtask-progress-track">
            <div className="subtask-progress-fill" style={{ width: `${pct}%` }} />
          </div>
          <div className="subtask-list">
            {pending.map(s => <SubtaskItem key={s.id} sub={s} onToggle={handleToggle} />)}
            {done.length > 0 && (
              <details className="done-details">
                <summary className="done-summary">{done.length} completed</summary>
                {done.map(s => <SubtaskItem key={s.id} sub={s} onToggle={handleToggle} />)}
              </details>
            )}
          </div>
        </>
      )}

      {/* Empty state */}
      {!busy && subs.length === 0 && !aiError && (
        <p className="subtask-empty">
          Click the <b>✦</b> icon next to the task to generate AI-powered steps.
        </p>
      )}
    </div>
  )
}

// ── TaskItem ──────────────────────────────────────────────────────────────────
function TaskItem({ t, onToggle, onDelete, onSaveNote, openId, setOpenId }) {
  const open  = openId === t.id
  const [draft,        setDraft]        = useState(t.notes || '')
  const [aiGenerating, setAiGenerating] = useState(false)
  const [aiError,      setAiError]      = useState(null)
  const [genSeed,      setGenSeed]      = useState(0)   // increments to trigger SubtaskPanel reload
  const taRef = useRef(null)

  useEffect(() => { setDraft(t.notes || '') }, [t.id, t.notes])

  useEffect(() => {
    if (open && taRef.current) {
      taRef.current.style.height = 'auto'
      taRef.current.style.height = taRef.current.scrollHeight + 'px'
    }
  }, [open])

  const commit = () => { if (draft !== t.notes) onSaveNote(t.id, draft) }

  const toggleOpen = (e) => {
    e.stopPropagation()
    setOpenId(open ? null : t.id)
  }

  // AI icon click: open the task + generate subtasks
  const handleAIClick = useCallback(async (e) => {
    e.stopPropagation()
    if (aiGenerating) return
    setOpenId(t.id)          // expand so the panel becomes visible
    setAiGenerating(true)
    setAiError(null)
    try {
      await generateSubtasks({ taskId: t.id, taskTitle: t.title, taskCategory: t.cat, taskNotes: t.notes })
      setGenSeed(n => n + 1) // tell SubtaskPanel to re-fetch from DB
    } catch (err) {
      setAiError(err.message)
    } finally {
      setAiGenerating(false)
    }
  }, [t, aiGenerating, setOpenId])

  return (
    <div className={`task ${t.done ? 'done' : ''} ${open ? 'note-open' : ''}`}>

      {/* Checkbox */}
      <button className="check" aria-label="toggle done" onClick={() => onToggle(t.id)}>
        <IconCheck />
      </button>

      {/* Body — click to expand */}
      <div className="body" onClick={toggleOpen} style={{ cursor: 'pointer' }}>
        <div className="title">{t.title}</div>
        <div className="row">
          <span className={`chip ${t.cat}`}>
            <span className="micon" style={{ display: 'inline-flex', alignItems: 'center' }}>
              {t.cat === 'work'
                ? <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M3 12h18" /></svg>
                : <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.5-7 10-7 10z" /></svg>
              }
            </span>
            {t.cat}
          </span>
          <span className={`chip prio-${t.prio === 'high' ? 'high' : t.prio === 'medium' ? 'med' : 'low'}`}>
            <span className="swatch" />
            {t.prio}
          </span>
          <span>· added {prettyDate(t.created)}</span>
          {t.done && t.completed && <span>· done {prettyDate(t.completed)}</span>}
        </div>
        {t.notes && !open && <div className="note-preview">{t.notes}</div>}
      </div>

      {/* Action buttons — edit | delete | ✦ AI */}
      <div className="actions">
        <button className="icon-btn" title={open ? 'close' : 'notes'} onClick={toggleOpen}>
          <IconPencil />
        </button>
        <button className="icon-btn danger" title="delete" onClick={() => onDelete(t.id)}>
          <IconTrash />
        </button>
        <button
          className={`icon-btn ai-icon-btn${aiGenerating ? ' spinning' : ''}`}
          title="Generate AI subtasks"
          onClick={handleAIClick}
          disabled={aiGenerating}
        >
          {aiGenerating
            ? <span className="ai-btn-dot-spin" />
            : <SparkleIcon />}
        </button>
      </div>

      {/* Expanded area */}
      <div className="notes-wrap">
        <div className="notes-inner">

          <SubtaskPanel
            task={t}
            visible={open}
            genSeed={genSeed}
            aiGenerating={aiGenerating}
            aiError={aiError}
          />

          <div className="notes-divider">Notes</div>

          <textarea
            ref={taRef}
            className="notes"
            value={draft}
            placeholder="Add context, links, or additional notes…"
            onChange={(e) => {
              setDraft(e.target.value)
              e.target.style.height = 'auto'
              e.target.style.height = e.target.scrollHeight + 'px'
            }}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setOpenId(null)
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { commit(); setOpenId(null) }
            }}
            onClick={e => e.stopPropagation()}
          />
          <div className="notes-hint">esc to close · ⌘↵ to save</div>
        </div>
      </div>
    </div>
  )
}

// ── TaskList ──────────────────────────────────────────────────────────────────
export function TaskList({ tasks, onToggle, onDelete, onSaveNote }) {
  const [openId, setOpenId] = useState(null)

  if (!tasks.length) {
    return (
      <div className="empty">
        <span>Nothing here.</span>
        <div className="sub">A clean inbox is also a kind of progress.</div>
      </div>
    )
  }

  const pending = tasks.filter(t => !t.done)
  const done    = tasks.filter(t =>  t.done)

  return (
    <div className="list">
      {pending.length > 0 && (
        <>
          <div className="group-label">
            <span>To do</span><span className="rule" /><span>{pending.length}</span>
          </div>
          {pending.map(t => (
            <TaskItem key={t.id} t={t} onToggle={onToggle} onDelete={onDelete}
              onSaveNote={onSaveNote} openId={openId} setOpenId={setOpenId} />
          ))}
        </>
      )}
      {done.length > 0 && (
        <>
          <div className="group-label">
            <span>Done</span><span className="rule" /><span>{done.length}</span>
          </div>
          {done.map(t => (
            <TaskItem key={t.id} t={t} onToggle={onToggle} onDelete={onDelete}
              onSaveNote={onSaveNote} openId={openId} setOpenId={setOpenId} />
          ))}
        </>
      )}
    </div>
  )
}

// ── Composer ──────────────────────────────────────────────────────────────────
export function Composer({ onAdd, defaultCat }) {
  const [text, setText] = useState('')
  const [cat,  setCat]  = useState(defaultCat || 'work')
  const [prio, setPrio] = useState('medium')

  useEffect(() => { if (defaultCat) setCat(defaultCat) }, [defaultCat])

  const submit = () => {
    const v = text.trim()
    if (!v) return
    onAdd({ title: v, cat, prio })
    setText('')
  }

  return (
    <div className="composer-wrap">
      <div className="composer">
        <input
          className="title-input"
          placeholder="Add a task — type, pick category & priority, ↵"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submit() }}
        />
        <div className="seg" role="group" aria-label="category">
          <button className={cat === 'work'     ? 'on' : ''} onClick={() => setCat('work')}>WORK</button>
          <button className={cat === 'personal' ? 'on' : ''} onClick={() => setCat('personal')}>PERSONAL</button>
        </div>
        <div className="seg" role="group" aria-label="priority">
          <button className={prio === 'high'   ? 'on' : ''} onClick={() => setPrio('high')}>H</button>
          <button className={prio === 'medium' ? 'on' : ''} onClick={() => setPrio('medium')}>M</button>
          <button className={prio === 'low'    ? 'on' : ''} onClick={() => setPrio('low')}>L</button>
        </div>
        <button className="add-btn" disabled={!text.trim()} onClick={submit}>
          <IconPlus size={14} /> Add
        </button>
      </div>
    </div>
  )
}
