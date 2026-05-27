// DB:  text, type (work|personal), prio (high|med|low), context, done, done_at,
//      parent_id, position, weight (1–3), ai_generated, subtasks (embedded array)
// UI:  title, cat, prio (high|medium|low), notes, done, completed (ms),
//      parentId, position, weight, aiGenerated, subtasks (UI-mapped array)

const DB_TO_UI_PRIO = { high: 'high', med: 'medium', low: 'low' }
const UI_TO_DB_PRIO = { high: 'high', medium: 'med', low: 'low' }

function subtaskRowToUI(s) {
  return {
    id:       s.id,
    title:    s.text      || '',
    prio:     DB_TO_UI_PRIO[s.prio] || 'medium',
    done:     s.done      || false,
    notes:    s.context   || '',
    weight:   s.weight    ?? 2,
    position: s.position  ?? 0,
  }
}

export function toUI(t) {
  return {
    id:          t.id,
    title:       t.text         || '',
    cat:         t.type         || 'work',
    prio:        DB_TO_UI_PRIO[t.prio] || 'medium',
    done:        t.done         || false,
    created:     t.created_at   ? new Date(t.created_at).getTime() : Date.now(),
    completed:   t.done_at      ? new Date(t.done_at).getTime()    : null,
    notes:       t.context      || '',
    parentId:    t.parent_id    || null,
    position:    t.position     ?? 0,
    weight:      t.weight       ?? 2,
    aiGenerated: t.ai_generated || false,
    // Subtasks embedded from the DB join — sorted by position
    subtasks: (t.subtasks || [])
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
      .map(subtaskRowToUI),
  }
}

// subtaskToUI is kept for any legacy callsites but is no longer used for fetch
export const subtaskToUI = subtaskRowToUI

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
