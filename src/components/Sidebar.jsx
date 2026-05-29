import { IconList, IconBars, CatIcon, Flame, IconNote } from './Icons'
import { computeStreak } from '../lib/history'

function Logo({ size = 38 }) {
  return (
    <span className="logo" aria-label="Rahul Pyne" role="img" style={{ width: size, height: size, flexBasis: size }}>
      <svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="rp-sheen" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#2b2926" />
            <stop offset="100%" stopColor="#161412" />
          </linearGradient>
        </defs>
        <rect x="0" y="0" width="48" height="48" rx="11" fill="url(#rp-sheen)" />
        <path d="M21 8.5 L24 5 L27 8.5" fill="none" stroke="#f7f5f1" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" opacity="0.55" />
        <text x="24" y="33" textAnchor="middle" fontFamily="Instrument Serif, serif" fontSize="27" fill="#f7f5f1">
          <tspan fontStyle="italic" dx="-0.5">R</tspan>
          <tspan dx="-3">P</tspan>
        </text>
        <line x1="14" y1="40" x2="34" y2="40" stroke="#f7f5f1" strokeWidth="1" opacity="0.4" />
        <circle cx="14" cy="40" r="0.9" fill="#f7f5f1" opacity="0.6" />
        <circle cx="34" cy="40" r="0.9" fill="#f7f5f1" opacity="0.6" />
      </svg>
    </span>
  )
}

function Brand({ showValues = true }) {
  return (
    <div className="brand">
      <Logo />
      <div className="name">
        <div className="who">Rahul <em>Pyne</em></div>
        {showValues && <div className="values"><b>Lead</b> · <b>Discipline</b> · <b>Work</b></div>}
      </div>
    </div>
  )
}

export default function Sidebar({ view, setView, cat, setCat, tasks, history, noteCount = 0 }) {
  const streak = computeStreak(history.daily)
  const counts = {
    all:      tasks.length,
    work:     tasks.filter(t => t.cat === 'work').length,
    personal: tasks.filter(t => t.cat === 'personal').length,
    todo:     tasks.filter(t => !t.done).length,
  }

  return (
    <aside className="sidebar">
      <Brand />

      <div className="side-section">
        <div className="side-label">View</div>
        <button className={`side-item ${view === 'tasks' ? 'active' : ''}`} onClick={() => setView('tasks')}>
          <IconList size={15} /> Tasks
          <span className="count">{counts.todo}</span>
        </button>
        <button className={`side-item ${view === 'insights' ? 'active' : ''}`} onClick={() => setView('insights')}>
          <IconBars size={15} /> Insights
        </button>
        <button className={`side-item ${view === 'fitness' ? 'active' : ''}`} onClick={() => setView('fitness')}>
          ⚡ Fitness
        </button>
        <button className={`side-item ${view === 'notes' ? 'active' : ''}`} onClick={() => setView('notes')}>
          <IconNote size={15} /> Notes
          {noteCount > 0 && <span className="count">{noteCount}</span>}
        </button>
      </div>

      <div className="side-section">
        <div className="side-label">Categories</div>
        <button className={`side-item ${cat === 'all' ? 'active' : ''}`} onClick={() => { setCat('all'); setView('tasks') }}>
          <CatIcon cat="all" /> All
          <span className="count">{counts.all}</span>
        </button>
        <button className={`side-item ${cat === 'work' ? 'active' : ''}`} onClick={() => { setCat('work'); setView('tasks') }}>
          <CatIcon cat="work" /> Work
          <span className="count">{counts.work}</span>
        </button>
        <button className={`side-item ${cat === 'personal' ? 'active' : ''}`} onClick={() => { setCat('personal'); setView('tasks') }}>
          <CatIcon cat="personal" /> Personal
          <span className="count">{counts.personal}</span>
        </button>
      </div>

      <div className="side-foot">
        <div style={{ fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: '.14em', textTransform: 'uppercase', marginBottom: 6, color: 'var(--ink-2)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <Flame alive={streak > 0} size={12} /> Streak
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
          <span style={{ fontFamily: 'var(--serif)', fontSize: 34, color: 'var(--ink)', lineHeight: 1 }}>{streak}</span>
          <span style={{ fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: '.1em', textTransform: 'uppercase' }}>days</span>
        </div>
      </div>
    </aside>
  )
}

export { Brand, Logo }
