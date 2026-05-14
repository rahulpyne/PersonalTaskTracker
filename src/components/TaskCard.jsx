import { motion, AnimatePresence } from 'framer-motion'
import { formatDate, isOverdue } from '../lib/dates'

const PRIORITY_LABEL = { high: 'High', medium: 'Med', low: 'Low' }

export default function TaskCard({ task, onToggle, onEdit, onDelete }) {
  const overdue = isOverdue(task.due_date) && !task.completed

  return (
    <motion.div
      className={`task-card ${task.completed ? 'completed' : ''}`}
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: .97, transition: { duration: .12 } }}
      transition={{ duration: .22, ease: [0.22, 1, 0.36, 1] }}
      onClick={() => onEdit(task)}
    >
      {/* Checkbox */}
      <motion.div
        className={`task-checkbox ${task.completed ? 'checked' : ''}`}
        onClick={e => { e.stopPropagation(); onToggle(task) }}
        whileTap={{ scale: 1.3 }}
        transition={{ type: 'spring', stiffness: 500, damping: 20 }}
      />

      {/* Body */}
      <div className="task-body">
        <div className={`task-title ${task.completed ? 'done' : ''}`}>
          {task.title}
        </div>

        <div className="task-meta">
          {task.priority && (
            <span className={`tag priority-${task.priority}`}>
              {PRIORITY_LABEL[task.priority]}
            </span>
          )}
          {task.group && <span className="tag">{task.group}</span>}
          {task.assigned_to && <span className="tag">@{task.assigned_to}</span>}
          {task.type && <span className="tag">{task.type}</span>}
          {task.due_date && (
            <span className={`tag ${overdue ? 'overdue' : ''}`}>
              {overdue ? '⚠ ' : ''}{formatDate(task.due_date)}
            </span>
          )}
        </div>
      </div>

      {/* Delete */}
      <motion.button
        className="btn btn-ghost btn-sm"
        style={{ flexShrink: 0, opacity: 0, padding: '3px 7px', fontSize: 13 }}
        whileHover={{ opacity: 1 }}
        onClick={e => { e.stopPropagation(); onDelete(task.id) }}
        title="Delete"
      >
        ✕
      </motion.button>
    </motion.div>
  )
}
