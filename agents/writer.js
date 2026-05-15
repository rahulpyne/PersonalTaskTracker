/**
 * Agent 4 — Supabase Writer
 * Persists parent tasks and subtasks. Deduplicates by source email ID so
 * re-runs never create duplicate tasks for the same email.
 */
import { log, warn } from './lib/logger.js'

export async function run(taskGroups, supabase) {
  log(`SupabaseWriter: writing ${taskGroups.length} task groups`)
  let created = 0
  let skipped = 0

  for (const { sourceId, parent, subtasks } of taskGroups) {
    // ── Deduplication ──────────────────────────────────────────────────────
    const { data: existing } = await supabase
      .from('tasks')
      .select('id')
      .eq('source', `email:${sourceId}`)
      .limit(1)

    if (existing?.length) {
      log(`SupabaseWriter: skip ${sourceId} (already processed)`)
      skipped++
      continue
    }

    // ── Parent task ────────────────────────────────────────────────────────
    const { data: parentRow, error: pe } = await supabase
      .from('tasks')
      .insert({
        text:    parent.title,
        type:    'personal',
        prio:    parent.priority,
        context: parent.notes || '',
        source:  parent.source,
      })
      .select('id')
      .single()

    if (pe) {
      warn(`SupabaseWriter: parent insert failed — ${pe.message}`)
      continue
    }
    created++

    // ── Subtasks (sorted by priority already from extractor) ───────────────
    for (const sub of subtasks) {
      const { error: se } = await supabase.from('tasks').insert({
        text:      sub.title,
        type:      'personal',
        prio:      sub.priority,
        context:   '',
        source:    sub.source,
        parent_id: parentRow.id,
      })
      if (se) warn(`SupabaseWriter: subtask insert failed — ${se.message}`)
      else created++
    }
  }

  log(`SupabaseWriter: done — ${created} tasks created, ${skipped} skipped (dupes)`)
  return { created, skipped }
}
