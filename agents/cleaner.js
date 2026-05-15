/**
 * Agent 5 — Gmail Cleaner
 *
 * Moves emails older than CLEAN_OLDER_THAN_DAYS to Trash from:
 *   - Spam
 *   - Promotions
 *   - Social
 *   - Updates
 *
 * Primary inbox is NEVER touched.
 * Uses batchModify (50 per call) to stay within Gmail API rate limits.
 * Requires gmail.modify scope.
 */
import { log, warn } from './lib/logger.js'

const CATEGORIES = [
  { label: 'Spam',       query: 'in:spam'             },
  { label: 'Promotions', query: 'category:promotions' },
  { label: 'Social',     query: 'category:social'     },
  { label: 'Updates',    query: 'category:updates'    },
]

const BATCH_SIZE    = 50   // Gmail batchModify limit
const MAX_PER_CAT   = 500  // safety cap per category per run

export async function run(gmail, {
  user           = 'me',
  olderThanDays  = 7,
  maxPerCategory = MAX_PER_CAT,
} = {}) {
  log('GmailCleaner: starting')

  // Only touch emails older than N days so recent ones stay visible
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - olderThanDays)
  const beforeEpoch = Math.floor(cutoff.getTime() / 1000)

  let totalTrashed = 0

  for (const { label, query } of CATEGORIES) {
    try {
      const { data } = await gmail.users.messages.list({
        userId:     user,
        q:          `${query} before:${beforeEpoch}`,
        maxResults: maxPerCategory,
      })

      const messages = data.messages || []
      if (!messages.length) {
        log(`GmailCleaner: ${label} — nothing to clean`)
        continue
      }

      log(`GmailCleaner: ${label} — ${messages.length} emails to trash`)

      // Batch into groups of BATCH_SIZE
      const ids = messages.map(m => m.id)
      for (let i = 0; i < ids.length; i += BATCH_SIZE) {
        const chunk = ids.slice(i, i + BATCH_SIZE)
        await gmail.users.messages.batchModify({
          userId: user,
          requestBody: {
            ids:             chunk,
            addLabelIds:     ['TRASH'],
            removeLabelIds:  ['UNREAD'],
          },
        })
        totalTrashed += chunk.length
      }

      log(`GmailCleaner: ${label} — ✓ ${messages.length} trashed`)
    } catch (e) {
      warn(`GmailCleaner: ${label} failed — ${e.message}`)
    }
  }

  log(`GmailCleaner: done — ${totalTrashed} emails moved to trash`)
  return { trashed: totalTrashed }
}
