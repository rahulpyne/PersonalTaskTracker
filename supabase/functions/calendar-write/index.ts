// Supabase Edge Function: calendar-write
//
// Gives the web app *instant* Google Calendar sync for manual block edits,
// instead of waiting for the cron. The app calls this on add / reschedule /
// delete; the function performs the Google Calendar REST operation and updates
// the task_blocks row. If this function is unavailable, the app's sync_state
// flag still lets the cron reconcile later — so it degrades safely.
//
// Secrets required (supabase secrets set ...):
//   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_CALENDAR_REFRESH_TOKEN
// Auto-provided by the platform: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

const CAL = 'https://www.googleapis.com/calendar/v3/calendars/primary/events'

async function googleAccessToken(): Promise<string> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     Deno.env.get('GOOGLE_CLIENT_ID')!,
      client_secret: Deno.env.get('GOOGLE_CLIENT_SECRET')!,
      refresh_token: Deno.env.get('GOOGLE_CALENDAR_REFRESH_TOKEN')!,
      grant_type:    'refresh_token',
    }),
  })
  const data = await res.json()
  if (!data.access_token) throw new Error('Google token refresh failed: ' + JSON.stringify(data))
  return data.access_token
}

const evtBody = (b: any) => ({
  summary: `▸ ${b.title}`,
  description: 'Scheduled via Tracker.',
  start: { dateTime: new Date(b.start_at).toISOString() },
  end:   { dateTime: new Date(b.end_at).toISOString() },
  colorId: '6',
  extendedProperties: { private: { trackerBlock: 'true' } },
})

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const { action, block } = await req.json()
    if (!action || !block) return json({ error: 'action and block required' }, 400)

    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const token = await googleAccessToken()
    const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }

    if (action === 'create') {
      const r = await fetch(CAL, { method: 'POST', headers: auth, body: JSON.stringify(evtBody(block)) })
      const ev = await r.json()
      if (!ev.id) throw new Error('create failed: ' + JSON.stringify(ev))
      await sb.from('task_blocks').update({ gcal_event_id: ev.id, sync_state: 'synced', status: 'confirmed' }).eq('id', block.id)
      return json({ ok: true, gcal_event_id: ev.id })
    }

    if (action === 'update') {
      if (block.gcal_event_id) {
        const r = await fetch(`${CAL}/${block.gcal_event_id}`, {
          method: 'PATCH', headers: auth,
          body: JSON.stringify({ start: { dateTime: new Date(block.start_at).toISOString() }, end: { dateTime: new Date(block.end_at).toISOString() } }),
        })
        if (!r.ok) throw new Error('patch failed: ' + (await r.text()))
      }
      await sb.from('task_blocks').update({ sync_state: 'synced' }).eq('id', block.id)
      return json({ ok: true })
    }

    if (action === 'delete') {
      if (block.gcal_event_id) {
        const r = await fetch(`${CAL}/${block.gcal_event_id}`, { method: 'DELETE', headers: auth })
        if (!r.ok && r.status !== 404 && r.status !== 410) throw new Error('delete failed: ' + (await r.text()))
      }
      await sb.from('task_blocks').delete().eq('id', block.id)
      return json({ ok: true })
    }

    return json({ error: `unknown action: ${action}` }, 400)
  } catch (e) {
    return json({ error: String(e?.message ?? e) }, 500)
  }
})
