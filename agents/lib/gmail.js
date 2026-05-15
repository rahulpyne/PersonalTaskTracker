import { google } from 'googleapis'

export function createGmailClient({ clientId, clientSecret, refreshToken }) {
  const oauth2 = new google.auth.OAuth2(
    clientId,
    clientSecret,
    'http://localhost:3000/oauth/callback'
  )
  oauth2.setCredentials({ refresh_token: refreshToken })
  return google.gmail({ version: 'v1', auth: oauth2 })
}

// Recursively find a MIME part by type
function findPart(payload, mimeType) {
  if (payload.mimeType === mimeType) return payload
  for (const part of payload.parts || []) {
    const found = findPart(part, mimeType)
    if (found) return found
  }
  return null
}

export function decodeBody(payload) {
  const part = findPart(payload, 'text/plain') || findPart(payload, 'text/html')
  if (!part?.body?.data) return ''
  const raw = Buffer.from(part.body.data, 'base64url').toString('utf-8')
  // Strip HTML tags if needed
  return raw.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

export function getHeader(headers, name) {
  return headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value || ''
}
