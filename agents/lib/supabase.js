import { createClient } from '@supabase/supabase-js'

export function createSupabaseClient(url, serviceKey) {
  return createClient(url, serviceKey, {
    auth: { persistSession: false },
  })
}
