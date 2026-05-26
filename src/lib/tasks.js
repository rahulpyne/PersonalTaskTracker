import { supabase } from './supabase'

// ── Top-level tasks (no parent) ───────────────────────────────────────────────

export async function fetchTasks() {
  const { data, error } = await supabase
    .from('tasks')
    .select('*')
    .is('parent_id', null)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data
}

export async function createTask(fields) {
  const { data, error } = await supabase
    .from('tasks')
    .insert([fields])
    .select()
    .single()
  if (error) throw error
  return data
}

export async function updateTask(id, fields) {
  const { data, error } = await supabase
    .from('tasks')
    .update(fields)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function deleteTask(id) {
  const { error } = await supabase.from('tasks').delete().eq('id', id)
  if (error) throw error
}

export async function clearCompleted() {
  // Only delete top-level completed tasks (cascade removes their subtasks)
  const { error } = await supabase
    .from('tasks')
    .delete()
    .eq('done', true)
    .is('parent_id', null)
  if (error) throw error
}

// ── Subtasks ──────────────────────────────────────────────────────────────────

export async function fetchSubtasks(parentId) {
  const { data, error } = await supabase
    .from('tasks')
    .select('*')
    .eq('parent_id', parentId)
    .order('position', { ascending: true })
  if (error) throw error
  return data ?? []
}

export async function toggleSubtask(id, done) {
  const { data, error } = await supabase
    .from('tasks')
    .update({ done, done_at: done ? new Date().toISOString() : null })
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data
}

// ── AI subtask generation — calls the Edge Function ───────────────────────────

export async function generateSubtasks({ taskId, taskTitle, taskCategory, taskNotes }) {
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY
  const url     = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-subtasks`

  const resp = await fetch(url, {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${anonKey}`,
      'apikey':        anonKey,
    },
    body: JSON.stringify({ taskId, taskTitle, taskCategory, taskNotes }),
  })

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}))
    throw new Error(err.error ?? `HTTP ${resp.status}`)
  }

  const { subtasks } = await resp.json()
  return subtasks   // already persisted by the Edge Function
}

// ── Realtime ──────────────────────────────────────────────────────────────────

export function subscribeToTasks(onChange) {
  const channel = supabase
    .channel('tasks-rt')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, onChange)
    .subscribe()
  return () => supabase.removeChannel(channel)
}
