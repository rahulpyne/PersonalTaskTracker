/**
 * Supabase Edge Function — AI Subtask Generator
 *
 * POST /functions/v1/ai-subtasks
 * Body: { taskId: string, taskTitle: string, taskCategory: string, taskNotes?: string }
 *
 * Calls Gemini to:
 *   1. Break the task into 3–7 ordered, actionable subtasks
 *   2. Assign each a priority (high/medium/low) and weight (1–3)
 *   3. For research-oriented subtasks: surface 1–3 concrete resource URLs
 *
 * Persists subtasks as child rows in `tasks` (parent_id = taskId) and returns them.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const GEMINI_API_KEY       = Deno.env.get('GEMINI_API_KEY')!

// Model cascade: lite → full flash (fallback if lite overloaded)
const GEMINI_MODELS = [
  'gemini-2.5-flash-lite',
  'gemini-2.5-flash',
  'gemini-1.5-flash',
]
const geminiUrl = (model: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`

// ── Types ─────────────────────────────────────────────────────────────────────
interface SubtaskSpec {
  title:       string
  priority:    'high' | 'medium' | 'low'
  weight:      1 | 2 | 3   // 1=low satisfaction impact, 3=high
  order_index: number
  notes:       string       // context + formatted links
  needs_research: boolean
}

// ── Main ─────────────────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin':  '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey',
      },
    })
  }

  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 })

  let body: Record<string, string>
  try { body = await req.json() } catch { return new Response('invalid json', { status: 400 }) }

  const { taskId, taskTitle, taskCategory, taskNotes } = body
  if (!taskId || !taskTitle) return new Response('taskId and taskTitle required', { status: 400 })

  // ── Call Gemini — cascade through models until one succeeds ───────────────
  const prompt = buildPrompt(taskTitle, taskCategory ?? 'work', taskNotes ?? '')

  const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

  async function callGemini(model: string): Promise<SubtaskSpec[]> {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt > 0) await sleep(1500)  // brief back-off on retry

      const gemResp = await fetch(geminiUrl(model), {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            responseMimeType: 'application/json',
            temperature: 0.4,
            maxOutputTokens: 2048,
          },
        }),
      })
      const gemJson = await gemResp.json()

      // Retry-able: model overloaded or rate-limited
      if (!gemResp.ok) {
        const msg: string = gemJson?.error?.message ?? ''
        const retryable = /high demand|overload|rate|quota|503|529/i.test(msg)
        if (retryable && attempt === 0) continue   // try same model once more
        throw new Error(msg || `HTTP ${gemResp.status}`)
      }

      const raw: string = gemJson?.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
      if (!raw) throw new Error('empty Gemini response')

      // Repair truncated JSON: find last complete object and close the array
      let repaired = raw.trim()
      if (!repaired.endsWith(']')) {
        const lastBrace = repaired.lastIndexOf('}')
        repaired = lastBrace !== -1 ? repaired.slice(0, lastBrace + 1) + ']' : '[]'
      }
      const parsed = JSON.parse(repaired)
      const specs = Array.isArray(parsed) ? parsed : parsed.subtasks
      if (!Array.isArray(specs)) throw new Error('unexpected Gemini response shape')
      return specs
    }
    throw new Error('Gemini retries exhausted')
  }

  let subtaskSpecs: SubtaskSpec[] = []
  let lastError = ''
  let succeeded = false
  for (const model of GEMINI_MODELS) {
    try {
      subtaskSpecs = await callGemini(model)
      console.log(`ai-subtasks: used model ${model}`)
      succeeded = true
      break
    } catch (e) {
      lastError = (e as Error).message
      const fatal = !/high demand|overload|rate|quota|503|529|not found|404/i.test(lastError)
      console.warn(`ai-subtasks: model ${model} failed — ${lastError}${fatal ? ' (fatal)' : ' (trying next)'}`)
      if (fatal) break   // don't try other models on non-retryable errors
    }
  }

  if (!succeeded) {
    return new Response(JSON.stringify({ error: `AI error: ${lastError}` }), {
      status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    })
  }

  // ── Persist to Supabase ────────────────────────────────────────────────────
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

  // Delete any existing AI subtasks for this task (re-generate is a replace)
  await supabase.from('tasks').delete().eq('parent_id', taskId).eq('ai_generated', true)

  const rows = subtaskSpecs.map((s, i) => ({
    parent_id:    taskId,
    text:         s.title.trim(),
    type:         taskCategory ?? 'work',
    prio:         s.priority === 'medium' ? 'med' : (s.priority ?? 'med'),
    weight:       Math.max(1, Math.min(3, Number(s.weight) || 2)),
    context:      s.notes ?? '',
    done:         false,
    done_at:      null,
    ai_generated: true,
    position:     i,
  }))

  const { data: inserted, error: dbErr } = await supabase
    .from('tasks')
    .insert(rows)
    .select()

  if (dbErr) {
    console.error('DB error:', dbErr.message)
    return new Response(JSON.stringify({ error: dbErr.message }), {
      status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    })
  }

  return new Response(JSON.stringify({ subtasks: inserted }), {
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  })
})

// ── Prompt builder ────────────────────────────────────────────────────────────
function buildPrompt(title: string, category: string, notes: string): string {
  return `
You are a productivity assistant. Break this ${category} task into 3–7 concrete, ordered subtasks.

Task: "${title}"
${notes ? `Context: "${notes.slice(0, 300)}"` : ''}

Rules:
- Each subtask must be actionable and specific (not vague like "research the topic")
- Order subtasks logically — prerequisites first
- Assign priority: "high" (blocks completion), "medium" (important), "low" (nice-to-have)
- Assign weight 1–3: how much completing THIS subtask contributes to finishing the overall task
  (3 = core/critical step, 2 = important supporting step, 1 = minor/polish step)
- If a subtask requires web research or reading external material, set needs_research: true
  AND include 1–3 real, concrete resource URLs in notes (actual websites, docs, tools)
- notes should be ≤ 120 chars; format links as "🔗 [Title](URL)"
- Keep subtask titles concise (≤ 60 chars)

Return ONLY a JSON array (no markdown, no explanation):
[
  {
    "title": "string",
    "priority": "high" | "medium" | "low",
    "weight": 1 | 2 | 3,
    "order_index": 0,
    "needs_research": true | false,
    "notes": "string (empty or resource links)"
  },
  ...
]
`.trim()
}
