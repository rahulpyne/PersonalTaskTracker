import { useState, useEffect, useRef } from 'react'
import { IconCheck, IconPencil, IconTrash, IconPlus } from './Icons'

function prettyDate(ms) {
  if (!ms) return ''
  const d = new Date(ms)
  const now = new Date(); now.setHours(0, 0, 0, 0)
  const yest = new Date(now); yest.setDate(yest.getDate() - 1)
  const dd = new Date(d); dd.setHours(0, 0, 0, 0)
  if (dd.getTime() === now.getTime())  return 'today'
  if (dd.getTime() === yest.getTime()) return 'yesterday'
  const days = Math.round((now - dd) / 86_400_000)
  if (days < 7) return `${days}d ago`
  return d.toLocaleDateString('en', { month: 'short', day: 'numeric' })
}

function TaskItem({ t, onToggle, onDelete, onSaveNote, openId, setOpenId }) {
  const open = openId === t.id
  const [draft, setDraft] = useState(t.notes || '')
  const taRef = useRef(null)

  useEffect(() => { setDraft(t.notes || '') }, [t.id, t.notes])

  useEffect(() => {
    if (open && taRef.current) {
      taRef.current.focus()
      taRef.current.style.height = 'auto'
      taRef.current.style.height = taRef.current.scrollHeight + 'px'
    }
  }, [open])

  const commit = () => {
    if (draft !== t.notes) onSaveNote(t.id, draft)
  }

  return (
    <div className={`task ${t.done ? 'done' : ''} ${open ? 'note-open' : ''}`}>
      <button className="check" aria-label="toggle done" onClick={() => onToggle(t.id)}>
        <IconCheck />
      </button>
      <div className="body">
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
      <div className="actions">
        <button className="icon-btn" title={open ? 'close notes' : 'edit notes'} onClick={() => setOpenId(open ? null : t.id)}>
          <IconPencil />
        </button>
        <button className="icon-btn danger" title="delete" onClick={() => onDelete(t.id)}>
          <IconTrash />
        </button>
      </div>
      <div className="notes-wrap">
        <div className="notes-inner">
          <textarea
            ref={taRef}
            className="notes"
            value={draft}
            placeholder="Add a note — context, links, sub-steps…"
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
          />
          <div className="notes-hint">esc to close · ⌘↵ to save</div>
        </div>
      </div>
    </div>
  )
}

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
  const done    = tasks.filter(t => t.done)

  return (
    <div className="list">
      {pending.length > 0 && (
        <>
          <div className="group-label">
            <span>To do</span><span className="rule" /><span>{pending.length}</span>
          </div>
          {pending.map(t => (
            <TaskItem key={t.id} t={t} onToggle={onToggle} onDelete={onDelete} onSaveNote={onSaveNote} openId={openId} setOpenId={setOpenId} />
          ))}
        </>
      )}
      {done.length > 0 && (
        <>
          <div className="group-label">
            <span>Done</span><span className="rule" /><span>{done.length}</span>
          </div>
          {done.map(t => (
            <TaskItem key={t.id} t={t} onToggle={onToggle} onDelete={onDelete} onSaveNote={onSaveNote} openId={openId} setOpenId={setOpenId} />
          ))}
        </>
      )}
    </div>
  )
}

export function Composer({ onAdd, defaultCat }) {
  const [text, setText]   = useState('')
  const [cat,  setCat]    = useState(defaultCat || 'work')
  const [prio, setPrio]   = useState('medium')

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
          <button className={cat === 'work' ? 'on' : ''} onClick={() => setCat('work')}>WORK</button>
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
