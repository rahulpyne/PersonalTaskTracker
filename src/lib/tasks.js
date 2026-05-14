import { supabase } from './supabase'

// ── Fetch ──────────────────────────────────────────────────────────────────

export async function fetchTasks() {
  const { data, error } = await supabase
    .from('tasks')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) throw error
  return data
}

export async function fetchAuditLog() {
  const { data, error } = await supabase
    .from('audit_log')
    .select('*')
    .order('changed_at', { ascending: false })
    .limit(100)
  if (error) throw error
  return data
}

// ── Mutations ──────────────────────────────────────────────────────────────

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

export async function toggleComplete(id, completed) {
  return updateTask(id, { completed, completed_at: completed ? new Date().toISOString() : null })
}

// ── Snapshot restore ───────────────────────────────────────────────────────

export async function restoreSnapshot(auditEntry) {
  const snap = auditEntry.before_snapshot
  if (!snap) throw new Error('No before_snapshot to restore')
  return updateTask(snap.id, snap)
}

// ── Realtime ───────────────────────────────────────────────────────────────

export function subscribeToTasks(onChange) {
  const channel = supabase
    .channel('tasks-realtime')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, onChange)
    .subscribe()
  return () => supabase.removeChannel(channel)
}

export function subscribeToAudit(onChange) {
  const channel = supabase
    .channel('audit-realtime')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'audit_log' }, onChange)
    .subscribe()
  return () => supabase.removeChannel(channel)
}
