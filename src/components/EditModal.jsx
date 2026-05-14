import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

const EMPTY = {
  title: '', category: 'work', priority: 'medium',
  type: '', group: '', assigned_to: '', due_date: '', notes: '',
}

export default function EditModal({ task, onSave, onClose }) {
  const [form, setForm] = useState(EMPTY)

  useEffect(() => {
    if (task === true) {
      setForm(EMPTY)
    } else if (task) {
      setForm({
        title:       task.title       || '',
        category:    task.category    || 'work',
        priority:    task.priority    || 'medium',
        type:        task.type        || '',
        group:       task.group       || '',
        assigned_to: task.assigned_to || '',
        due_date:    task.due_date    ? task.due_date.slice(0, 10) : '',
        notes:       task.notes       || '',
      })
    }
  }, [task])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleSubmit = e => {
    e.preventDefault()
    if (!form.title.trim()) return
    onSave(form)
  }

  return (
    <AnimatePresence>
      {task && (
        <motion.div
          className="modal-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: .15 }}
          onClick={onClose}
        >
          <motion.div
            className="modal"
            initial={{ scale: .95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: .95, opacity: 0 }}
            transition={{ duration: .22, ease: [0.22, 1, 0.36, 1] }}
            onClick={e => e.stopPropagation()}
          >
            <div className="modal-title">{task === true ? 'New Task' : 'Edit Task'}</div>

            <form onSubmit={handleSubmit}>
              <div className="form-row">
                <label className="form-label">Title</label>
                <input
                  className="form-input"
                  value={form.title}
                  onChange={e => set('title', e.target.value)}
                  placeholder="Task title…"
                  autoFocus
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div className="form-row">
                  <label className="form-label">Category</label>
                  <select className="form-select" value={form.category} onChange={e => set('category', e.target.value)}>
                    <option value="work">Work</option>
                    <option value="personal">Personal</option>
                  </select>
                </div>
                <div className="form-row">
                  <label className="form-label">Priority</label>
                  <select className="form-select" value={form.priority} onChange={e => set('priority', e.target.value)}>
                    <option value="high">High</option>
                    <option value="medium">Medium</option>
                    <option value="low">Low</option>
                  </select>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div className="form-row">
                  <label className="form-label">Type</label>
                  <input className="form-input" value={form.type} onChange={e => set('type', e.target.value)} placeholder="bug, feature…" />
                </div>
                <div className="form-row">
                  <label className="form-label">Group / Project</label>
                  <input className="form-input" value={form.group} onChange={e => set('group', e.target.value)} placeholder="Project name…" />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div className="form-row">
                  <label className="form-label">Assigned To</label>
                  <input className="form-input" value={form.assigned_to} onChange={e => set('assigned_to', e.target.value)} placeholder="@handle" />
                </div>
                <div className="form-row">
                  <label className="form-label">Due Date</label>
                  <input className="form-input" type="date" value={form.due_date} onChange={e => set('due_date', e.target.value)} />
                </div>
              </div>

              <div className="form-row">
                <label className="form-label">Notes</label>
                <textarea className="form-textarea" value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="Additional notes…" />
              </div>

              <div className="modal-actions">
                <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
                <button type="submit" className="btn btn-primary">
                  {task === true ? 'Create' : 'Save'}
                </button>
              </div>
            </form>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
