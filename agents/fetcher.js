/**
 * Agent 1 — Gmail Fetcher
 * Pulls emails from the last N hours, strips noise, returns clean thread objects.
 */
import { decodeBody, getHeader } from './lib/gmail.js'
import { log, warn } from './lib/logger.js'

// Senders that are never actionable
const NOISE_SENDER = /noreply|no-reply|donotreply|notifications?@|mailer-daemon|newsletter|unsubscribe|automated/i

export async function run(gmail, {
  user          = 'me',
  lookbackHours = 24,
  maxResults    = 75,
} = {}) {
  log('GmailFetcher: starting')

  const sinceEpochSec = Math.floor((Date.now() - lookbackHours * 3_600_000) / 1000)

  const { data } = await gmail.users.messages.list({
    userId:     user,
    q:          `after:${sinceEpochSec} -category:promotions -category:social -category:updates -label:sent`,
    maxResults,
  })

  const messageList = data.messages || []
  log(`GmailFetcher: ${messageList.length} candidates`)

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

      if (NOISE_SENDER.test(from)) continue

      const body = decodeBody(msg.payload).slice(0, 2500)
      emails.push({ id, threadId: msg.threadId, from, subject, date, body, snippet: msg.snippet })
    } catch (e) {
      warn(`GmailFetcher: skipped message ${id} — ${e.message}`)
    }
  }

  log(`GmailFetcher: returning ${emails.length} clean emails`)
  return emails
}
