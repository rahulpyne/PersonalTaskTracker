import { useState, useEffect, useMemo, useCallback } from 'react'
import Sidebar, { Brand } from './components/Sidebar'
import { TaskList, Composer } from './components/TaskList'
import Insights from './components/Insights'
import { ReactiveAvatar } from './components/Avatar'
import { IconList, IconBars, CatIcon } from './components/Icons'
import FitnessDashboard from './pages/FitnessDashboard'
import Notes from './pages/Notes'
import Graph from './pages/Graph'
import { toUI, toDB, toDBToggle } from './lib/adapter'
import { buildHistory } from './lib/history'
import { fetchTasks, createTask, updateTask, deleteTask, clearCompleted, markCleared, filterCleared, fetchTaskDailyStats, recordTaskStat, subscribeToTasks } from './lib/tasks'
import { fetchNotes } from './lib/notes'

const TODAY_LABEL = new Date().toLocaleDateString('en', { weekday: 'long', month: 'long', day: 'numeric' })

export default function App() {
  const [dbTasks,    setDbTasks]    = useState([])
  const [dailyStats, setDailyStats] = useState([])
  const [noteCount,  setNoteCount]  = useState(0)
  const [loading,    setLoading]    = useState(true)
  const [error,      setError]      = useState(null)

  const [view,           setView]           = useState(() => localStorage.getItem('tracker:view') || 'tasks')
  const [cat,            setCat]            = useState(() => localStorage.getItem('tracker:cat')  || 'all')
  const [filter,         setFilter]         = useState('all')
  const [graphFocusId,   setGraphFocusId]   = useState(null)

  useEffect(() => { localStorage.setItem('tracker:view', view) }, [view])
  useEffect(() => { localStorage.setItem('tracker:cat',  cat)  }, [cat])

  // ── Load + realtime ────────────────────────────────────────────
  useEffect(() => {
    Promise.all([fetchTasks(), fetchNotes(), fetchTaskDailyStats()])
      .then(([taskRows, noteRows, statsRows]) => {
        setDbTasks(filterCleared(taskRows))
        setNoteCount(noteRows.length)
        setDailyStats(statsRows)
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    const unsub = subscribeToTasks(() => {
      fetchTasks().then(rows => setDbTasks(filterCleared(rows))).catch(console.error)
    })
    return unsub
  }, [])

  // ── Derived UI tasks ───────────────────────────────────────────
  const tasks = useMemo(() => dbTasks.map(toUI), [dbTasks])

  const history = useMemo(() => buildHistory(tasks, dailyStats), [tasks, dailyStats])

  const counts = useMemo(() => ({
    all:      tasks.length,
    work:     tasks.filter(t => t.cat === 'work').length,
    personal: tasks.filter(t => t.cat === 'personal').length,
    todo:     tasks.filter(t => !t.done).length,
    done:     tasks.filter(t => t.done).length,
  }), [tasks])

  const visible = useMemo(() => tasks.filter(t => {
    if (cat !== 'all' && t.cat !== cat) return false
    if (filter === 'todo' && t.done)    return false
    if (filter === 'done' && !t.done)   return false
    return true
  }), [tasks, cat, filter])

  // ── Actions (optimistic) ───────────────────────────────────────
  const onToggle = async (id) => {
    const task = dbTasks.find(t => t.id === id)
    if (!task) return
    const next = !task.done
    const dbFields = toDBToggle(next)
    // Date for the stat: today when completing, or the task's existing done_at when uncompleting
    const statDate = next
      ? new Date().toISOString().slice(0, 10)
      : (task.done_at || new Date().toISOString()).slice(0, 10)
    setDbTasks(ts => ts.map(t => t.id === id ? { ...t, ...dbFields } : t))
    try {
      await updateTask(id, dbFields)
      await recordTaskStat(statDate, task.type || 'personal', next ? 1 : -1)
      // Refresh stats in memory so heatmap/streak update immediately
      fetchTaskDailyStats().then(setDailyStats).catch(() => {})
    } catch {
      fetchTasks().then(rows => setDbTasks(filterCleared(rows)))
    }
  }

  const onDelete = async (id) => {
    const prev = dbTasks.find(t => t.id === id)
    setDbTasks(ts => ts.filter(t => t.id !== id))
    try {
      await deleteTask(id)
    } catch {
      setDbTasks(ts => [prev, ...ts])
    }
  }

  const onSaveNote = async (id, notes) => {
    setDbTasks(ts => ts.map(t => t.id === id ? { ...t, context: notes } : t))
    try {
      await updateTask(id, { context: notes })
    } catch {
      fetchTasks().then(rows => setDbTasks(filterCleared(rows)))
    }
  }

  const onUpdate = async (id, { title, cat, prio }) => {
    // Map UI field names to DB column names (partial update — don't touch context)
    const dbPrio = prio === 'medium' ? 'med' : prio
    setDbTasks(ts => ts.map(t => t.id === id
      ? { ...t, text: title, type: cat, prio: dbPrio }
      : t
    ))
    try {
      await updateTask(id, { text: title, type: cat, prio: dbPrio })
    } catch {
      fetchTasks().then(rows => setDbTasks(filterCleared(rows)))
    }
  }

  const onAdd = async ({ title, cat: c, prio }) => {
    const tmpId = 'tmp-' + Date.now()
    const now   = new Date().toISOString()
    const optimistic = { id: tmpId, title, category: c, priority: prio, completed: false, completed_at: null, created_at: now, notes: '' }
    setDbTasks(ts => [optimistic, ...ts])
    try {
      const created = await createTask(toDB({ title, cat: c, prio, notes: '' }))
      setDbTasks(ts => ts.map(t => t.id === tmpId ? created : t))
    } catch {
      setDbTasks(ts => ts.filter(t => t.id !== tmpId))
    }
  }

  // Used by TaskItem after AI generation to pull fresh embedded subtasks
  const onRefresh = useCallback(() => {
    fetchTasks().then(rows => setDbTasks(filterCleared(rows))).catch(console.error)
  }, [])

  const onClearCompleted = () => {
    const clearedIds = dbTasks.filter(t => t.done).map(t => t.id)
    if (!clearedIds.length) return
    markCleared(clearedIds)
    setDbTasks(ts => ts.filter(t => !t.done))
  }

  // ── Render ─────────────────────────────────────────────────────
  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', color: 'var(--ink-3)', fontFamily: 'var(--mono)', fontSize: 12, letterSpacing: '.1em' }}>
        LOADING…
      </div>
    )
  }

  if (error) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', color: 'var(--bad)', flexDirection: 'column', gap: 8, fontFamily: 'var(--mono)' }}>
        <strong>Connection error</strong>
        <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>{error}</span>
      </div>
    )
  }

  return (
    <div className="app">
      {/* Desktop sidebar */}
      <Sidebar view={view} setView={setView} cat={cat} setCat={setCat} tasks={tasks} history={history} noteCount={noteCount} graphFocusId={graphFocusId} />

      {/* Mobile header */}
      <header className="mhead">
        <Brand showValues={false} />
        <ReactiveAvatar tasks={tasks} history={history} compact />
      </header>

      {/* Mobile filter strip — tasks view only */}
      {view === 'tasks' && (
        <div className="mfilter">
          {['all', 'work', 'personal'].map(c => (
            <button key={c} className={cat === c ? 'active' : ''} onClick={() => { setCat(c); setView('tasks') }}>
              <CatIcon cat={c} size={12} />
              {c.charAt(0).toUpperCase() + c.slice(1)}
              <span style={{ opacity: .6, marginLeft: 4, fontFamily: 'var(--mono)', fontSize: 10 }}>
                {c === 'all' ? counts.all : c === 'work' ? counts.work : counts.personal}
              </span>
            </button>
          ))}
          <span style={{ width: 1, background: 'var(--line)', margin: '4px 4px' }} />
          {['all', 'todo', 'done'].map(f => (
            <button key={f} className={filter === f ? 'active' : ''} onClick={() => setFilter(f)}>
              {f === 'all' ? 'All status' : f === 'todo' ? 'To-do' : 'Done'}
            </button>
          ))}
        </div>
      )}

      {/* Main */}
      <main className="main">
        {view === 'tasks' ? (
          <>
            <div className="head">
              <div>
                <h1>
                  {cat === 'all' ? 'Everything' : cat === 'work' ? 'Work' : 'Personal'}
                  <em>, today</em>
                </h1>
                <div style={{ marginTop: 8, fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--ink-3)', letterSpacing: '.04em' }}>
                  {TODAY_LABEL.toUpperCase()}
                </div>
              </div>
              <div className="meta hide-mobile">
                <div><b>{counts.todo}</b> open · <b>{counts.done}</b> done</div>
                <div>streak <b>{history.daily.filter((_, i, a) => {
                  // quick streak count for display
                  for (let j = a.length - 1; j >= 0; j--) {
                    if (a[j].count === 0) return false
                  }
                  return true
                }).length}d</b></div>
              </div>
              <ReactiveAvatar tasks={tasks} history={history} />
            </div>

            <div className="filters">
              {[
                { id: 'all',  label: 'All',   n: visible.length },
                { id: 'todo', label: 'To-do', n: tasks.filter(t => (cat === 'all' || t.cat === cat) && !t.done).length },
                { id: 'done', label: 'Done',  n: tasks.filter(t => (cat === 'all' || t.cat === cat) && t.done).length },
              ].map(f => (
                <button key={f.id} className={`filter-pill ${filter === f.id ? 'active' : ''}`} onClick={() => setFilter(f.id)}>
                  {f.label} <span className="n">{f.n}</span>
                </button>
              ))}
              <div className="spacer" />
              {counts.done > 0 && (
                <button className="clear" onClick={onClearCompleted}>Clear completed</button>
              )}
            </div>

            <div className="scroll">
              <TaskList tasks={visible} onToggle={onToggle} onDelete={onDelete} onSaveNote={onSaveNote} onUpdate={onUpdate} onRefresh={onRefresh} />
            </div>
            <Composer onAdd={onAdd} defaultCat={cat === 'personal' ? 'personal' : 'work'} />
          </>
        ) : view === 'insights' ? (
          <>
            <div className="head">
              <div>
                <h1>Insights</h1>
                <div style={{ marginTop: 8, fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--ink-3)', letterSpacing: '.04em' }}>
                  RHYTHM · BALANCE · STREAK · LAST 12 MONTHS
                </div>
              </div>
              <div className="meta hide-mobile">
                <div><b>{counts.done}</b> total completed</div>
                <div><b>{counts.todo}</b> still open</div>
              </div>
              <ReactiveAvatar tasks={tasks} history={history} />
            </div>
            <div className="scroll">
              <Insights tasks={tasks} history={history} />
            </div>
          </>
        ) : view === 'notes' ? (
          <div className="scroll notes-scroll" style={{ overflow: 'auto', padding: 0 }}>
            <Notes focusNoteId={graphFocusId} onFocusClear={() => setGraphFocusId(null)} />
          </div>
        ) : view === 'graph' ? (
          <div className="scroll graph-scroll" style={{ overflow: 'hidden', padding: 0 }}>
            <Graph onNoteClick={(id) => { setGraphFocusId(id); setView('notes') }} />
          </div>
        ) : (
          <div className="scroll" style={{ overflow: 'auto' }}>
            <FitnessDashboard />
          </div>
        )}
      </main>

      {/* Mobile tab bar */}
      <nav className="mtabbar">
        <button className={view === 'tasks' ? 'active' : ''} onClick={() => setView('tasks')}>
          <IconList /> Tasks
        </button>
        <button className={view === 'insights' ? 'active' : ''} onClick={() => setView('insights')}>
          <IconBars /> Insights
        </button>
        <button className={view === 'fitness' ? 'active' : ''} onClick={() => setView('fitness')}>
          ⚡ Fitness
        </button>
        <button className={view === 'notes' ? 'active' : ''} onClick={() => setView('notes')}>
          📝 Notes
        </button>
        <button className={view === 'graph' ? 'active' : ''} onClick={() => setView('graph')}>
          ✦ Graph
        </button>
      </nav>
    </div>
  )
}
