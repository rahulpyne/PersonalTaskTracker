/**
 * Orchestrator — wires all agents together and runs them on a nightly cron.
 *
 * Usage:
 *   node orchestrator.js           → starts cron daemon
 *   node orchestrator.js --now     → runs pipeline immediately then keeps daemon
 */
import 'dotenv/config'
import cron from 'node-cron'
import fs   from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

import { createGmailClient }    from './lib/gmail.js'
import { createLLMClient }      from './lib/llm.js'
import { createSupabaseClient } from './lib/supabase.js'
import { log, warn, err }       from './lib/logger.js'

import { run as fetchEmails }      from './fetcher.js'
import { run as analyzeEmails }    from './analyzer.js'
import { run as extractTasks }     from './extractor.js'
import { run as writeTasks }       from './writer.js'
import { run as cleanInbox }       from './cleaner.js'
import { run as pruneData }        from './pruner.js'
import { run as pullStrava }       from './fitness/strava-puller.js'
import { run as scrapeLifts }      from './fitness/strava-lift-scraper.js'
import { run as generateInsights } from './fitness/insight-generator.js'

const __dir          = path.dirname(fileURLToPath(import.meta.url))
const ACCOUNTS_FILE  = path.join(__dir, 'accounts.json')

// ── Validate env ──────────────────────────────────────────────────────────────

const REQUIRED = [
  'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REFRESH_TOKEN',
  'GEMINI_API_KEY', 'SUPABASE_URL', 'SUPABASE_SERVICE_KEY',
]
const missing = REQUIRED.filter(k => !process.env[k])
if (missing.length) {
  err(`Missing env vars: ${missing.join(', ')}`)
  err('Copy agents/.env.example → agents/.env and fill in values')
  process.exit(1)
}

// ── Clients ───────────────────────────────────────────────────────────────────

const llm      = createLLMClient(
  process.env.GEMINI_API_KEY,
  process.env.GEMINI_MODEL || 'gemini-2.0-flash-lite',
)

const supabase = createSupabaseClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
)

// ── Per-account pipeline ──────────────────────────────────────────────────────

async function runForAccount({ email, refreshToken }) {
  if (!refreshToken) {
    warn(`Skipping ${email} — no refresh token. Run: node setup-oauth.js ${email}`)
    return
  }

  log(`── Account: ${email} ──`)
  const gmailClient = createGmailClient({
    clientId:     process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    refreshToken,
  })

  // Phase A: extract tasks from important emails
  const emails = await fetchEmails(gmailClient, {
    user:          email,
    lookbackHours: Number(process.env.LOOKBACK_HOURS || 24),
  })

  if (emails.length) {
    const actionable = await analyzeEmails(emails, llm, {
      threshold: Number(process.env.IMPORTANCE_THRESHOLD || 6),
    })
    if (actionable.length) {
      const taskGroups          = await extractTasks(actionable, llm)
      const { created, skipped } = await writeTasks(taskGroups, supabase)
      log(`${email}: ${created} tasks created, ${skipped} dupes skipped`)
    } else {
      log(`${email}: no actionable emails`)
    }
  } else {
    log(`${email}: no emails from real people`)
  }

  // Phase B: clean junk
  const { trashed } = await cleanInbox(gmailClient, {
    user:          email,
    olderThanDays: Number(process.env.CLEAN_OLDER_THAN_DAYS || 0),
  })
  log(`${email}: ${trashed} junk emails trashed`)
}

// ── Main pipeline (all accounts) ──────────────────────────────────────────────

async function pipeline() {
  log('══════════════════════════════════════')
  log('Nightly pipeline: starting')
  log('══════════════════════════════════════')

  // Re-read accounts.json each run so new accounts are picked up without restart
  let accounts = []
  try {
    accounts = JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf-8'))
  } catch {
    err('Could not read agents/accounts.json')
    return
  }

  let totalTrashed = 0
  for (const account of accounts) {
    try {
      await runForAccount(account)
    } catch (e) {
      err(`${account.email} failed:`, e.message)
    }
  }

  // Phase C: prune old task data (runs once per nightly job)
  await pruneData(supabase, {
    retentionDays: Number(process.env.RETENTION_DAYS || 90),
  })

  // Phase D: sync Strava activities (nightly)
  const stravaLookback = Number(process.env.STRAVA_LOOKBACK_DAYS || 7)
  try {
    await pullStrava(supabase, { lookbackDays: stravaLookback })
  } catch (e) {
    warn('StravaFetcher failed:', e.message)
  }

  // Phase D2: scrape lift photos from Strava and push into gymverse_workouts
  // Runs automatically after every Strava pull — idempotent via external_id dedup
  try {
    await scrapeLifts(supabase, { lookbackDays: stravaLookback })
  } catch (e) {
    warn('StravaLiftScraper failed:', e.message)
  }

  // Phase E: generate fitness insights (Sundays only — weekly)
  const dayOfWeek = new Date().getDay()  // 0 = Sunday
  if (dayOfWeek === 0 || process.argv.includes('--insights')) {
    try {
      await generateInsights(supabase, llm)
    } catch (e) {
      warn('FitnessInsights failed:', e.message)
    }
  }

  log('══════════════════════════════════════')
  log(`Pipeline complete — ${accounts.length} accounts processed`)
  log('══════════════════════════════════════')
}

// ── Scheduler ─────────────────────────────────────────────────────────────────

const schedule = process.env.CRON_SCHEDULE || '0 23 * * *'
const timezone = process.env.TIMEZONE      || 'America/Vancouver'

cron.schedule(schedule, pipeline, { timezone })
log(`Orchestrator running — schedule: "${schedule}" (${timezone})`)
log('Run with --now to trigger immediately')

if (process.argv.includes('--now')) {
  pipeline()
}
