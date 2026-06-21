import { supabase } from './supabase'

// Fetch synced calendar events (Google + Calendly) overlapping a date window.
// Window bounds are ISO strings. An event overlaps if it starts before the
// window ends AND ends after the window starts.
export async function fetchCalendarEvents(fromISO, toISO) {
  const { data, error } = await supabase
    .from('calendar_events')
    .select('id,source,title,location,start_at,end_at,all_day,busy,status')
    .lt('start_at', toISO)
    .gt('end_at', fromISO)
    .neq('status', 'cancelled')
    .order('start_at', { ascending: true })
  if (error) throw error
  return data || []
}

// Auto-scheduled task blocks overlapping a window (proposed/approved/confirmed).
export async function fetchTaskBlocks(fromISO, toISO) {
  const { data, error } = await supabase
    .from('task_blocks')
    .select('id,task_id,title,category,prio,duration_mins,start_at,end_at,status')
    .lt('start_at', toISO)
    .gt('end_at', fromISO)
    .in('status', ['proposed', 'approved', 'confirmed', 'done'])
    .or('sync_state.is.null,sync_state.neq.pending_delete')   // hide blocks queued for deletion
    .order('start_at', { ascending: true })
  if (error) throw error
  return data || []
}

// Approve a proposed block (the nightly agent then writes it to Google Calendar)
export async function approveBlock(id) {
  const { error } = await supabase.from('task_blocks').update({ status: 'approved' }).eq('id', id)
  if (error) throw error
}

export async function approveAllProposed() {
  const { error } = await supabase.from('task_blocks').update({ status: 'approved' }).eq('status', 'proposed')
  if (error) throw error
}

// Best-effort instant Google sync via the edge function. If it's unreachable,
// the sync_state flag remains and the cron reconciles later — so this never blocks.
async function syncNow(action, block) {
  try {
    const { error } = await supabase.functions.invoke('calendar-write', { body: { action, block } })
    return !error
  } catch { return false }
}

// ── Manual block editing — instant in Supabase, mirrored to Google Calendar by
//    the edge function immediately (cron via sync_state flag as fallback) ──

// Mark a block (and its underlying task) complete
export async function completeBlock(block) {
  const ops = [supabase.from('task_blocks').update({ status: 'done' }).eq('id', block.id)]
  if (block.task_id) {
    const today = new Date().toISOString().slice(0, 10)
    ops.push(supabase.from('tasks').update({ done: true, done_at: new Date().toISOString() }).eq('id', block.task_id))
    ops.push(supabase.rpc('upsert_task_daily_stat', {
      p_date: today,
      p_work:     block.category === 'work' ? 1 : 0,
      p_personal: block.category === 'work' ? 0 : 1,
    }))
  }
  const err = (await Promise.all(ops)).find(r => r?.error)?.error
  if (err) throw err
}

// Move a block to a new time (Google event patched instantly if already confirmed)
export async function rescheduleBlock(block, startISO, endISO) {
  const needsGcal = !!block.gcal_event_id
  const duration_mins = Math.round((new Date(endISO) - new Date(startISO)) / 60000)
  const { error } = await supabase.from('task_blocks')
    .update({ start_at: startISO, end_at: endISO, duration_mins, sync_state: needsGcal ? 'pending_update' : 'synced' })
    .eq('id', block.id)
  if (error) throw error
  if (needsGcal) await syncNow('update', { ...block, start_at: startISO, end_at: endISO })
}

// Delete a block — instant Google removal, soft-flag as fallback for the cron
export async function removeBlock(block) {
  if (block.gcal_event_id) {
    await supabase.from('task_blocks').update({ sync_state: 'pending_delete' }).eq('id', block.id)
    await syncNow('delete', block)   // edge function deletes the event + row
  } else {
    const { error } = await supabase.from('task_blocks').delete().eq('id', block.id)
    if (error) throw error
  }
}

// Add a manual block (not tied to a task) → Google event created instantly
export async function createBlock({ title, category, startISO, endISO }) {
  const duration_mins = Math.round((new Date(endISO) - new Date(startISO)) / 60000)
  const { data, error } = await supabase.from('task_blocks').insert({
    title, category, prio: 'med', duration_mins,
    start_at: startISO, end_at: endISO, status: 'confirmed', sync_state: 'pending_create',
  }).select().single()
  if (error) throw error
  await syncNow('create', data)
  return data
}

// Latest weekly fitness plan ({ plan: { monday: {type,durationMins,notes}, ... } })
export async function fetchLatestPlan() {
  const { data, error } = await supabase
    .from('fitness_plans')
    .select('week_start, plan')
    .order('week_start', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return data
}
