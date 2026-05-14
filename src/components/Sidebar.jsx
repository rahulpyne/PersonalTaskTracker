import { motion } from 'framer-motion'

const VIEWS = [
  { id: 'all',      label: 'All Tasks',  icon: '◈' },
  { id: 'today',    label: 'Today',      icon: '◉' },
  { id: 'work',     label: 'Work',       icon: '◧' },
  { id: 'personal', label: 'Personal',   icon: '◦' },
  { id: 'insights', label: 'Insights',   icon: '◌' },
  { id: 'audit',    label: 'Audit Log',  icon: '◎' },
  { id: 'settings', label: 'Settings',   icon: '◫' },
]

export default function Sidebar({ view, setView, tasks }) {
  const count = (v) => {
    if (v === 'all') return tasks.filter(t => !t.completed).length
    if (v === 'today') {
      const today = new Date().toDateString()
      return tasks.filter(t => !t.completed && t.due_date && new Date(t.due_date).toDateString() === today).length
    }
    if (v === 'work')     return tasks.filter(t => !t.completed && t.category === 'work').length
    if (v === 'personal') return tasks.filter(t => !t.completed && t.category === 'personal').length
    return null
  }

  return (
    <nav className="sidebar">
      <div className="sidebar-logo">Tasks</div>

      <div className="sidebar-section">
        {VIEWS.slice(0, 4).map(v => {
          const n = count(v.id)
          return (
            <motion.button
              key={v.id}
              className={`sidebar-item ${view === v.id ? 'active' : ''}`}
              onClick={() => setView(v.id)}
              whileTap={{ scale: .97 }}
            >
              <span style={{ fontSize: 16 }}>{v.icon}</span>
              {v.label}
              {n > 0 && <span className="sidebar-count">{n}</span>}
            </motion.button>
          )
        })}
      </div>

      <div className="sidebar-section">
        <div className="sidebar-label">More</div>
        {VIEWS.slice(4).map(v => (
          <motion.button
            key={v.id}
            className={`sidebar-item ${view === v.id ? 'active' : ''}`}
            onClick={() => setView(v.id)}
            whileTap={{ scale: .97 }}
          >
            <span style={{ fontSize: 16 }}>{v.icon}</span>
            {v.label}
          </motion.button>
        ))}
      </div>
    </nav>
  )
}
