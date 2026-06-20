/**
 * One-time OAuth setup for Gmail API access.
 *
 * Usage:
 *   node setup-oauth.js                        → authorise the first account in accounts.json
 *   node setup-oauth.js you@gmail.com          → authorise a specific account
 *
 * Prerequisites:
 *   1. Create a Google Cloud project at https://console.cloud.google.com
 *   2. Enable the Gmail API
 *   3. Create OAuth 2.0 credentials (Desktop App or Web App with http://localhost:3000 redirect)
 *   4. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in agents/.env
 *   5. Add the target email as a Test User in the OAuth consent screen
 *   6. Run this script — it saves the refresh token directly into agents/accounts.json
 */
import 'dotenv/config'
import { google } from 'googleapis'
import http from 'http'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dir = path.dirname(fileURLToPath(import.meta.url))

const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } = process.env
if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
  console.error('\n❌  Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in agents/.env first\n')
  process.exit(1)
}

// ── Target email ──────────────────────────────────────────────────────────────

const ACCOUNTS_FILE = path.join(__dir, 'accounts.json')
const accounts      = JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf-8'))
const targetEmail   = process.argv[2] || accounts[0]?.email

if (!targetEmail) {
  console.error('❌  Provide an email: node setup-oauth.js you@gmail.com')
  process.exit(1)
}

if (!accounts.find(a => a.email === targetEmail)) {
  accounts.push({ email: targetEmail, refreshToken: '' })
}

console.log(`\n── Authorising: ${targetEmail} ──`)

// ── OAuth flow ────────────────────────────────────────────────────────────────

const REDIRECT = 'http://localhost:3000'
const SCOPES   = [
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/calendar.events',  // read events (sync) + write (auto-scheduled task blocks)
]

const oauth2 = new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, REDIRECT)

const authUrl = oauth2.generateAuthUrl({
  access_type:  'offline',
  prompt:       'consent',
  scope:        SCOPES,
  login_hint:   targetEmail,   // pre-fills the account selector
})

console.log('\n1. Open this URL in your browser:\n')
console.log('  ', authUrl)
console.log('\n2. Sign in as', targetEmail, 'and grant access.')
console.log('3. You\'ll be redirected back automatically.\n')

const server = http.createServer(async (req, res) => {
  try {
    const url  = new URL(req.url, 'http://localhost:3000')
    if (!url.searchParams.get('code')) { res.end(); return }

    const code = url.searchParams.get('code')
    res.writeHead(200, { 'Content-Type': 'text/html' })
    res.end(`<h2 style="font-family:sans-serif;padding:40px">✅ ${targetEmail} authorised! Check your terminal.</h2>`)
    server.close()

    const { tokens } = await oauth2.getToken(code)

    // Save into accounts.json
    const idx = accounts.findIndex(a => a.email === targetEmail)
    accounts[idx].refreshToken = tokens.refresh_token
    fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(accounts, null, 2))

    console.log('─────────────────────────────────────────────')
    console.log(`✅  ${targetEmail} authorised!`)
    console.log(`✅  Refresh token saved to agents/accounts.json`)
    console.log('─────────────────────────────────────────────\n')
  } catch (e) {
    console.error('OAuth error:', e.message)
    server.close()
  }
})

server.listen(3000, () => {
  console.log('Waiting for browser authorisation (server on :3000)…\n')
})
