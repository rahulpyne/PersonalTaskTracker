/**
 * Supabase Edge Function — AI Note Structurer
 *
 * POST /functions/v1/ai-notes
 * Body: {
 *   text: string        // raw voice transcript or unstructured text
 *   mode: 'voice'       // from voice recording
 *        | 'structure'  // restructure existing note body
 * }
 *
 * Returns: { title, body, tags }
 */

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY')!

const GEMINI_MODELS = [
  'gemini-2.5-flash-lite',
  'gemini-2.5-flash',
  'gemini-1.5-flash',
]
const geminiUrl = (model: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`

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

  let body: { text: string; mode?: string }
  try { body = await req.json() } catch { return new Response('invalid json', { status: 400 }) }

  const { text, mode = 'structure' } = body
  if (!text?.trim()) return new Response('text is required', { status: 400 })

  const prompt = buildPrompt(text.trim(), mode)
  const sleep  = (ms: number) => new Promise(r => setTimeout(r, ms))

  async function callGemini(model: string) {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt > 0) await sleep(1500)

      const resp = await fetch(geminiUrl(model), {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            responseMimeType: 'application/json',
            temperature: 0.35,
            maxOutputTokens: 1024,
          },
        }),
      })
      const json = await resp.json()

      if (!resp.ok) {
        const msg = json?.error?.message ?? ''
        if (/high demand|overload|rate|quota|503|529/i.test(msg) && attempt === 0) continue
        throw new Error(msg || `HTTP ${resp.status}`)
      }

      const raw = json?.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
      if (!raw) throw new Error('empty response')

      const parsed = JSON.parse(raw.trim())
      return parsed
    }
    throw new Error('retries exhausted')
  }

  let result: { title: string; body: string; tags: string[] } | null = null
  let lastError = ''

  for (const model of GEMINI_MODELS) {
    try {
      result = await callGemini(model)
      console.log(`ai-notes: used ${model}`)
      break
    } catch (e) {
      lastError = (e as Error).message
      const fatal = !/high demand|overload|rate|quota|503|529|not found|404/i.test(lastError)
      console.warn(`ai-notes: ${model} failed — ${lastError}`)
      if (fatal) break
    }
  }

  if (!result) {
    return new Response(JSON.stringify({ error: lastError }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    })
  }

  return new Response(JSON.stringify(result), {
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  })
})

function buildPrompt(text: string, mode: string): string {
  const modeHint = mode === 'voice'
    ? `This is a raw voice transcript — the user was thinking out loud. It may have filler words, run-on sentences, or jump between ideas.`
    : `This is unstructured written text that needs to be organized into a clear note.`

  return `
You are an expert note-taking assistant. ${modeHint}

Transform the following input into a clean, structured personal note.

Rules:
- Extract a concise, descriptive title (max 60 chars, no fluff)
- Organize the content with markdown: ## headings, bullet lists, **bold** for key terms
- Group related ideas together — cut filler words ("um", "like", "you know")
- If there are action items, put them in an "## Action Items" section with checkboxes: - [ ] item
- If there are questions or things to research, put them in a "## Questions" section
- Identify 2–5 relevant lowercase tags (single words or hyphenated, no spaces)
- Keep the user's voice and ideas — don't over-sanitize

Input:
"""
${text.slice(0, 4000)}
"""

Return ONLY valid JSON (no markdown wrapper):
{
  "title": "string",
  "body": "string (markdown)",
  "tags": ["string", ...]
}
`.trim()
}
