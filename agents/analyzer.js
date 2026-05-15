/**
 * Agent 2 — Email Analyzer
 * Uses Gemini to score each email's importance and decide if it needs action.
 * Cheap model pass: gemini-2.0-flash-lite is fine for binary classification.
 */
import { jsonPrompt } from './lib/llm.js'
import { log, warn } from './lib/logger.js'

function buildPrompt(email) {
  return `
You are a personal assistant helping classify emails for a busy professional.
Determine if this email genuinely requires a personal action, reply, or decision.

Email:
  Subject : ${email.subject}
  From    : ${email.from}
  Date    : ${email.date}
  Preview : ${email.body.slice(0, 1200)}

Rules:
- "actionable" = true only if the email requires a reply, task, purchase decision, or personal follow-up
- Newsletters, receipts, shipping notifications, automated alerts → always false
- Score "importance" 1-10 based on urgency and sender relationship (10 = time-sensitive from real person)
- Keep "action_description" to one concise sentence

Respond with valid JSON matching this exact shape:
{
  "actionable": true,
  "importance": 7,
  "action_description": "Reply to confirm meeting time for Thursday"
}
`.trim()
}

export async function run(emails, model, { threshold = 6 } = {}) {
  log(`EmailAnalyzer: scoring ${emails.length} emails`)
  const actionable = []

  for (const email of emails) {
    try {
      const res = await jsonPrompt(model, buildPrompt(email))

      if (res.actionable === true && (res.importance ?? 0) >= threshold) {
        actionable.push({ email, importance: res.importance, action_description: res.action_description })
        log(`EmailAnalyzer: ✓ [${res.importance}/10] "${email.subject}"`)
      }
    } catch (e) {
      warn(`EmailAnalyzer: failed on "${email.subject}" — ${e.message}`)
    }
  }

  log(`EmailAnalyzer: ${actionable.length} / ${emails.length} emails are actionable`)
  return actionable
}
