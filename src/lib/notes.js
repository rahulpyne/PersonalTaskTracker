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

// ── AI note structuring ───────────────────────────────────────────────────────
export async function structureNote({ text, mode = 'structure' }) {
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY
  const url     = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-notes`

  const resp = await fetch(url, {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${anonKey}`,
      'apikey':        anonKey,
    },
    body: JSON.stringify({ text, mode }),
  })

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}))
    throw new Error(err.error ?? `HTTP ${resp.status}`)
  }

  return resp.json()  // { title, body, tags }
}

export function subscribeToNotes(onChange) {
  const channel = supabase
    .channel('notes-rt')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'notes' }, onChange)
    .subscribe()
  return () => supabase.removeChannel(channel)
}
