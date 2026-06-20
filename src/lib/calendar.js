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
