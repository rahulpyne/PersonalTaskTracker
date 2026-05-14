import { useState, useEffect, useCallback } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import Sidebar from './components/Sidebar'
import TaskCard from './components/TaskCard'
import EditModal from './components/EditModal'
import Insights from './components/Insights'
import AuditLog from './components/AuditLog'
import Settings from './components/Settings'
import {
  fetchTasks, fetchAuditLog,
  createTask, updateTask, deleteTask, toggleComplete,
  restoreSnapshot,
  subscribeToTasks, subscribeToAudit,
} from './lib/tasks'

const PAGE_TITLES = {
  all: 'All Tasks', today: 'Today', work: 'Work', personal: 'Personal',
  insights: 'Insights', audit: 'Audit Log', settings: 'Settings',
}

const PAGE_TRANSITION = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit:    { opacity: 0, y: -6 },
  transition: { duration: .22, ease: [0.22, 1, 0.36, 1] },
}

export default function App() {
  const [tasks,    setTasks]    = useState([])
  const [auditLog, setAuditLog] = useState([])
  const [view,     setView]     = useState('all')
  const [editTask, setEditTask] = useState(null)
  const [adding,   setAdding]   = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState(null)

  // ── Initial load ──────────────────────────────────────────────
  useEffect(() => {
    Promise.all([fetchTasks(), fetchAuditLog()])
      .then(([t, a]) => { setTasks(t); setAuditLog(a) })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  // ── Realtime subscriptions ────────────────────────────────────
  useEffect(() => {
    const unsub1 = subscribeToTasks(() => {
      fetchTasks().then(setTasks).catch(console.error)
    })
    const unsub2 = subscribeToAudit(() => {
      fetchAuditLog().then(setAuditLog).catch(console.error)
    })
    return () => { unsub1(); unsub2() }
  }, [])

  // ── CRUD ──────────────────────────────────────────────────────
  const handleCreateQuick = async e => {
    if (e.key !== 'Enter' || !newTitle.trim()) return
    const optimistic = { id: `tmp-${Date.now()}`, title: newTitle, category: 'work', completed: false, created_at: new Date().toISOString() }
    setTasks(t => [optimistic, ...t])
    setNewTitle('')
    setAdding(false)
    try {
      const created = await createTask({ title: optimistic.title, category: 'work', priority: 'medium' })
      setTasks(t => t.map(x => x.id === optimistic.id ? created : x))
    } catch {
      setTasks(t => t.filter(x => x.id !== optimistic.id))
    }
  }

  const handleSaveModal = async fields => {
    if (editTask === true) {
      const optimistic = { id: `tmp-${Date.now()}`, ...fields, completed: false, created_at: new Date().toISOString() }
      setTasks(t => [optimistic, ...t])
      setEditTask(null)
      try {
        const created = await createTask(fields)
        setTasks(t => t.map(x => x.id === optimistic.id ? created : x))
      } catch {
        setTasks(t => t.filter(x => x.id !== optimistic.id))
      }
    } else {
      const prev = tasks.find(t => t.id === editTask.id)
      setTasks(t => t.map(x => x.id === editTask.id ? { ...x, ...fields } : x))
      setEditTask(null)
      try {
        await updateTask(editTask.id, fields)
      } catch {
        setTasks(t => t.map(x => x.id === editTask.id ? prev : x))
      }
    }
  }

  const handleToggle = async task => {
    const next = !task.completed
    setTasks(t => t.map(x => x.id === task.id ? { ...x, completed: next } : x))
    try {
      await toggleComplete(task.id, next)
    } catch {
      setTasks(t => t.map(x => x.id === task.id ? { ...x, completed: task.completed } : x))
    }
  }

  const handleDelete = async id => {
    const prev = tasks.find(t => t.id === id)
    setTasks(t => t.filter(x => x.id !== id))
    try {
      await deleteTask(id)
    } catch {
      setTasks(t => [prev, ...t])
    }
  }

  const handleRestore = async entry => {
    try {
      await restoreSnapshot(entry)
      const updated = await fetchTasks()
      setTasks(updated)
    } catch (e) {
      alert('Restore failed: ' + e.message)
    }
  }

  // ── Filtered list ──────────────────────────────────────────────
  const visibleTasks = tasks.filter(t => {
    if (view === 'today') {
      const today = new Date().toDateString()
      return t.due_date && new Date(t.due_date).toDateString() === today
    }
    if (view === 'work')     return t.category === 'work'
    if (view === 'personal') return t.category === 'personal'
    return true
  })

  const pending   = visibleTasks.filter(t => !t.completed)
  const completed = visibleTasks.filter(t => t.completed)

  // ── Render ────────────────────────────────────────────────────
  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100dvh', color: 'var(--muted)' }}>
        Loading…
      </div>
    )
  }

  if (error) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100dvh', color: 'var(--danger)', flexDirection: 'column', gap: 8 }}>
        <strong>Connection error</strong>
        <span style={{ fontSize: 13 }}>{error}</span>
      </div>
    )
  }

  const isTaskView = ['all', 'today', 'work', 'personal'].includes(view)

  return (
    <div className="layout">
      <Sidebar view={view} setView={setView} tasks={tasks} />

      <main className="main-content">
        <AnimatePresence mode="wait">
          <motion.div key={view} {...PAGE_TRANSITION}>
            <div className="page-header">
              <h1 className="page-title">{PAGE_TITLES[view]}</h1>
              {isTaskView && (
                <button className="btn btn-primary" onClick={() => setEditTask(true)}>
                  + New Task
                </button>
              )}
            </div>

            {view === 'insights' && <Insights tasks={tasks} />}
            {view === 'audit'    && <AuditLog log={auditLog} onRestore={handleRestore} />}
            {view === 'settings' && <Settings />}

            {isTaskView && (
              <>
                {/* Quick-add */}
                {adding ? (
                  <div className="add-task-row">
                    <input
                      className="add-task-input"
                      placeholder="Task title… (Enter to save, Esc to cancel)"
                      autoFocus
                      value={newTitle}
                      onChange={e => setNewTitle(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') handleCreateQuick(e)
                        if (e.key === 'Escape') { setAdding(false); setNewTitle('') }
                      }}
                    />
                  </div>
                ) : (
                  <div className="add-task-row" onClick={() => setAdding(true)}>
                    <span>+</span> Add task…
                  </div>
                )}

                {/* Task lists */}
                <AnimatePresence>
                  {pending.length === 0 && completed.length === 0 && (
                    <motion.div className="empty-state" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                      <div className="empty-icon">◈</div>
                      <div className="empty-label">No tasks here</div>
                      <div className="empty-sub">Click "+ New Task" or the row above to add one.</div>
                    </motion.div>
                  )}
                </AnimatePresence>

                <div className="task-list">
                  <AnimatePresence>
                    {pending.map(t => (
                      <TaskCard
                        key={t.id}
                        task={t}
                        onToggle={handleToggle}
                        onEdit={setEditTask}
                        onDelete={handleDelete}
                      />
                    ))}
                  </AnimatePresence>
                </div>

                {completed.length > 0 && (
                  <>
                    <div className="task-group-label">Completed · {completed.length}</div>
                    <div className="task-list">
                      <AnimatePresence>
                        {completed.map(t => (
                          <TaskCard
                            key={t.id}
                            task={t}
                            onToggle={handleToggle}
                            onEdit={setEditTask}
                            onDelete={handleDelete}
                          />
                        ))}
                      </AnimatePresence>
                    </div>
                  </>
                )}
              </>
            )}
          </motion.div>
        </AnimatePresence>
      </main>

      <EditModal
        task={editTask}
        onSave={handleSaveModal}
        onClose={() => setEditTask(null)}
      />
    </div>
  )
}
