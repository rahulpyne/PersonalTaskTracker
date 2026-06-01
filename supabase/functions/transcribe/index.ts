/**
 * Supabase Edge Function — Whisper Transcription
 *
 * POST /functions/v1/transcribe
 * Body: multipart/form-data
 *   audio  : File  — recorded audio (webm / ogg / mp4 / wav)
 *   prompt : string (optional) — hint to improve accuracy (e.g. "task tracker")
 *
 * Returns: { text: string }
 *
 * Uses Groq's free whisper-large-v3-turbo model.
 * Set secret: npx supabase secrets set GROQ_API_KEY=gsk_...
 * Get free key: https://console.groq.com
 */

const GROQ_API_KEY = Deno.env.get('GROQ_API_KEY')
const GROQ_URL     = 'https://api.groq.com/openai/v1/audio/transcriptions'

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  })
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })
  if (req.method !== 'POST')   return new Response('method not allowed', { status: 405 })

  if (!GROQ_API_KEY) {
    return json({
      error: 'GROQ_API_KEY not configured. Run: npx supabase secrets set GROQ_API_KEY=gsk_... (free key at console.groq.com)',
    }, 500)
  }

  let form: FormData
  try { form = await req.formData() }
  catch { return json({ error: 'Expected multipart/form-data with an "audio" field' }, 400) }

  const audioEntry = form.get('audio')
  if (!audioEntry || !(audioEntry instanceof File)) {
    return json({ error: 'Missing "audio" file field' }, 400)
  }

  // Map MIME → file extension Groq accepts
  const mimeMap: Record<string, string> = {
    'audio/webm': 'webm',
    'audio/ogg':  'ogg',
    'audio/mp4':  'mp4',
    'audio/mpeg': 'mp3',
    'audio/wav':  'wav',
    'audio/x-wav': 'wav',
  }
  const baseMime = audioEntry.type.split(';')[0].trim()
  const ext      = mimeMap[baseMime] ?? 'webm'

  const groqForm = new FormData()
  const fileBytes = await audioEntry.arrayBuffer()
  groqForm.append('file', new File([fileBytes], `audio.${ext}`, { type: audioEntry.type }))
  groqForm.append('model', 'whisper-large-v3-turbo')
  groqForm.append('response_format', 'json')
  groqForm.append('language', 'en')

  const hint = form.get('prompt')
  if (hint && typeof hint === 'string' && hint.trim()) {
    groqForm.append('prompt', hint.trim())
  }

  const resp = await fetch(GROQ_URL, {
    method:  'POST',
    headers: { 'Authorization': `Bearer ${GROQ_API_KEY}` },
    body:    groqForm,
  })

  const result = await resp.json()

  if (!resp.ok) {
    const msg = result?.error?.message ?? `Groq error ${resp.status}`
    console.error('Groq transcription failed:', msg)
    return json({ error: msg }, resp.status)
  }

  return json({ text: (result.text ?? '').trim() })
})
