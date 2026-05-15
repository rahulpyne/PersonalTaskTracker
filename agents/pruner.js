/**
 * Agent 6 — Data Pruner
 *
 * Runs nightly after the main pipeline. After RETENTION_DAYS (default 90):
 *
 *  ┌─────────────────────────────────────────────────────────────────────┐
 *  │ Completed parent tasks  →  anonymised (text/notes/source cleared)  │
 *  │                            ALL metric fields kept intact:           │
 *  │                            done, done_at, created_at, type, prio   │
 *  │                                                                     │
 *  │ Subtasks (parent_id != null)  →  hard-deleted                      │
 *  │   (subtasks never appear in streak / monthly / yearly counts)      │
 *  │                                                                     │
 *  │ Stale open tasks (never completed, > 90 days old)  →  hard-deleted │
 *  │   (they have no done_at so they don't affect any metric)           │
 *  └─────────────────────────────────────────────────────────────────────┘
 *
 * Net effect on app metrics: zero — streak, completion counts, work/personal
 * split, and daily/monthly heatmap are all preserved exactly.
 */
import { log } from './lib/logger.js'

const PLACEHOLDER = '[archived]'

export async function run(supabase, { retentionDays = 90 } = {}) {
  log(`DataPruner: starting (retention = ${retentionDays} days)`)

  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - retentionDays)
  const cutoffISO = cutoff.toISOString()

  // ── 1. Anonymise completed parent tasks ──────────────────────────────────
  // Wipes content (text, context, source) but preserves every field that
  // feeds into metrics: done, done_at, created_at, type, prio, parent_id.
  const { data: anonymised, error: e1 } = await supabase
    .from('tasks')
    .update({ text: PLACEHOLDER, context: '', source: '' })
    .eq('done', true)
    .is('parent_id', null)
    .lt('done_at', cutoffISO)
    .neq('text', PLACEHOLDER)   // skip rows already anonymised
    .select('id')

  if (e1) log(`DataPruner: anonymise error — ${e1.message}`)
  else     log(`DataPruner: ${anonymised?.length ?? 0} completed tasks anonymised`)

  // ── 2. Hard-delete old subtasks ──────────────────────────────────────────
  // Subtasks are never queried for streak / counts — safe to remove entirely.
  const { data: deletedSubs, error: e2 } = await supabase
    .from('tasks')
    .delete()
    .not('parent_id', 'is', null)
    .lt('created_at', cutoffISO)
    .select('id')

  if (e2) log(`DataPruner: subtask delete error — ${e2.message}`)
  else     log(`DataPruner: ${deletedSubs?.length ?? 0} old subtasks deleted`)

  // ── 3. Hard-delete stale open tasks ─────────────────────────────────────
  // Tasks that were never completed have no done_at, so they contribute
  // nothing to streak or completion counts. Safe to remove after 90 days.
  const { data: deletedOpen, error: e3 } = await supabase
    .from('tasks')
    .delete()
    .eq('done', false)
    .is('parent_id', null)
    .lt('created_at', cutoffISO)
    .select('id')

  if (e3) log(`DataPruner: stale open delete error — ${e3.message}`)
  else     log(`DataPruner: ${deletedOpen?.length ?? 0} stale open tasks deleted`)

  const summary = {
    anonymised:   anonymised?.length  ?? 0,
    deletedSubs:  deletedSubs?.length ?? 0,
    deletedOpen:  deletedOpen?.length ?? 0,
  }
  log(`DataPruner: done — ${JSON.stringify(summary)}`)
  return summary
}
