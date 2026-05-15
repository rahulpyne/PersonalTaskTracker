import { supabase } from './supabase'

export async function fetchTasks() {
  const { data, error } = await supabase
    .from('tasks')
    .select('*')
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
  const { error } = await supabase.from('tasks').delete().eq('done', true)
  if (error) throw error
}

export function subscribeToTasks(onChange) {
  const channel = supabase
    .channel('tasks-rt')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, onChange)
    .subscribe()
  return () => supabase.removeChannel(channel)
}
