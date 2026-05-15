/**
 * Orchestrator — wires all agents together and runs them on a nightly cron.
 *
 * Usage:
 *   node orchestrator.js           → starts cron daemon
 *   node orchestrator.js --now     → runs pipeline immediately then keeps daemon
 */
import 'dotenv/config'
import cron from 'node-cron'

import { createGmailClient }    from './lib/gmail.js'
import { createLLMClient }      from './lib/llm.js'
import { createSupabaseClient } from './lib/supabase.js'
import { log, warn, err }       from './lib/logger.js'

import { run as fetchEmails }   from './fetcher.js'
import { run as analyzeEmails } from './analyzer.js'
import { run as extractTasks }  from './extractor.js'
import { run as writeTasks }    from './writer.js'

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

const gmail    = createGmailClient({
  clientId:     process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  refreshToken: process.env.GOOGLE_REFRESH_TOKEN,
})

const llm      = createLLMClient(
  process.env.GEMINI_API_KEY,
  process.env.GEMINI_MODEL || 'gemini-2.0-flash-lite',
)

const supabase = createSupabaseClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
)

// ── Pipeline ─────────────────────────────────────────────────────────────────

async function pipeline() {
  log('══════════════════════════════════════')
  log('Nightly pipeline: starting')
  log('══════════════════════════════════════')

  try {
    // 1. Fetch emails
    const emails = await fetchEmails(gmail, {
      user:          process.env.GMAIL_USER || 'me',
      lookbackHours: Number(process.env.LOOKBACK_HOURS || 24),
    })
    if (!emails.length) {
      log('No emails to process — done.')
      return
    }

    // 2. Classify importance with LLM
    const actionable = await analyzeEmails(emails, llm, {
      threshold: Number(process.env.IMPORTANCE_THRESHOLD || 6),
    })
    if (!actionable.length) {
      log('No actionable emails found — done.')
      return
    }

    // 3. Extract tasks & subtasks with LLM
    const taskGroups = await extractTasks(actionable, llm)

    // 4. Persist to Supabase
    const { created, skipped } = await writeTasks(taskGroups, supabase)

    log('══════════════════════════════════════')
    log(`Pipeline complete: ${created} tasks created, ${skipped} dupes skipped`)
    log('══════════════════════════════════════')
  } catch (e) {
    err('Pipeline error:', e.message)
    err(e.stack)
  }
}

// ── Scheduler ─────────────────────────────────────────────────────────────────

const schedule = process.env.CRON_SCHEDULE || '0 23 * * *'
const timezone = process.env.TIMEZONE      || 'Asia/Kolkata'

cron.schedule(schedule, pipeline, { timezone })
log(`Orchestrator running — schedule: "${schedule}" (${timezone})`)
log('Run with --now to trigger immediately')

if (process.argv.includes('--now')) {
  pipeline()
}
