import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { fetchNotes, createNote, updateNote, deleteNote } from '../lib/notes'

// ── Tiny markdown renderer (no extra deps) ────────────────────────────────────
function renderMarkdown(md) {
  if (!md) return ''
  return md
    // headings
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm,  '<h2>$1</h2>')
    .replace(/^# (.+)$/gm,   '<h1>$1</h1>')
    // bold / italic
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g,     '<em>$1</em>')
    .replace(/__(.+?)__/g,     '<strong>$1</strong>')
    .replace(/_(.+?)_/g,       '<em>$1</em>')
    // inline code
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    // blockquote
    .replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>')
    // hr
    .replace(/^---$/gm, '<hr/>')
    // links
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    // unordered lists (must come before paragraph)
    .replace(/^[-*] (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>\n?)+/g, m => `<ul>${m}</ul>`)
    // ordered lists
    .replace(/^\d+\. (.+)$/gm, '<li>$1</li>')
    // paragraphs (double newline = new paragraph)
    .split(/\n{2,}/)
    .map(chunk => chunk.startsWith('<') ? chunk : `<p>${chunk.replace(/\n/g, '<br/>')}</p>`)
    .join('\n')
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function prettyDate(iso) {
  if (!iso) return ''
  const d   = new Date(iso)
  const now = new Date()
  const diffMs  = now - d
  const diffMin = Math.floor(diffMs / 60000)
  if (diffMin < 1)  return 'just now'
  if (diffMin < 60) return `${diffMin}m ago`
  const diffH = Math.floor(diffMin / 60)
  if (diffH < 24)  return `${diffH}h ago`
  const diffD = Math.floor(diffH / 24)
  if (diffD < 7)   return `${diffD}d ago`
  return d.toLocaleDateString('en', { month: 'short', day: 'numeric' })
}

function wordCount(text) {
  return text.trim() ? text.trim().split(/\s+/).length : 0
}

// ── TagChip ───────────────────────────────────────────────────────────────────
function TagChip({ tag, onRemove }) {
  return (
    <span className="note-tag-chip">
      #{tag}
      {onRemove && (
        <button className="note-tag-remove" onClick={() => onRemove(tag)} title="Remove tag">×</button>
      )}
    </span>
  )
}

// ── NoteListItem ──────────────────────────────────────────────────────────────
function NoteListItem({ note, active, onClick }) {
  const snippet = note.body.replace(/[#*_`>]/g, '').slice(0, 90)
  return (
    <button className={`note-list-item ${active ? 'active' : ''}`} onClick={onClick}>
      {note.pinned && <span className="note-pin-dot" title="Pinned">●</span>}
      <div className="note-list-title">{note.title || <em>Untitled</em>}</div>
      {snippet && <div className="note-list-snippet">{snippet}</div>}
      <div className="note-list-meta">
        {note.tags.slice(0, 3).map(t => <span key={t} className="note-tag-mini">#{t}</span>)}
        <span className="note-list-date">{prettyDate(note.updated_at)}</span>
      </div>
    </button>
  )
}

// ── Main Notes page ───────────────────────────────────────────────────────────
export default function Notes() {
  const [notes,     setNotes]     = useState([])
  const [loading,   setLoading]   = useState(true)
  const [activeId,  setActiveId]  = useState(null)
  const [search,    setSearch]    = useState('')
  const [preview,   setPreview]   = useState(false)
  const [saving,    setSaving]    = useState(false)
  const [tagInput,  setTagInput]  = useState('')
  const saveTimer = useRef(null)
  const bodyRef   = useRef(null)

  // Draft fields (controlled editor)
  const [draftTitle, setDraftTitle] = useState('')
  const [draftBody,  setDraftBody]  = useState('')
  const [draftTags,  setDraftTags]  = useState([])
  const [draftPinned, setDraftPinned] = useState(false)

  // ── Load ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    fetchNotes()
      .then(rows => {
        setNotes(rows)
        if (rows.length) setActiveId(rows[0].id)
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  // ── Sync draft when active note changes ───────────────────────────────────
  const active = notes.find(n => n.id === activeId) ?? null

  useEffect(() => {
    if (!active) return
    setDraftTitle(active.title)
    setDraftBody(active.body)
    setDraftTags(active.tags ?? [])
    setDraftPinned(active.pinned ?? false)
    setPreview(false)
    // auto-size textarea
    if (bodyRef.current) {
      bodyRef.current.style.height = 'auto'
      bodyRef.current.style.height = bodyRef.current.scrollHeight + 'px'
    }
  }, [activeId]) // eslint-disable-line

  // ── Auto-save with 800ms debounce ─────────────────────────────────────────
  const scheduleSave = useCallback((fields) => {
    if (!activeId) return
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(async () => {
      setSaving(true)
      try {
        const updated = await updateNote(activeId, fields)
        setNotes(prev => prev.map(n => n.id === activeId ? { ...n, ...updated } : n))
      } catch (e) { console.error(e) }
      finally { setSaving(false) }
    }, 800)
  }, [activeId])

  const onTitleChange = (e) => {
    setDraftTitle(e.target.value)
    scheduleSave({ title: e.target.value, body: draftBody, tags: draftTags, pinned: draftPinned })
  }
  const onBodyChange = (e) => {
    setDraftBody(e.target.value)
    e.target.style.height = 'auto'
    e.target.style.height = e.target.scrollHeight + 'px'
    scheduleSave({ title: draftTitle, body: e.target.value, tags: draftTags, pinned: draftPinned })
  }

  // ── Tag management ────────────────────────────────────────────────────────
  const addTag = (raw) => {
    const tag = raw.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
    if (!tag || draftTags.includes(tag)) return
    const newTags = [...draftTags, tag]
    setDraftTags(newTags)
    scheduleSave({ title: draftTitle, body: draftBody, tags: newTags, pinned: draftPinned })
  }
  const removeTag = (tag) => {
    const newTags = draftTags.filter(t => t !== tag)
    setDraftTags(newTags)
    scheduleSave({ title: draftTitle, body: draftBody, tags: newTags, pinned: draftPinned })
  }
  const togglePin = async () => {
    const newPinned = !draftPinned
    setDraftPinned(newPinned)
    clearTimeout(saveTimer.current)
    setSaving(true)
    try {
      const updated = await updateNote(activeId, { title: draftTitle, body: draftBody, tags: draftTags, pinned: newPinned })
      setNotes(prev => {
        const next = prev.map(n => n.id === activeId ? { ...n, ...updated } : n)
        return [...next].sort((a, b) => b.pinned - a.pinned || new Date(b.updated_at) - new Date(a.updated_at))
      })
    } catch (e) { console.error(e) }
    finally { setSaving(false) }
  }

  // ── New note ──────────────────────────────────────────────────────────────
  const handleNew = async () => {
    const note = await createNote({ title: '', body: '', tags: [] })
    setNotes(prev => [note, ...prev])
    setActiveId(note.id)
  }

  // ── Delete ────────────────────────────────────────────────────────────────
  const handleDelete = async () => {
    if (!activeId || !window.confirm('Delete this note?')) return
    await deleteNote(activeId)
    const next = notes.filter(n => n.id !== activeId)
    setNotes(next)
    setActiveId(next[0]?.id ?? null)
  }

  // ── Search filter ─────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    if (!search) return notes
    const q = search.toLowerCase()
    return notes.filter(n =>
      n.title.toLowerCase().includes(q) ||
      n.body.toLowerCase().includes(q) ||
      n.tags.some(t => t.includes(q))
    )
  }, [notes, search])

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'n') {
        e.preventDefault()
        handleNew()
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'p') {
        e.preventDefault()
        setPreview(v => !v)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, []) // eslint-disable-line

  if (loading) return (
    <div className="notes-page-loading">Loading notes…</div>
  )

  return (
    <div className="notes-page">

      {/* ── Left panel: list ── */}
      <aside className="notes-list-panel">
        <div className="notes-list-head">
          <div className="notes-list-title-row">
            <span className="notes-list-heading">Notes</span>
            <span className="notes-count">{notes.length}</span>
          </div>
          <div className="notes-search-wrap">
            <svg viewBox="0 0 20 20" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.6"
                 className="notes-search-icon">
              <circle cx="9" cy="9" r="5.5"/><path d="M14.5 14.5l3.5 3.5"/>
            </svg>
            <input
              className="notes-search"
              placeholder="Search…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <button className="notes-new-btn" onClick={handleNew} title="New note (⌘N)">
            <svg viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M10 4v12M4 10h12"/>
            </svg>
            New note
          </button>
        </div>

        <div className="notes-list">
          {filtered.length === 0 ? (
            <div className="notes-list-empty">
              {search ? 'No matching notes.' : 'No notes yet. Hit "New note" to start.'}
            </div>
          ) : (
            filtered.map(n => (
              <NoteListItem
                key={n.id}
                note={n}
                active={n.id === activeId}
                onClick={() => setActiveId(n.id)}
              />
            ))
          )}
        </div>
      </aside>

      {/* ── Right panel: editor ── */}
      <main className="notes-editor-panel">
        {!active ? (
          <div className="notes-empty-state">
            <div className="notes-empty-icon">📝</div>
            <div className="notes-empty-msg">Select a note or create a new one</div>
            <button className="notes-new-btn" onClick={handleNew}>New note (⌘N)</button>
          </div>
        ) : (
          <>
            {/* Toolbar */}
            <div className="notes-toolbar">
              <div className="notes-toolbar-left">
                <button
                  className={`notes-tool-btn ${draftPinned ? 'active' : ''}`}
                  onClick={togglePin}
                  title={draftPinned ? 'Unpin' : 'Pin to top'}
                >
                  📌
                </button>
                <button
                  className={`notes-tool-btn ${preview ? 'active' : ''}`}
                  onClick={() => setPreview(v => !v)}
                  title="Toggle preview (⌘P)"
                >
                  {preview ? '✏️ Edit' : '👁 Preview'}
                </button>
              </div>
              <div className="notes-toolbar-right">
                {saving && <span className="notes-saving">saving…</span>}
                {!saving && <span className="notes-saved">·  {wordCount(draftBody)} words</span>}
                <button className="notes-tool-btn danger" onClick={handleDelete} title="Delete note">
                  <svg viewBox="0 0 20 20" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.7">
                    <path d="M6 4V3a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v1M3 4h14M5 4l1 12h8l1-12"/>
                  </svg>
                </button>
              </div>
            </div>

            {/* Title */}
            <input
              className="notes-title-input"
              placeholder="Note title…"
              value={draftTitle}
              onChange={onTitleChange}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); bodyRef.current?.focus() } }}
            />

            {/* Tags */}
            <div className="notes-tags-row">
              {draftTags.map(t => (
                <TagChip key={t} tag={t} onRemove={removeTag} />
              ))}
              <input
                className="notes-tag-input"
                placeholder="+ add tag"
                value={tagInput}
                onChange={e => setTagInput(e.target.value)}
                onKeyDown={e => {
                  if ((e.key === 'Enter' || e.key === ',') && tagInput.trim()) {
                    e.preventDefault()
                    addTag(tagInput)
                    setTagInput('')
                  }
                }}
              />
            </div>

            {/* Body — editor or preview */}
            {preview ? (
              <div
                className="notes-preview"
                dangerouslySetInnerHTML={{ __html: renderMarkdown(draftBody) }}
              />
            ) : (
              <textarea
                ref={bodyRef}
                className="notes-body"
                placeholder={`Start writing… (supports **bold**, *italic*, # headings, - lists, \`code\`, > quotes)`}
                value={draftBody}
                onChange={onBodyChange}
              />
            )}

            <div className="notes-hint">
              Auto-saves · ⌘N new · ⌘P preview · Markdown supported
            </div>
          </>
        )}
      </main>
    </div>
  )
}
