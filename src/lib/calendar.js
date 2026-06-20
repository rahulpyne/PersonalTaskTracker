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
    .in('status', ['proposed', 'approved', 'confirmed'])
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
