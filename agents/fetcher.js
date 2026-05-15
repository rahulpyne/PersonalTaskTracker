/**
 * Agent 1 — Gmail Fetcher
 * Pulls emails from Primary inbox (last N hours), applies strict sender
 * validation so only real people — not bots, roles, or bulk mailers — pass through.
 */
import { decodeBody, getHeader } from './lib/gmail.js'
import { log, warn } from './lib/logger.js'

// ── Sender noise patterns ─────────────────────────────────────────────────────

// Patterns in the full From header (name + email)
const NOISE_FROM = /noreply|no-reply|donotreply|mailer-daemon|newsletter|unsubscribe|automated|bounce|postmaster/i

// Role/functional addresses that are never from a real individual
const ROLE_LOCAL = /^(noreply|no.reply|donotreply|support|info|help|billing|sales|admin|marketing|news|notifications?|alerts?|updates?|team|hello|hi|contact|feedback|enquir|service|security|privacy|legal|press|jobs|careers|hr|bot|daemon|mailer|listserv|majordomo|bounce|abuse|postmaster|webmaster|hostmaster|root)$/i

// Known bulk email sending domains / infrastructure
const BULK_DOMAINS = /\.(sendgrid\.net|mailchimp\.com|klaviyo\.com|constantcontact\.com|campaign-archive\.com|mailgun\.org|sparkpostmail\.com|amazonses\.com|mandrill\.com|mcsv\.net|list-manage\.com|createsend\.com)$/i

/**
 * Returns true only if the From header looks like a real person.
 *
 * Accepted:  "Priya Singh <priya@startup.io>"
 *            "john.doe@company.com"
 * Rejected:  "Support <support@company.com>"
 *            "no-reply@medium.com"
 *            "Team Notion <hello@notify.notion.so>"
 */
function isPersonalSender(from) {
  if (!from) return false

  // Quick pattern check on the whole header string
  if (NOISE_FROM.test(from)) return false

  // Extract the raw email address
  const emailMatch = from.match(/<([^>]+)>/) || from.match(/^([^\s,]+@[^\s,]+)/)
  if (!emailMatch) return false
  const email = emailMatch[1].toLowerCase().trim()

  if (!email.includes('@')) return false

  const [localPart, domain] = email.split('@')
  if (!localPart || !domain) return false

  // Reject known bulk-sending domains
  if (BULK_DOMAINS.test(domain)) return false

  // Reject role/functional local parts
  if (ROLE_LOCAL.test(localPart)) return false

  // Reject if local part looks automated: contains words like "notify", "alert"
  if (/notify|alert|daemon|bounce|noreply/i.test(localPart)) return false

  // Require a valid-looking domain (at least one dot, proper TLD)
  if (!/^[a-z0-9][a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) return false

  return true
}

export async function run(gmail, {
  user          = 'me',
  lookbackHours = 24,
  maxResults    = 75,
} = {}) {
  log('GmailFetcher: starting')

  const sinceEpochSec = Math.floor((Date.now() - lookbackHours * 3_600_000) / 1000)

  // Only pull from Primary — Gmail already segregates the rest
  const { data } = await gmail.users.messages.list({
    userId:     user,
    q:          `after:${sinceEpochSec} category:primary -label:sent`,
    maxResults,
  })

  const messageList = data.messages || []
  log(`GmailFetcher: ${messageList.length} candidates in Primary`)

  const emails = []
  for (const { id } of messageList) {
    try {
      const { data: msg } = await gmail.users.messages.get({
        userId: user,
        id,
        format: 'full',
      })

      const headers = msg.payload.headers
      const from    = getHeader(headers, 'from')
      const subject = getHeader(headers, 'subject')
      const date    = getHeader(headers, 'date')

      if (!isPersonalSender(from)) {
        log(`GmailFetcher: skip (non-personal sender) — ${from}`)
        continue
      }

      const body = decodeBody(msg.payload).slice(0, 2500)
      emails.push({ id, threadId: msg.threadId, from, subject, date, body, snippet: msg.snippet })
    } catch (e) {
      warn(`GmailFetcher: skipped message ${id} — ${e.message}`)
    }
  }

  log(`GmailFetcher: returning ${emails.length} emails from real people`)
  return emails
}
