import { google } from 'googleapis'

// Reuses the same Google OAuth app as Gmail. The refresh token must have been
// granted the calendar.readonly scope (re-run setup-oauth after adding it).
export function createCalendarClient({ clientId, clientSecret, refreshToken }) {
  const oauth2 = new google.auth.OAuth2(clientId, clientSecret, 'http://localhost:3000')
  oauth2.setCredentials({ refresh_token: refreshToken })
  return google.calendar({ version: 'v3', auth: oauth2 })
}

// Fetch Google Calendar events in [timeMin, timeMax]. Expands recurring events.
export async function fetchGoogleEvents(calendar, { timeMin, timeMax, calendarId = 'primary' }) {
  const out = []
  let pageToken
  do {
    const { data } = await calendar.events.list({
      calendarId,
      timeMin, timeMax,
      singleEvents: true,
      orderBy: 'startTime',
      maxResults: 250,
      pageToken,
    })
    for (const ev of data.items || []) {
      if (ev.status === 'cancelled') continue
      // Skip our own auto-scheduled task blocks (they live in task_blocks already)
      if (ev.extendedProperties?.private?.trackerBlock === 'true') continue
      if ((ev.summary || '').startsWith('▸ ')) continue
      const allDay = !!ev.start?.date
      const start  = ev.start?.dateTime || ev.start?.date
      const end    = ev.end?.dateTime   || ev.end?.date
      if (!start || !end) continue
      out.push({
        id:          `gcal:${ev.id}`,
        source:      'google',
        title:       ev.summary || '(no title)',
        description: ev.description || null,
        location:    ev.location || null,
        start_at:    new Date(start).toISOString(),
        end_at:      new Date(end).toISOString(),
        all_day:     allDay,
        busy:        ev.transparency !== 'transparent',
        status:      ev.status || 'confirmed',
        raw:         { htmlLink: ev.htmlLink, organizer: ev.organizer?.email },
      })
    }
    pageToken = data.nextPageToken
  } while (pageToken)
  return out
}

// ── Google Calendar writes (needs calendar.events scope) ─────────────────────

// Create a timed event; returns the new event id. colorId 6 = tangerine (tasks).
export async function createGoogleEvent(calendar, { summary, description, start, end, colorId = '6', calendarId = 'primary' }) {
  const { data } = await calendar.events.insert({
    calendarId,
    requestBody: {
      summary,
      description: description || 'Auto-scheduled by Tracker',
      start: { dateTime: new Date(start).toISOString() },
      end:   { dateTime: new Date(end).toISOString() },
      colorId,
      source: { title: 'Tracker', url: 'https://personal-task-tracker-lac.vercel.app' },
      extendedProperties: { private: { trackerBlock: 'true' } },
    },
  })
  return data.id
}

export async function deleteGoogleEvent(calendar, eventId, calendarId = 'primary') {
  try {
    await calendar.events.delete({ calendarId, eventId })
    return true
  } catch (e) {
    if (e?.code === 410 || e?.code === 404) return true   // already gone
    throw e
  }
}

// Fetch Calendly scheduled events (booked meetings) → treated as busy time.
// Requires CALENDLY_TOKEN (personal access token) and the user's URI.
export async function fetchCalendlyEvents({ token, minStart, maxStart }) {
  const headers = { Authorization: `Bearer ${token}` }
  // Resolve current user URI
  const me = await fetch('https://api.calendly.com/users/me', { headers }).then(r => r.json())
  const userUri = me?.resource?.uri
  if (!userUri) throw new Error('Calendly: could not resolve user (check CALENDLY_TOKEN)')

  const out = []
  let pageToken
  do {
    const url = new URL('https://api.calendly.com/scheduled_events')
    url.searchParams.set('user', userUri)
    url.searchParams.set('min_start_time', minStart)
    url.searchParams.set('max_start_time', maxStart)
    url.searchParams.set('status', 'active')
    url.searchParams.set('count', '100')
    if (pageToken) url.searchParams.set('page_token', pageToken)

    const data = await fetch(url, { headers }).then(r => r.json())
    for (const ev of data.collection || []) {
      out.push({
        id:          `calendly:${ev.uri.split('/').pop()}`,
        source:      'calendly',
        title:       ev.name || 'Calendly meeting',
        description: null,
        location:    ev.location?.location || ev.location?.type || null,
        start_at:    new Date(ev.start_time).toISOString(),
        end_at:      new Date(ev.end_time).toISOString(),
        all_day:     false,
        busy:        true,
        status:      ev.status === 'canceled' ? 'cancelled' : 'confirmed',
        raw:         { uri: ev.uri },
      })
    }
    pageToken = data?.pagination?.next_page_token
  } while (pageToken)
  return out
}
