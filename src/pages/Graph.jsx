import { useState, useEffect, useRef } from 'react'
import { fetchNotes } from '../lib/notes'

// ── Build node/edge data from notes ──────────────────────────────────────────
function buildGraph(notes) {
  const nodes = []
  const edges = []
  const tagSet = new Set()

  for (const n of notes) {
    nodes.push({
      id:     n.id,
      type:   'note',
      source: n.source || 'user',   // 'user' | 'claude'
      label:  n.title || 'Untitled',
      note:   n,
      x: (Math.random() - 0.5) * 500,
      y: (Math.random() - 0.5) * 500,
      vx: 0, vy: 0,
    })
    for (const t of (n.tags || [])) tagSet.add(t)
  }

  for (const t of tagSet) {
    nodes.push({
      id:    'tag:' + t,
      type:  'tag',
      label: t,
      note:  null,
      x: (Math.random() - 0.5) * 300,
      y: (Math.random() - 0.5) * 300,
      vx: 0, vy: 0,
    })
  }

  for (const n of notes) {
    for (const t of (n.tags || [])) {
      edges.push({ source: n.id, target: 'tag:' + t })
    }
  }

  return { nodes, edges }
}

// ── Force simulation (one tick) ───────────────────────────────────────────────
function tick(nodes, edges, nodeMap) {
  const K_REP    = 5000
  const K_SPRING = 0.04
  const IDEAL    = 110

  // Repulsion between all node pairs
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i], b = nodes[j]
      const dx = b.x - a.x, dy = b.y - a.y
      const d2 = Math.max(dx * dx + dy * dy, 100)
      const d  = Math.sqrt(d2)
      const f  = K_REP / d2
      const fx = f * dx / d, fy = f * dy / d
      a.vx -= fx; a.vy -= fy
      b.vx += fx; b.vy += fy
    }
  }

  // Spring attraction along edges
  for (const e of edges) {
    const a = nodeMap.get(e.source), b = nodeMap.get(e.target)
    if (!a || !b) continue
    const dx = b.x - a.x, dy = b.y - a.y
    const d  = Math.sqrt(dx * dx + dy * dy) || 1
    const f  = (d - IDEAL) * K_SPRING
    const fx = f * dx / d, fy = f * dy / d
    a.vx += fx; a.vy += fy
    b.vx -= fx; b.vy -= fy
  }

  // Weak center gravity
  for (const n of nodes) {
    n.vx -= n.x * 0.003
    n.vy -= n.y * 0.003
  }

  // Integrate + dampen
  for (const n of nodes) {
    n.vx *= 0.84; n.vy *= 0.84
    n.x  += n.vx; n.y  += n.vy
  }
}

// ── Canvas renderer (one frame) ───────────────────────────────────────────────
function render(ctx, W, H, nodes, edges, nodeMap, transform, hoveredId, selectedId) {
  ctx.clearRect(0, 0, W, H)

  const { x: tx, y: ty, scale } = transform
  ctx.save()
  ctx.translate(tx, ty)
  ctx.scale(scale, scale)

  // Edges
  for (const e of edges) {
    const a = nodeMap.get(e.source), b = nodeMap.get(e.target)
    if (!a || !b) continue
    const lit = hoveredId && (hoveredId === e.source || hoveredId === e.target)
    ctx.beginPath()
    ctx.moveTo(a.x, a.y)
    ctx.lineTo(b.x, b.y)
    ctx.strokeStyle = lit ? 'rgba(99,102,241,0.55)' : 'rgba(148,163,184,0.28)'
    ctx.lineWidth   = lit ? 1.5 / scale : 1 / scale
    ctx.stroke()
  }

  // Nodes
  for (const n of nodes) {
    const isTag = n.type === 'tag'
    const isSel = n.id === selectedId
    const isHov = n.id === hoveredId
    const r = (isTag ? 14 : 10) / scale

    // Glow ring
    if (isSel || isHov) {
      ctx.beginPath()
      ctx.arc(n.x, n.y, r + 5 / scale, 0, Math.PI * 2)
      ctx.fillStyle = isTag ? 'rgba(245,158,11,0.18)' : 'rgba(99,102,241,0.18)'
      ctx.fill()
    }

    // Circle — indigo=user note, teal=claude, purple=gemini, amber=tag hub
    const src = n.source || 'user'
    let fillColor, strokeColor
    if (isTag) {
      fillColor = '#f59e0b'; strokeColor = '#b45309'
    } else if (src === 'claude') {
      fillColor = isSel ? '#0f766e' : '#2dd4bf'; strokeColor = '#0d9488'
    } else if (src === 'gemini') {
      fillColor = isSel ? '#7e22ce' : '#c084fc'; strokeColor = '#9333ea'
    } else {
      fillColor = isSel ? '#4338ca' : '#818cf8'; strokeColor = '#4f46e5'
    }
    ctx.beginPath()
    ctx.arc(n.x, n.y, r, 0, Math.PI * 2)
    ctx.fillStyle   = fillColor
    ctx.strokeStyle = strokeColor
    ctx.lineWidth   = (isSel ? 2.5 : 1.5) / scale
    ctx.fill()
    ctx.stroke()

    // Label
    const maxLen = 22
    const lbl = n.label.length > maxLen ? n.label.slice(0, maxLen) + '…' : n.label
    const fs   = Math.max(9, Math.min(13, 11 / scale))
    ctx.fillStyle    = '#1e293b'
    ctx.font         = `${isTag ? 'bold ' : ''}${fs}px system-ui,sans-serif`
    ctx.textAlign    = 'center'
    ctx.textBaseline = 'top'
    ctx.fillText(lbl, n.x, n.y + r + 3 / scale)
  }

  ctx.restore()
}

// ── Hit test: screen coords → node ───────────────────────────────────────────
function hitTest(nodes, cx, cy, transform, scale) {
  const { x: tx, y: ty } = transform
  const wx = (cx - tx) / scale
  const wy = (cy - ty) / scale
  for (let i = nodes.length - 1; i >= 0; i--) {
    const n = nodes[i]
    const r = (n.type === 'tag' ? 14 : 10) / scale + 4
    if ((n.x - wx) ** 2 + (n.y - wy) ** 2 <= r * r) return n
  }
  return null
}

// ── Main component ────────────────────────────────────────────────────────────
export default function Graph({ onNoteClick }) {
  const wrapRef  = useRef(null)
  const canvasRef = useRef(null)
  const gRef     = useRef({
    nodes: [], edges: [], nodeMap: new Map(),
    transform: { x: 0, y: 0, scale: 1 },
    hoveredId: null, selectedId: null,
    drag: null, ticksDone: 0,
  })
  const rafRef   = useRef(null)
  const [loading,   setLoading]   = useState(true)
  const [selected,  setSelected]  = useState(null)   // for the info panel (React state)

  // ── Load notes ──────────────────────────────────────────────────────────────
  useEffect(() => {
    fetchNotes().then(notes => {
      const { nodes, edges } = buildGraph(notes)
      const g = gRef.current
      g.nodes   = nodes
      g.edges   = edges
      g.nodeMap = new Map(nodes.map(n => [n.id, n]))
      g.ticksDone = 0
      setLoading(false)
    }).catch(console.error)
  }, [])

  // ── Canvas loop ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (loading) return
    const canvas = canvasRef.current
    const wrap   = wrapRef.current
    if (!canvas || !wrap) return
    const ctx = canvas.getContext('2d')
    const g   = gRef.current

    function sizeCanvas() {
      canvas.width  = wrap.clientWidth
      canvas.height = wrap.clientHeight
      if (g.transform.x === 0 && g.transform.y === 0) {
        g.transform.x = canvas.width  / 2
        g.transform.y = canvas.height / 2
      }
    }
    sizeCanvas()
    const ro = new ResizeObserver(sizeCanvas)
    ro.observe(wrap)

    function loop() {
      if (g.ticksDone < 280) {
        tick(g.nodes, g.edges, g.nodeMap)
        g.ticksDone++
      }
      render(
        ctx, canvas.width, canvas.height,
        g.nodes, g.edges, g.nodeMap,
        g.transform, g.hoveredId, g.selectedId,
      )
      rafRef.current = requestAnimationFrame(loop)
    }
    rafRef.current = requestAnimationFrame(loop)

    // ── Pointer events ────────────────────────────────────────────────────────
    function coords(e) {
      const r = canvas.getBoundingClientRect()
      return { cx: e.clientX - r.left, cy: e.clientY - r.top }
    }

    function onMove(e) {
      const { cx, cy } = coords(e)
      if (g.drag) {
        g.transform.x = g.drag.tx + (cx - g.drag.cx)
        g.transform.y = g.drag.ty + (cy - g.drag.cy)
        return
      }
      const n = hitTest(g.nodes, cx, cy, g.transform, g.transform.scale)
      g.hoveredId        = n ? n.id : null
      canvas.style.cursor = n ? 'pointer' : 'grab'
    }

    function onDown(e) {
      if (e.button !== 0) return
      e.preventDefault()
      const { cx, cy } = coords(e)
      if (!hitTest(g.nodes, cx, cy, g.transform, g.transform.scale)) {
        g.drag = { cx, cy, tx: g.transform.x, ty: g.transform.y }
        canvas.style.cursor = 'grabbing'
      }
    }

    function onUp(e) {
      const { cx, cy } = coords(e)
      if (g.drag) {
        const moved = Math.hypot(cx - g.drag.cx, cy - g.drag.cy) > 4
        g.drag = null
        canvas.style.cursor = 'grab'
        if (!moved) { g.selectedId = null; setSelected(null) }
        return
      }
      const n = hitTest(g.nodes, cx, cy, g.transform, g.transform.scale)
      if (n) { g.selectedId = n.id; setSelected(n) }
    }

    function onWheel(e) {
      e.preventDefault()
      const { cx, cy } = coords(e)
      const factor = e.deltaY < 0 ? 1.12 : 0.89
      const oldS   = g.transform.scale
      const newS   = Math.max(0.15, Math.min(4, oldS * factor))
      g.transform.x = cx - (cx - g.transform.x) * (newS / oldS)
      g.transform.y = cy - (cy - g.transform.y) * (newS / oldS)
      g.transform.scale = newS
    }

    // ── Touch events ──────────────────────────────────────────────────────────
    let lastTouchDist = null

    function touchCoords(e) {
      const r = canvas.getBoundingClientRect()
      return { cx: e.touches[0].clientX - r.left, cy: e.touches[0].clientY - r.top }
    }

    function onTouchStart(e) {
      if (e.touches.length === 2) {
        const dx = e.touches[0].clientX - e.touches[1].clientX
        const dy = e.touches[0].clientY - e.touches[1].clientY
        lastTouchDist = Math.hypot(dx, dy)
        return
      }
      const { cx, cy } = touchCoords(e)
      if (!hitTest(g.nodes, cx, cy, g.transform, g.transform.scale)) {
        g.drag = { cx, cy, tx: g.transform.x, ty: g.transform.y }
      }
    }

    function onTouchMove(e) {
      e.preventDefault()
      if (e.touches.length === 2 && lastTouchDist) {
        const dx  = e.touches[0].clientX - e.touches[1].clientX
        const dy  = e.touches[0].clientY - e.touches[1].clientY
        const d   = Math.hypot(dx, dy)
        const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2 - canvas.getBoundingClientRect().left
        const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2 - canvas.getBoundingClientRect().top
        const factor = d / lastTouchDist
        const oldS = g.transform.scale
        const newS = Math.max(0.15, Math.min(4, oldS * factor))
        g.transform.x = midX - (midX - g.transform.x) * (newS / oldS)
        g.transform.y = midY - (midY - g.transform.y) * (newS / oldS)
        g.transform.scale = newS
        lastTouchDist = d
        return
      }
      if (g.drag) {
        const { cx, cy } = touchCoords(e)
        g.transform.x = g.drag.tx + (cx - g.drag.cx)
        g.transform.y = g.drag.ty + (cy - g.drag.cy)
      }
    }

    function onTouchEnd(e) {
      lastTouchDist = null
      if (e.changedTouches.length === 1 && !g.drag) {
        const r  = canvas.getBoundingClientRect()
        const cx = e.changedTouches[0].clientX - r.left
        const cy = e.changedTouches[0].clientY - r.top
        const n  = hitTest(g.nodes, cx, cy, g.transform, g.transform.scale)
        if (n) { g.selectedId = n.id; setSelected(n) }
        else   { g.selectedId = null; setSelected(null) }
      }
      g.drag = null
    }

    canvas.addEventListener('mousemove',  onMove)
    canvas.addEventListener('mousedown',  onDown)
    canvas.addEventListener('mouseup',    onUp)
    canvas.addEventListener('wheel',      onWheel,      { passive: false })
    canvas.addEventListener('touchstart', onTouchStart, { passive: true })
    canvas.addEventListener('touchmove',  onTouchMove,  { passive: false })
    canvas.addEventListener('touchend',   onTouchEnd,   { passive: true })
    canvas.style.cursor = 'grab'

    return () => {
      cancelAnimationFrame(rafRef.current)
      ro.disconnect()
      canvas.removeEventListener('mousemove',  onMove)
      canvas.removeEventListener('mousedown',  onDown)
      canvas.removeEventListener('mouseup',    onUp)
      canvas.removeEventListener('wheel',      onWheel)
      canvas.removeEventListener('touchstart', onTouchStart)
      canvas.removeEventListener('touchmove',  onTouchMove)
      canvas.removeEventListener('touchend',   onTouchEnd)
    }
  }, [loading])

  // ── Reshuffle ───────────────────────────────────────────────────────────────
  function reshuffle() {
    const g = gRef.current
    for (const n of g.nodes) {
      n.x = (Math.random() - 0.5) * 400
      n.y = (Math.random() - 0.5) * 400
      n.vx = 0; n.vy = 0
    }
    g.ticksDone = 0
  }

  // ── Info panel ──────────────────────────────────────────────────────────────
  const noteCount = gRef.current.nodes.filter(n => n.type === 'note').length
  const tagCount  = gRef.current.nodes.filter(n => n.type === 'tag').length

  return (
    <div className="graph-page">
      {/* Header */}
      <div className="graph-header">
        <div className="graph-header-left">
          <span className="graph-stat"><span className="graph-dot note" />Notes  <b>{gRef.current.nodes.filter(n => n.type === 'note' && !['claude','gemini'].includes(n.source)).length}</b></span>
          <span className="graph-stat"><span className="graph-dot claude"/>Claude <b>{gRef.current.nodes.filter(n => n.source === 'claude').length}</b></span>
          <span className="graph-stat"><span className="graph-dot gemini"/>Gemini <b>{gRef.current.nodes.filter(n => n.source === 'gemini').length}</b></span>
          <span className="graph-stat"><span className="graph-dot tag"  />Tags   <b>{tagCount}</b></span>
        </div>
        <div className="graph-header-right">
          <span className="graph-hint hide-mobile">Scroll to zoom · Drag to pan · Click to select</span>
          <button className="graph-reshuffle-btn" onClick={reshuffle} title="Re-run layout">
            ↺ Re-layout
          </button>
        </div>
      </div>

      {/* Canvas */}
      <div ref={wrapRef} className="graph-wrap">
        {loading ? (
          <div className="graph-loading">Building graph…</div>
        ) : (
          <canvas ref={canvasRef} className="graph-canvas" />
        )}

        {/* Info panel */}
        {selected && (
          <div className="graph-info-panel">
            <button
              className="graph-info-close"
              onClick={() => { gRef.current.selectedId = null; setSelected(null) }}
            >×</button>

            <div className="graph-info-type">
              {selected.type === 'tag' ? '🏷 Tag'
               : selected.source === 'claude' ? '🤖 Claude Chat'
               : selected.source === 'gemini' ? '✦ Gemini Chat'
               : '📝 Note'}
            </div>
            <div className="graph-info-label">{selected.label}</div>

            {selected.type === 'note' && selected.note && (
              <>
                {selected.note.tags?.length > 0 && (
                  <div className="graph-info-tags">
                    {selected.note.tags.map(t => (
                      <span key={t} className="note-tag-mini">#{t}</span>
                    ))}
                  </div>
                )}
                {selected.note.body && (
                  <div className="graph-info-snippet">
                    {selected.note.body.replace(/[#*_`>]/g, '').slice(0, 120)}…
                  </div>
                )}
                <button className="graph-open-btn" onClick={() => onNoteClick(selected.id)}>
                  Open note →
                </button>
              </>
            )}

            {selected.type === 'tag' && (
              <div className="graph-info-snippet">
                {gRef.current.nodes
                  .filter(n => n.type === 'note' && n.note?.tags?.includes(selected.label))
                  .length} note{
                    gRef.current.nodes.filter(n => n.type === 'note' && n.note?.tags?.includes(selected.label)).length !== 1 ? 's' : ''
                  } tagged
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
