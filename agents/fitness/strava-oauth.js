/**
 * Strava OAuth Setup
 *
 * Usage:
 *   node agents/fitness/strava-oauth.js
 *
 * Prerequisites:
 *   1. Create an app at https://www.strava.com/settings/api
 *   2. Set "Authorization Callback Domain" to "localhost"
 *   3. Add STRAVA_CLIENT_ID and STRAVA_CLIENT_SECRET to agents/.env
 *   4. Run this script — saves tokens to agents/fitness/strava-config.json
 */
import 'dotenv/config'
import http from 'http'
import fs   from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dir      = path.dirname(fileURLToPath(import.meta.url))
const CONFIG_FILE = path.join(__dir, 'strava-config.json')

const CLIENT_ID     = process.env.STRAVA_CLIENT_ID
const CLIENT_SECRET = process.env.STRAVA_CLIENT_SECRET
const REDIRECT      = 'http://localhost:3000'
const SCOPE         = 'read,activity:read_all,profile:read_all'

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('\n❌  Set STRAVA_CLIENT_ID and STRAVA_CLIENT_SECRET in agents/.env first\n')
  process.exit(1)
}

const authUrl =
  `https://www.strava.com/oauth/authorize` +
  `?client_id=${CLIENT_ID}` +
  `&redirect_uri=${encodeURIComponent(REDIRECT)}` +
  `&response_type=code` +
  `&approval_prompt=force` +
  `&scope=${SCOPE}`

console.log('\n── Strava OAuth Setup ──')
console.log('\n1. Open this URL in your browser:\n')
console.log('  ', authUrl)
console.log('\n2. Authorise the app.')
console.log('3. You will be redirected back automatically.\n')

const server = http.createServer(async (req, res) => {
  try {
    const url  = new URL(req.url, 'http://localhost:3000')
    const code = url.searchParams.get('code')
    if (!code) { res.end(); return }

    res.writeHead(200, { 'Content-Type': 'text/html' })
    res.end('<h2 style="font-family:sans-serif;padding:40px">✅ Strava connected! Check your terminal.</h2>')
    server.close()

    const resp = await fetch('https://www.strava.com/oauth/token', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        client_id:     CLIENT_ID,
        client_secret: CLIENT_SECRET,
        code,
        grant_type: 'authorization_code',
      }),
    })
    const data = await resp.json()

    if (!data.access_token) {
      console.error('❌  Token exchange failed:', JSON.stringify(data))
      return
    }

    const config = {
      athlete: {
        id:   data.athlete.id,
        name: `${data.athlete.firstname} ${data.athlete.lastname}`,
      },
      access_token:  data.access_token,
      refresh_token: data.refresh_token,
      expires_at:    data.expires_at,    // Unix epoch seconds
    }
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2))

    console.log('─────────────────────────────────────────────')
    console.log(`✅  Connected as: ${config.athlete.name}`)
    console.log(`✅  Config saved to agents/fitness/strava-config.json`)
    console.log('─────────────────────────────────────────────\n')
  } catch (e) {
    console.error('OAuth error:', e.message)
    server.close()
  }
})

server.listen(3000, () => {
  console.log('Waiting for Strava OAuth redirect (server on :3000)…\n')
})
