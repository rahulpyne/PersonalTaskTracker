import { useState, useEffect, useRef, useCallback } from 'react'
import { IconCheck, IconPencil, IconTrash, IconPlus } from './Icons'
import { toggleSubtask, generateSubtasks } from '../lib/tasks'
import { startRecording, stopRecording, transcribeAudio, isVoiceSupported } from '../lib/voice'

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
// Subtasks arrive pre-loaded on task.subtasks (embedded in fetchTasks query).
// No separate DB call — just reads from props and handles optimistic toggles.
function SubtaskPanel({ task, visible, aiGenerating = false, aiError = null }) {
  // Local copy for optimistic toggle updates; syncs when task.subtasks changes
  const [subs, setSubs] = useState(task.subtasks || [])

  useEffect(() => {
    setSubs(task.subtasks || [])
  }, [task.subtasks])

  const handleToggle = useCallback(async (id, done) => {
    // Optimistic update
    setSubs(prev => prev.map(s => s.id === id ? { ...s, done } : s))
    try { await toggleSubtask(id, done) }
    catch { setSubs(prev => prev.map(s => s.id === id ? { ...s, done: !done } : s)) }
  }, [])

  if (!visible) return null

  const pending = subs.filter(s => !s.done)
  const done    = subs.filter(s =>  s.done)
  const pct     = subs.length ? Math.round((done.length / subs.length) * 100) : 0

  return (
    <div className="subtask-panel">

      {/* Header */}
      <div className="subtask-header">
        <span className="subtask-label">
          {aiGenerating
            ? 'Generating steps…'
            : subs.length > 0
              ? <>{pending.length} step{pending.length !== 1 ? 's' : ''} left · <b>{pct}%</b> done</>
              : 'AI sub-tasks'}
        </span>
        {aiGenerating && <span className="ai-spinner" style={{ marginLeft: 'auto' }} />}
      </div>

      {aiError && <div className="subtask-error">⚠ {aiError}</div>}

      {/* Skeleton while AI is generating and no subtasks yet */}
      {aiGenerating && subs.length === 0 && (
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
      {!aiGenerating && subs.length > 0 && (
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
      {!aiGenerating && subs.length === 0 && !aiError && (
        <p className="subtask-empty">
          Click the <b>✦</b> icon next to the task to generate AI-powered steps.
        </p>
      )}
    </div>
  )
}

// ── TaskItem ──────────────────────────────────────────────────────────────────
function TaskItem({ t, onToggle, onDelete, onSaveNote, onRefresh, openId, setOpenId }) {
  const open  = openId === t.id
  const [draft,        setDraft]        = useState(t.notes || '')
  const [aiGenerating, setAiGenerating] = useState(false)
  const [aiError,      setAiError]      = useState(null)
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

  // AI icon click: expand task + generate subtasks
  const handleAIClick = useCallback(async (e) => {
    e.stopPropagation()
    if (aiGenerating) return
    setOpenId(t.id)
    setAiGenerating(true)
    setAiError(null)
    try {
      await generateSubtasks({ taskId: t.id, taskTitle: t.title, taskCategory: t.cat, taskNotes: t.notes })
      onRefresh()   // re-fetch tasks so new subtasks arrive via task.subtasks
    } catch (err) {
      setAiError(err.message)
    } finally {
      setAiGenerating(false)
    }
  }, [t, aiGenerating, setOpenId, onRefresh])

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
export function TaskList({ tasks, onToggle, onDelete, onSaveNote, onRefresh }) {
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
              onSaveNote={onSaveNote} onRefresh={onRefresh} openId={openId} setOpenId={setOpenId} />
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
              onSaveNote={onSaveNote} onRefresh={onRefresh} openId={openId} setOpenId={setOpenId} />
          ))}
        </>
      )}
    </div>
  )
}

// ── Composer ──────────────────────────────────────────────────────────────────
export function Composer({ onAdd, defaultCat }) {
  const [text,       setText]       = useState('')
  const [cat,        setCat]        = useState(defaultCat || 'work')
  const [prio,       setPrio]       = useState('medium')
  const [voiceState, setVoiceState] = useState('idle')   // idle | recording | transcribing
  const [elapsed,    setElapsed]    = useState(0)
  const [voiceErr,   setVoiceErr]   = useState(null)
  const timerRef  = useRef(null)
  const inputRef  = useRef(null)
  const canVoice  = isVoiceSupported()

  useEffect(() => { if (defaultCat) setCat(defaultCat) }, [defaultCat])

  const submit = () => {
    const v = text.trim()
    if (!v) return
    onAdd({ title: v, cat, prio })
    setText('')
    inputRef.current?.focus()
  }

  // ── Voice handlers ──────────────────────────────────────────────────────────
  const handleMicClick = useCallback(async () => {
    setVoiceErr(null)

    if (voiceState === 'recording') {
      // Stop → transcribe
      clearInterval(timerRef.current)
      setVoiceState('transcribing')
      try {
        const blob = await stopRecording()
        if (!blob || blob.size < 1000) {
          setVoiceState('idle')
          setElapsed(0)
          return
        }
        const transcript = await transcribeAudio(blob, 'task tracker personal tasks')
        if (transcript) {
          setText(transcript)
          inputRef.current?.focus()
        }
      } catch (e) {
        setVoiceErr(e.message)
      }
      setVoiceState('idle')
      setElapsed(0)
      return
    }

    // Start recording
    try {
      await startRecording()
      setVoiceState('recording')
      setElapsed(0)
      timerRef.current = setInterval(() => setElapsed(s => s + 1), 1000)
    } catch (e) {
      setVoiceErr(
        e.name === 'NotAllowedError'
          ? 'Mic access denied — allow it in your browser settings'
          : e.message
      )
      setVoiceState('idle')
    }
  }, [voiceState])

  // Cleanup timer on unmount
  useEffect(() => () => clearInterval(timerRef.current), [])

  const fmtElapsed = s => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

  return (
    <div className="composer-wrap">
      {voiceErr && (
        <div className="composer-voice-err">
          ⚠ {voiceErr}
          <button onClick={() => setVoiceErr(null)}>×</button>
        </div>
      )}
      <div className="composer">
        {/* Mic button */}
        {canVoice && (
          <button
            className={`composer-mic-btn ${voiceState === 'recording' ? 'recording' : ''} ${voiceState === 'transcribing' ? 'transcribing' : ''}`}
            onClick={handleMicClick}
            disabled={voiceState === 'transcribing'}
            title={voiceState === 'recording' ? `Stop recording (${fmtElapsed(elapsed)})` : 'Voice input (Whisper)'}
          >
            {voiceState === 'transcribing' ? (
              <span className="composer-mic-spin">⟳</span>
            ) : voiceState === 'recording' ? (
              <>
                <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><rect x="4" y="4" width="16" height="16" rx="2"/></svg>
                <span className="composer-mic-timer">{fmtElapsed(elapsed)}</span>
              </>
            ) : (
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="9" y="2" width="6" height="11" rx="3"/>
                <path d="M19 10a7 7 0 0 1-14 0M12 19v3M8 22h8"/>
              </svg>
            )}
          </button>
        )}

        <input
          ref={inputRef}
          className="title-input"
          placeholder={voiceState === 'recording' ? `Listening… ${fmtElapsed(elapsed)}` : 'Add a task — or tap 🎤 to speak'}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submit() }}
          readOnly={voiceState === 'recording'}
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
        <button className="add-btn" disabled={!text.trim() || voiceState !== 'idle'} onClick={submit}>
          <IconPlus size={14} /> Add
        </button>
      </div>
    </div>
  )
}
