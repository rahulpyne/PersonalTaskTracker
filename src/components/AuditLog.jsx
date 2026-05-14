import { motion, AnimatePresence } from 'framer-motion'

function timeAgo(iso) {
  const diff = (Date.now() - new Date(iso)) / 1000
  if (diff < 60)   return `${Math.floor(diff)}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return new Date(iso).toLocaleDateString()
}

export default function AuditLog({ log, onRestore }) {
  if (!log.length) {
    return (
      <div className="empty-state">
        <div className="empty-icon">◎</div>
        <div className="empty-label">No audit entries yet</div>
        <div className="empty-sub">Changes to tasks will appear here.</div>
      </div>
    )
  }

  return (
    <div className="audit-list">
      <AnimatePresence initial={false}>
        {log.map(entry => (
          <motion.div
            key={entry.id}
            className="audit-entry"
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: .2 }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <span className={`audit-action ${entry.action}`}>{entry.action}</span>
                <span style={{ fontWeight: 500, fontSize: 13.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {entry.after_snapshot?.title || entry.before_snapshot?.title || 'Unknown task'}
                </span>
              </div>
              <div className="audit-meta">{timeAgo(entry.changed_at)}</div>

              {entry.action === 'UPDATE' && entry.before_snapshot && entry.after_snapshot && (
                <div style={{ marginTop: 8, fontSize: 12, color: 'var(--muted)', display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {Object.keys(entry.after_snapshot)
                    .filter(k => k !== 'updated_at' && entry.before_snapshot[k] !== entry.after_snapshot[k])
                    .map(k => (
                      <span key={k}>
                        <strong>{k}:</strong>{' '}
                        <span style={{ textDecoration: 'line-through', marginRight: 4 }}>{String(entry.before_snapshot[k] ?? '—')}</span>
                        → {String(entry.after_snapshot[k] ?? '—')}
                      </span>
                    ))}
                </div>
              )}
            </div>

            {entry.action === 'UPDATE' && entry.before_snapshot && (
              <button
                className="btn btn-ghost btn-sm"
                style={{ flexShrink: 0 }}
                onClick={() => onRestore(entry)}
                title="Restore to this snapshot"
              >
                Restore
              </button>
            )}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}
