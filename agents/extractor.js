/**
 * Agent 3 — Task Extractor
 * Uses Gemini to convert each actionable email into a parent task + subtasks.
 * Priority is inferred from urgency language, sender context, and importance score.
 */
import { jsonPrompt } from './lib/llm.js'
import { log, warn } from './lib/logger.js'

function buildPrompt({ email, importance, action_description }) {
  const urgency = importance >= 9 ? 'URGENT' : importance >= 7 ? 'important' : 'normal priority'
  return `
You are a productivity assistant. Convert this email action item into a structured task hierarchy.

Email:
  Subject    : ${email.subject}
  From       : ${email.from}
  Urgency    : ${urgency} (score ${importance}/10)
  Action     : ${action_description}

Instructions:
- Create ONE clear parent task title (≤ 60 chars, starts with an action verb)
- Create 2-4 specific subtasks that together complete the parent task (≤ 50 chars each)
- Assign "priority" to each item: "high" (urgent / has deadline), "med" (important, flexible), "low" (nice to do)
- Parent priority should reflect the overall email urgency
- "notes" on the parent = one sentence with email context (sender + key detail)
- Subtasks should be ordered from most to least urgent

Respond with valid JSON matching this exact shape:
{
  "task": {
    "title":    "Reply to Priya about Thursday investor call",
    "priority": "high",
    "notes":    "From Priya Singh — needs confirmation by EOD Wednesday"
  },
  "subtasks": [
    { "title": "Check calendar for Thursday 4pm slot",  "priority": "high" },
    { "title": "Draft reply confirming attendance",      "priority": "high" },
    { "title": "Share dial-in link with Priya",         "priority": "med"  }
  ]
}
`.trim()
}

export async function run(analyzedEmails, model) {
  log(`TaskExtractor: extracting from ${analyzedEmails.length} emails`)
  const groups = []

  for (const item of analyzedEmails) {
    try {
      const res = await jsonPrompt(model, buildPrompt(item))

      // Normalise priority values defensively
      const normPrio = p => ['high', 'med', 'low'].includes(p) ? p : 'med'

      groups.push({
        sourceId: item.email.id,
        parent: {
          title:    res.task.title,
          priority: normPrio(res.task.priority),
          notes:    `📧 From: ${item.email.from}\nSubject: ${item.email.subject}\n\n${res.task.notes || ''}`,
          source:   `email:${item.email.id}`,
        },
        subtasks: (res.subtasks || []).map(s => ({
          title:    s.title,
          priority: normPrio(s.priority),
          source:   `email:${item.email.id}`,
        })),
      })

      log(`TaskExtractor: ✓ "${res.task.title}" (${res.subtasks?.length ?? 0} subtasks)`)
    } catch (e) {
      warn(`TaskExtractor: failed on "${item.email.subject}" — ${e.message}`)
    }
  }

  log(`TaskExtractor: ${groups.length} task groups ready`)
  return groups
}
