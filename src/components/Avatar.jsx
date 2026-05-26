import { computeStreak } from '../lib/history'

const MOOD_LABELS = ['Burnout', 'Exhausted', 'Grinding', 'Steady', 'Energized']
const MOOD_BLURBS = [
  'Stack is heavy — close a small one first.',
  'Knock out a couple of lows; rebuild momentum.',
  'Heads down. Keep moving.',
  'Good rhythm. Stay with it.',
  'On fire. Compound the streak.',
]

export function computeMood({ tasks, history, subtasksByParent = {} }) {
  const W = { high: 3, medium: 2, low: 1 }
  let doneW = 0, pendW = 0, highPend = 0, recentDoneW = 0
  const now = Date.now()
  const DAY = 86_400_000

  tasks.forEach(t => {
    const w = W[t.prio] || 1
    if (t.done) {
      doneW += w
      if (t.completed && (now - t.completed) < 3 * DAY) recentDoneW += w
    } else {
      pendW += w
      if (t.prio === 'high') highPend++
    }

    // AI subtask weights contribute to avatar mood at 40% of a full task
    const subs = subtasksByParent[t.id] ?? []
    subs.forEach(s => {
      const sw = (s.weight ?? 2) * 0.4
      if (s.done) {
        doneW += sw
        if (s.completed && (now - s.completed) < 3 * DAY) recentDoneW += sw
      } else if (!t.done) {
        pendW += sw * 0.5  // half-weight for pending subtasks
      }
    })
  })

  const ratio    = (doneW + recentDoneW * 0.6) / Math.max(1, doneW + pendW + recentDoneW * 0.6)
  const last3    = history.daily.slice(-3).reduce((a, b) => a + b.count, 0) / 3
  const baseline = history.daily.reduce((a, b) => a + b.count, 0) / history.daily.length
  const recent   = Math.max(-1, Math.min(1, (last3 - baseline) / (baseline + 1)))
  const streak   = computeStreak(history.daily)
  const streakF  = Math.min(streak / 7, 1)
  const pressure = Math.min(highPend / 4, 1)

  let score = (ratio - 0.45) * 1.6 + recent * 0.45 + streakF * 0.4 - pressure * 0.85
  score = Math.max(-1, Math.min(1, score))
  return { mood: Math.round((score + 1) / 2 * 4) }
}

function ManAvatar({ mood }) {
  const m = Math.max(0, Math.min(4, mood))
  const showDrop = m <= 1

  const expressions = [
    {
      brows: <g stroke="#3a2a1f" strokeWidth="2.4" strokeLinecap="round" fill="none"><path d="M68 86 Q78 92 88 90"/><path d="M112 90 Q122 92 132 86"/></g>,
      eyes: <g><ellipse cx="78" cy="106" rx="9" ry="3" fill="#a87863" opacity=".55"/><ellipse cx="122" cy="106" rx="9" ry="3" fill="#a87863" opacity=".55"/><path d="M70 100 Q78 104 86 100" stroke="#241814" strokeWidth="2.2" strokeLinecap="round" fill="none"/><path d="M114 100 Q122 104 130 100" stroke="#241814" strokeWidth="2.2" strokeLinecap="round" fill="none"/></g>,
      mouth: <path d="M88 138 Q100 134 112 138" stroke="#3a2118" strokeWidth="2.4" strokeLinecap="round" fill="none"/>,
      extras: null,
    },
    {
      brows: <g stroke="#3a2a1f" strokeWidth="2.4" strokeLinecap="round" fill="none"><path d="M68 84 Q78 86 88 90"/><path d="M112 90 Q122 86 132 84"/></g>,
      eyes: <g><ellipse cx="78" cy="105" rx="7" ry="2.4" fill="#a87863" opacity=".4"/><ellipse cx="122" cy="105" rx="7" ry="2.4" fill="#a87863" opacity=".4"/><path d="M70 98 Q78 102 86 98" stroke="#241814" strokeWidth="2.2" strokeLinecap="round" fill="none"/><path d="M114 98 Q122 102 130 98" stroke="#241814" strokeWidth="2.2" strokeLinecap="round" fill="none"/><circle cx="78" cy="100" r="1.4" fill="#241814"/><circle cx="122" cy="100" r="1.4" fill="#241814"/></g>,
      mouth: <path d="M88 136 Q100 132 112 136" stroke="#3a2118" strokeWidth="2.4" strokeLinecap="round" fill="none"/>,
      extras: null,
    },
    {
      brows: <g stroke="#3a2a1f" strokeWidth="2.4" strokeLinecap="round" fill="none"><path d="M68 84 L88 84"/><path d="M112 84 L132 84"/></g>,
      eyes: <g><ellipse cx="78" cy="98" rx="5" ry="4.2" fill="#fff" stroke="#241814" strokeWidth="1.6"/><ellipse cx="122" cy="98" rx="5" ry="4.2" fill="#fff" stroke="#241814" strokeWidth="1.6"/><circle cx="78" cy="99" r="2.4" fill="#3a5a78"/><circle cx="122" cy="99" r="2.4" fill="#3a5a78"/><circle cx="79" cy="98" r="0.9" fill="#fff"/><circle cx="123" cy="98" r="0.9" fill="#fff"/></g>,
      mouth: <path d="M88 134 L112 134" stroke="#3a2118" strokeWidth="2.4" strokeLinecap="round" fill="none"/>,
      extras: null,
    },
    {
      brows: <g stroke="#3a2a1f" strokeWidth="2.4" strokeLinecap="round" fill="none"><path d="M68 82 Q78 80 88 82"/><path d="M112 82 Q122 80 132 82"/></g>,
      eyes: <g><ellipse cx="78" cy="98" rx="5.4" ry="4.6" fill="#fff" stroke="#241814" strokeWidth="1.6"/><ellipse cx="122" cy="98" rx="5.4" ry="4.6" fill="#fff" stroke="#241814" strokeWidth="1.6"/><circle cx="78" cy="98" r="2.6" fill="#3a5a78"/><circle cx="122" cy="98" r="2.6" fill="#3a5a78"/><circle cx="79" cy="97" r="1" fill="#fff"/><circle cx="123" cy="97" r="1" fill="#fff"/></g>,
      mouth: <g><path d="M84 130 Q100 142 116 130" stroke="#3a2118" strokeWidth="2.4" strokeLinecap="round" fill="none"/><path d="M86 132 Q100 138 114 132" stroke="#d28b7a" strokeWidth="1.2" strokeLinecap="round" fill="none" opacity=".7"/></g>,
      extras: null,
    },
    {
      brows: <g stroke="#3a2a1f" strokeWidth="2.4" strokeLinecap="round" fill="none"><path d="M68 80 Q78 76 88 80"/><path d="M112 80 Q122 76 132 80"/></g>,
      eyes: <g><path d="M70 100 Q78 92 86 100" stroke="#241814" strokeWidth="2.4" strokeLinecap="round" fill="none"/><path d="M114 100 Q122 92 130 100" stroke="#241814" strokeWidth="2.4" strokeLinecap="round" fill="none"/><ellipse cx="68" cy="118" rx="6" ry="3" fill="#f0a89a" opacity=".55"/><ellipse cx="132" cy="118" rx="6" ry="3" fill="#f0a89a" opacity=".55"/></g>,
      mouth: <g><path d="M80 128 Q100 148 120 128" stroke="#3a2118" strokeWidth="2.6" strokeLinecap="round" fill="#c9695f"/><path d="M84 132 Q100 140 116 132" stroke="none" fill="#ffffff"/></g>,
      extras: <g>
        <g style={{ transformOrigin: '40px 60px', animation: 'twinkle 2.4s ease-in-out infinite' }}><path d="M40 56 L40 64 M36 60 L44 60" stroke="oklch(0.78 0.18 90)" strokeWidth="1.6" strokeLinecap="round"/></g>
        <g style={{ transformOrigin: '160px 70px', animation: 'twinkle 2.4s .6s ease-in-out infinite' }}><path d="M160 66 L160 74 M156 70 L164 70" stroke="oklch(0.78 0.18 90)" strokeWidth="1.6" strokeLinecap="round"/></g>
        <g style={{ transformOrigin: '30px 100px', animation: 'twinkle 2.4s 1.1s ease-in-out infinite' }}><circle cx="30" cy="100" r="2" fill="oklch(0.78 0.18 90)"/></g>
      </g>,
    },
  ]

  return (
    <div className="avatar" data-mood={m} aria-label={`Mood: ${MOOD_LABELS[m]}`} role="img">
      <div className="ring" />
      <svg viewBox="0 0 200 200">
        <defs>
          <radialGradient id="bgRad" cx="50%" cy="40%" r="60%">
            <stop offset="0%" stopColor="oklch(0.97 0.012 80)" />
            <stop offset="100%" stopColor="oklch(0.9 0.015 80)" />
          </radialGradient>
          <clipPath id="circ"><circle cx="100" cy="100" r="92" /></clipPath>
        </defs>
        <g clipPath="url(#circ)">
          <rect width="200" height="200" fill="url(#bgRad)" />
          <path d="M28 200 Q40 158 78 152 L122 152 Q160 158 172 200 Z" fill="#4a6886" />
          <path d="M92 152 L100 170 L108 152" fill="#3a5878" />
          <line x1="100" y1="160" x2="100" y2="178" stroke="#2c4a68" strokeWidth="1.2" />
          <circle cx="100" cy="166" r="1.4" fill="#2c4a68" />
          <circle cx="100" cy="174" r="1.4" fill="#2c4a68" />
          <path d="M84 148 Q100 156 116 148 L116 138 L84 138 Z" fill="#e8b896" />
          <path d="M84 148 Q100 156 116 148 L116 144 L84 144 Z" fill="#c89a7c" opacity=".55" />
          <ellipse cx="56" cy="100" rx="6" ry="9" fill="#e8b896" />
          <ellipse cx="144" cy="100" rx="6" ry="9" fill="#e8b896" />
          <path d="M55 100 Q58 102 56 106" stroke="#c89a7c" strokeWidth="1" fill="none" />
          <path d="M145 100 Q142 102 144 106" stroke="#c89a7c" strokeWidth="1" fill="none" />
          <ellipse cx="100" cy="100" rx="42" ry="48" fill="#f0c8a8" />
          <path d="M62 110 Q70 138 100 144 Q130 138 138 110" fill="#d8a888" opacity=".35" />
          <path d="M60 88 Q58 62 86 54 Q102 48 122 56 Q138 62 140 88 Q138 76 128 72 Q118 80 102 78 Q86 80 76 72 Q66 76 60 88 Z" fill="#5a3a22" />
          <path d="M82 60 Q98 54 116 58 Q114 62 100 62 Q88 62 82 60 Z" fill="#7a5232" opacity=".7" />
          <path d="M122 56 Q132 62 138 80" stroke="#7a5232" strokeWidth="2" fill="none" opacity=".6" />
          <g fill="none" stroke="#1f2a3a" strokeWidth="2.8" strokeLinejoin="round">
            <rect x="62" y="88" width="32" height="22" rx="9" />
            <rect x="106" y="88" width="32" height="22" rx="9" />
            <path d="M94 96 Q100 92 106 96" />
            <line x1="62" y1="92" x2="56" y2="94" />
            <line x1="138" y1="92" x2="144" y2="94" />
          </g>
          <rect x="64" y="90" width="28" height="18" rx="7" fill="#cfe0f0" opacity=".18" />
          <rect x="108" y="90" width="28" height="18" rx="7" fill="#cfe0f0" opacity=".18" />

          {showDrop && (
            <g>
              <ellipse cx="140" cy="70" rx="2.2" ry="3.4" fill="#7fb6e0"
                style={{ animation: `drop ${m === 0 ? 1.6 : 2.2}s ${m === 0 ? 0 : 0.3}s ease-in-out infinite`, transformOrigin: '140px 70px' }} />
              {m === 0 && <ellipse cx="56" cy="80" rx="2" ry="3" fill="#7fb6e0"
                style={{ animation: 'drop 1.9s .7s ease-in-out infinite', transformOrigin: '56px 80px' }} />}
            </g>
          )}

          {expressions.map((ex, i) => (
            <g key={i} style={{ opacity: Math.abs(i - m) === 0 ? 1 : 0, transition: 'opacity .55s ease' }}>
              {ex.brows}{ex.eyes}{ex.mouth}{ex.extras}
            </g>
          ))}
        </g>
        <circle cx="100" cy="100" r="92" fill="none" stroke="oklch(0.85 0.008 80)" strokeWidth="2" />
      </svg>
    </div>
  )
}

export function ReactiveAvatar({ tasks, history, compact = false }) {
  const { mood } = computeMood({ tasks, history })
  if (compact) {
    return <div className="avatar-wrap mhead-avatar"><ManAvatar mood={mood} /></div>
  }
  return (
    <div className="avatar-wrap head-avatar">
      <ManAvatar mood={mood} />
      <div className="avatar-caption"><b>{MOOD_LABELS[mood]}</b> · {MOOD_BLURBS[mood]}</div>
    </div>
  )
}
