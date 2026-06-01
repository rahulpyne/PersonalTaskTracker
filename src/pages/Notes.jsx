import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { fetchNotes, createNote, updateNote, deleteNote, structureNote } from '../lib/notes'
import { startRecording, stopRecording, transcribeAudio, isVoiceSupported } from '../lib/voice'

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

// ── MicIcon ───────────────────────────────────────────────────────────────────
function MicIcon({ active }) {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none"
         stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="2" width="6" height="11" rx="3" fill={active ? 'currentColor' : 'none'} />
      <path d="M19 10a7 7 0 0 1-14 0M12 19v3M8 22h8" />
    </svg>
  )
}

// ── StopIcon ──────────────────────────────────────────────────────────────────
function StopIcon() {
  return (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor">
      <rect x="4" y="4" width="16" height="16" rx="2" />
    </svg>
  )
}

// ── Main Notes page ───────────────────────────────────────────────────────────
export default function Notes({ focusNoteId, onFocusClear }) {
  const [notes,     setNotes]     = useState([])
  const [loading,   setLoading]   = useState(true)
  const [activeId,  setActiveId]  = useState(null)
  const [search,    setSearch]    = useState('')
  const [preview,   setPreview]   = useState(false)
  const [saving,    setSaving]    = useState(false)
  const [tagInput,  setTagInput]  = useState('')
  const saveTimer = useRef(null)
  const bodyRef   = useRef(null)

  // AI structuring state
  const [aiWorking,  setAiWorking]  = useState(false)
  const [aiError,    setAiError]    = useState(null)

  // Voice recording state (Whisper-based)
  const [voiceOpen,      setVoiceOpen]      = useState(false)
  const [recording,      setRecording]      = useState(false)
  const [transcribing,   setTranscribing]   = useState(false)
  const [transcript,     setTranscript]     = useState('')
  const [elapsed,        setElapsed]        = useState(0)
  const voiceSupported = isVoiceSupported()
  const timerRef = useRef(null)

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

  // ── Jump to note when navigating from Graph view ───────────────────────────
  useEffect(() => {
    if (!focusNoteId) return
    setActiveId(focusNoteId)
    onFocusClear?.()
  }, [focusNoteId]) // eslint-disable-line

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

  // ── AI: structure existing note body ─────────────────────────────────────
  const handleStructure = useCallback(async () => {
    const text = draftBody.trim() || draftTitle.trim()
    if (!text || aiWorking) return
    setAiWorking(true)
    setAiError(null)
    try {
      const result = await structureNote({ text, mode: 'structure' })
      // Apply AI output to the current draft + trigger save
      if (result.title) setDraftTitle(result.title)
      setDraftBody(result.body ?? '')
      const newTags = [...new Set([...draftTags, ...(result.tags ?? [])])]
      setDraftTags(newTags)
      clearTimeout(saveTimer.current)
      setSaving(true)
      const updated = await updateNote(activeId, {
        title: result.title || draftTitle,
        body:  result.body  || draftBody,
        tags:  newTags,
        pinned: draftPinned,
      })
      setNotes(prev => prev.map(n => n.id === activeId ? { ...n, ...updated } : n))
      // Resize textarea
      if (bodyRef.current) {
        bodyRef.current.style.height = 'auto'
        bodyRef.current.style.height = bodyRef.current.scrollHeight + 'px'
      }
    } catch (e) {
      setAiError(e.message)
    } finally {
      setAiWorking(false)
      setSaving(false)
    }
  }, [draftBody, draftTitle, draftTags, draftPinned, activeId, aiWorking]) // eslint-disable-line

  // ── Voice: Whisper-based recording ───────────────────────────────────────
  const fmtElapsed = s => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

  const handleVoiceStart = useCallback(async () => {
    setAiError(null)
    try {
      await startRecording()
      setRecording(true)
      setElapsed(0)
      timerRef.current = setInterval(() => setElapsed(s => s + 1), 1000)
    } catch (e) {
      setAiError(
        e.name === 'NotAllowedError'
          ? 'Microphone access denied — allow it in your browser settings'
          : e.message
      )
    }
  }, [])

  const handleVoiceStop = useCallback(async () => {
    clearInterval(timerRef.current)
    setRecording(false)
    setTranscribing(true)
    setAiError(null)
    try {
      const blob = await stopRecording()
      if (!blob || blob.size < 1000) { setTranscribing(false); return }
      const text = await transcribeAudio(blob, 'personal notes ideas tasks')
      if (text) setTranscript(prev => prev ? prev + ' ' + text : text)
    } catch (e) {
      setAiError(e.message)
    } finally {
      setTranscribing(false)
      setElapsed(0)
    }
  }, [])

  // ── Voice: create note from transcript ───────────────────────────────────
  const handleVoiceCreate = useCallback(async () => {
    const text = transcript.trim()
    if (!text || aiWorking) return
    setAiWorking(true)
    setAiError(null)
    try {
      const result = await structureNote({ text, mode: 'voice' })
      const note   = await createNote({
        title: result.title || 'Voice Note',
        body:  result.body  || text,
        tags:  result.tags  || [],
      })
      setNotes(prev => [note, ...prev])
      setActiveId(note.id)
      setVoiceOpen(false)
      setTranscript('')
    } catch (e) {
      setAiError(e.message)
    } finally {
      setAiWorking(false)
    }
  }, [transcript, aiWorking]) // eslint-disable-line

  const closeVoicePanel = useCallback(() => {
    if (recording) handleVoiceStop()
    setVoiceOpen(false)
  }, [recording, handleVoiceStop])

  // Cleanup timer on unmount
  useEffect(() => () => clearInterval(timerRef.current), [])

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

        {/* AI / mic error — always rendered so voice errors show on empty state too */}
        {aiError && (
          <div className="notes-ai-error">
            <span>⚠ {aiError}</span>
            <button onClick={() => setAiError(null)}>×</button>
          </div>
        )}

        {!active ? (
          <div className="notes-empty-state">
            <div className="notes-empty-icon">📝</div>
            <div className="notes-empty-msg">Select a note or create a new one</div>
            <div className="notes-empty-actions">
              <button className="notes-new-btn" onClick={handleNew}>New note (⌘N)</button>
              {voiceSupported && (
                <button
                  className={`notes-new-btn notes-voice-cta ${recording ? 'recording' : ''}`}
                  onClick={() => setVoiceOpen(v => !v)}
                >
                  <MicIcon active={recording} />
                  {recording ? <><span className="voice-rec-dot" /> Recording…</> : 'Voice note'}
                </button>
              )}
            </div>
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
                <div className="notes-toolbar-sep" />
                {voiceSupported && (
                  <button
                    className={`notes-tool-btn notes-voice-btn ${voiceOpen ? 'active' : ''}`}
                    onClick={() => voiceOpen ? closeVoicePanel() : setVoiceOpen(true)}
                    title="Voice input"
                  >
                    <MicIcon active={recording} />
                    {recording && <span className="voice-rec-dot" />}
                    Voice
                  </button>
                )}
                <button
                  className="notes-tool-btn notes-ai-btn"
                  onClick={handleStructure}
                  disabled={aiWorking || !draftBody.trim()}
                  title="AI-structure this note"
                >
                  {aiWorking ? <span className="notes-ai-spin">⟳</span> : '✦'}
                  Structure
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

            {/* AI working overlay on note body */}
            {aiWorking && !voiceOpen && (
              <div className="notes-ai-overlay">
                <span className="notes-ai-spin-lg">⟳</span>
                <span>Structuring note…</span>
              </div>
            )}

            <div className="notes-hint">
              Auto-saves · ⌘N new · ⌘P preview · Markdown supported
            </div>
          </>
        )}

        {/* ── Voice panel — lives outside active-note gate so it works from empty state ── */}
        {voiceOpen && (
          <div className="notes-voice-panel">
            <div className="voice-panel-header">
              <span className="voice-panel-title">
                <MicIcon active={recording} />
                {recording ? <><span className="voice-rec-dot" />Recording…</> : 'Voice Input'}
              </span>
              <button className="voice-panel-close" onClick={closeVoicePanel} title="Close">×</button>
            </div>

            <div className="voice-transcript-area">
              {!transcript && !transcribing && !recording && (
                <span className="voice-transcript-empty">
                  Hit Record and start talking — pause anytime, hit Stop when done
                </span>
              )}
              {!transcript && recording && (
                <span className="voice-transcript-empty">Listening… speak now</span>
              )}
              {transcribing && (
                <span className="voice-transcript-empty">
                  <span className="notes-ai-spin">⟳</span> Transcribing…
                </span>
              )}
              {transcript && <span className="voice-transcript-text">{transcript}</span>}
            </div>

            <div className="voice-panel-actions">
              {!recording && !transcribing ? (
                <button className="voice-btn voice-btn-record" onClick={handleVoiceStart} disabled={transcribing}>
                  <MicIcon active={false} /> Record
                </button>
              ) : recording ? (
                <button className="voice-btn voice-btn-stop" onClick={handleVoiceStop}>
                  <StopIcon /> Stop · <span className="voice-elapsed">{fmtElapsed(elapsed)}</span>
                </button>
              ) : null}
              {transcript.trim() && !recording && (
                <button
                  className="voice-btn voice-btn-create"
                  onClick={handleVoiceCreate}
                  disabled={aiWorking}
                >
                  {aiWorking
                    ? <><span className="notes-ai-spin">⟳</span> Structuring…</>
                    : <>✦ Structure &amp; Create Note</>}
                </button>
              )}
              {transcript.trim() && (
                <button
                  className="voice-btn voice-btn-ghost"
                  onClick={() => { setTranscript(''); transcriptRef.current = '' }}
                >
                  Clear
                </button>
              )}
            </div>
          </div>
        )}

      </main>
    </div>
  )
}
