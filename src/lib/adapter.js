// Maps DB row → UI task shape used by all components
export function toUI(t) {
  return {
    id:        t.id,
    title:     t.title,
    cat:       t.category,
    prio:      t.priority,
    done:      t.completed,
    created:   t.created_at  ? new Date(t.created_at).getTime()  : Date.now(),
    completed: t.completed_at ? new Date(t.completed_at).getTime() : null,
    notes:     t.notes || '',
  }
}

// Maps UI fields → DB columns for insert / update
export function toDB({ title, cat, prio, notes }) {
  return {
    title,
    category: cat,
    priority: prio,
    notes:    notes || '',
  }
}
