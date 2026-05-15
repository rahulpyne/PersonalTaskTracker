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
import { run as cleanInbox }    from './cleaner.js'

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

const USER = process.env.GMAIL_USER || 'me'

// ── Pipeline ─────────────────────────────────────────────────────────────────

async function pipeline() {
  log('══════════════════════════════════════')
  log('Nightly pipeline: starting')
  log('══════════════════════════════════════')

  try {
    // ── Phase A: Task extraction from Primary inbox ────────────────────────

    // 1. Fetch emails from real people only (Primary, last 24h)
    const emails = await fetchEmails(gmail, {
      user:          USER,
      lookbackHours: Number(process.env.LOOKBACK_HOURS || 24),
    })

    if (emails.length) {
      // 2. Classify importance with LLM
      const actionable = await analyzeEmails(emails, llm, {
        threshold: Number(process.env.IMPORTANCE_THRESHOLD || 6),
      })

      if (actionable.length) {
        // 3. Extract parent tasks + subtasks with LLM
        const taskGroups = await extractTasks(actionable, llm)

        // 4. Persist to Supabase (deduped by source email ID)
        const { created, skipped } = await writeTasks(taskGroups, supabase)
        log(`Tasks: ${created} created, ${skipped} dupes skipped`)
      } else {
        log('No actionable emails found in Primary.')
      }
    } else {
      log('No emails from real people in Primary.')
    }

    // ── Phase B: Inbox cleanup (Spam / Promotions / Social / Updates) ──────

    const { trashed } = await cleanInbox(gmail, {
      user:          USER,
      olderThanDays: Number(process.env.CLEAN_OLDER_THAN_DAYS || 7),
    })

    log('══════════════════════════════════════')
    log(`Pipeline complete — ${trashed} junk emails trashed`)
    log('══════════════════════════════════════')
  } catch (e) {
    err('Pipeline error:', e.message)
    err(e.stack)
  }
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
