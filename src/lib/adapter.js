// Existing DB schema uses different column names than the design's UI shape.
// DB:  text, type (work|personal), prio (high|med|low), context, done, done_at
// UI:  title, cat, prio (high|medium|low), notes, done, completed (ms)

const DB_TO_UI_PRIO = { high: 'high', med: 'medium', low: 'low' }
const UI_TO_DB_PRIO = { high: 'high', medium: 'med', low: 'low' }

export function toUI(t) {
  return {
    id:        t.id,
    title:     t.text      || '',
    cat:       t.type      || 'work',
    prio:      DB_TO_UI_PRIO[t.prio] || 'medium',
    done:      t.done      || false,
    created:   t.created_at ? new Date(t.created_at).getTime() : Date.now(),
    completed: t.done_at    ? new Date(t.done_at).getTime()    : null,
    notes:     t.context   || '',
  }
}

export function toDB({ title, cat, prio, notes }) {
  return {
    text:    title,
    type:    cat,
    prio:    UI_TO_DB_PRIO[prio] || 'med',
    context: notes || '',
  }
}

// Fields for toggling completion
export function toDBToggle(done) {
  return {
    done,
    done_at: done ? new Date().toISOString() : null,
  }
}
