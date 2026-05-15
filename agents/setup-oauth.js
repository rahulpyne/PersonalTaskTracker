/**
 * One-time OAuth setup for Gmail API access.
 *
 * Run: node setup-oauth.js
 *
 * Prerequisites:
 *   1. Create a Google Cloud project at https://console.cloud.google.com
 *   2. Enable the Gmail API (APIs & Services → Library → Gmail API)
 *   3. Create OAuth credentials (APIs & Services → Credentials → Create →
 *      OAuth client ID → Desktop App)
 *   4. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in agents/.env
 *   5. Run this script — it will print GOOGLE_REFRESH_TOKEN
 */
import 'dotenv/config'
import { google } from 'googleapis'
import http from 'http'
import fs from 'fs'
import path from 'path'

const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } = process.env

if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
  console.error('\n❌  Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in agents/.env first\n')
  process.exit(1)
}

const REDIRECT = 'http://localhost:3000'
const SCOPES   = ['https://www.googleapis.com/auth/gmail.readonly']

const oauth2 = new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, REDIRECT)

const authUrl = oauth2.generateAuthUrl({
  access_type: 'offline',
  prompt:      'consent',
  scope:       SCOPES,
})

console.log('\n─────────────────────────────────────────────')
console.log('  Gmail OAuth Setup')
console.log('─────────────────────────────────────────────')
console.log('\n1. Open this URL in your browser:\n')
console.log('  ', authUrl)
console.log('\n2. Sign in as rahulpyne90@gmail.com and grant access.')
console.log('3. You\'ll be redirected back automatically.\n')

const server = http.createServer(async (req, res) => {
  try {
    const url  = new URL(req.url, 'http://localhost:3000')
    if (!url.searchParams.get('code')) { res.end(); return }

    const code = url.searchParams.get('code')
    if (!code) {
      res.writeHead(400)
      res.end('Missing code parameter')
      return
    }

    res.writeHead(200, { 'Content-Type': 'text/html' })
    res.end('<h2 style="font-family:sans-serif;padding:40px">✅ Authorized! Check your terminal.</h2>')
    server.close()

    const { tokens } = await oauth2.getToken(code)

    // Write refresh token directly into agents/.env
    const envPath  = path.resolve('agents/.env')
    const fallback = path.resolve('.env')
    const target   = fs.existsSync(envPath) ? envPath : fallback
    let content    = fs.readFileSync(target, 'utf-8')
    content        = content.replace(
      /^GOOGLE_REFRESH_TOKEN=.*$/m,
      `GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}`
    )
    fs.writeFileSync(target, content)

    console.log('─────────────────────────────────────────────')
    console.log('✅  Authorization successful!')
    console.log(`✅  Refresh token saved to ${target}`)
    console.log('─────────────────────────────────────────────')
  } catch (e) {
    console.error('OAuth error:', e.message)
    server.close()
  }
})

server.listen(3000, () => {
  console.log('Waiting for browser authorization (server on :3000)…\n')
})
