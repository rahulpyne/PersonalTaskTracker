// DB:  text, type (work|personal), prio (high|med|low), context, done, done_at,
//      parent_id, position, weight (1–3), ai_generated
// UI:  title, cat, prio (high|medium|low), notes, done, completed (ms),
//      parentId, position, weight, aiGenerated

const DB_TO_UI_PRIO = { high: 'high', med: 'medium', low: 'low' }
const UI_TO_DB_PRIO = { high: 'high', medium: 'med', low: 'low' }

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
    weight:      t.weight       ?? 2,   // 1=low · 2=medium · 3=high satisfaction impact
    aiGenerated: t.ai_generated || false,
  }
}

export const subtaskToUI = toUI

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
