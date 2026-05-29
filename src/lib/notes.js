import { supabase } from './supabase'

export async function fetchNotes() {
  const { data, error } = await supabase
    .from('notes')
    .select('*')
    .order('pinned', { ascending: false })
    .order('updated_at',  { ascending: false })
  if (error) throw error
  return data ?? []
}

export async function createNote({ title = '', body = '', tags = [] } = {}) {
  const { data, error } = await supabase
    .from('notes')
    .insert([{ title, body, tags }])
    .select()
    .single()
  if (error) throw error
  return data
}

export async function updateNote(id, fields) {
  const { data, error } = await supabase
    .from('notes')
    .update(fields)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function deleteNote(id) {
  const { error } = await supabase.from('notes').delete().eq('id', id)
  if (error) throw error
}

export function subscribeToNotes(onChange) {
  const channel = supabase
    .channel('notes-rt')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'notes' }, onChange)
    .subscribe()
  return () => supabase.removeChannel(channel)
}
