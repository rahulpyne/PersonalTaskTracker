/**
 * Shared voice recording + Whisper transcription utilities.
 * Used by the task Composer and the Notes voice panel.
 *
 * Recording uses the browser's MediaRecorder API (no extra deps).
 * Transcription calls the deployed `transcribe` Supabase edge function
 * which proxies to Groq's free whisper-large-v3-turbo model.
 */

let _recorder = null
let _stream   = null
let _chunks   = []

// Preferred MIME types — ordered by quality / compatibility
const MIME_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
  'audio/ogg',
  'audio/mp4',
]

function bestMime() {
  if (typeof MediaRecorder === 'undefined') return ''
  return MIME_TYPES.find(t => MediaRecorder.isTypeSupported(t)) ?? ''
}

/**
 * Start recording from the user's microphone.
 * Throws if mic permission is denied.
 */
export async function startRecording() {
  if (_recorder) return  // already recording

  _stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })

  const mimeType = bestMime()
  _recorder = new MediaRecorder(_stream, mimeType ? { mimeType } : {})
  _chunks   = []

  _recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) _chunks.push(e.data)
  }

  _recorder.start(200)  // fire ondataavailable every 200 ms
}

/**
 * Stop recording and return an audio Blob.
 * Returns null if nothing was recorded.
 */
export function stopRecording() {
  return new Promise((resolve, reject) => {
    if (!_recorder || _recorder.state === 'inactive') {
      cleanupRecording()
      resolve(null)
      return
    }

    _recorder.onstop = () => {
      const blob = new Blob(_chunks, { type: _recorder?.mimeType || 'audio/webm' })
      cleanupRecording()
      resolve(blob)
    }

    _recorder.onerror = (e) => {
      cleanupRecording()
      reject(e.error ?? new Error('Recording error'))
    }

    _recorder.stop()
  })
}

function cleanupRecording() {
  _stream?.getTracks().forEach(t => t.stop())
  _recorder = null
  _stream   = null
  _chunks   = []
}

/** True while MediaRecorder is actively capturing */
export function isCurrentlyRecording() {
  return !!_recorder && _recorder.state === 'recording'
}

/**
 * Send an audio Blob to Groq Whisper for transcription.
 *
 * If VITE_GROQ_API_KEY is set in .env.local, calls Groq directly from
 * the browser (no edge function needed).
 * Falls back to the Supabase `transcribe` edge function otherwise.
 *
 * @param {Blob}   blob    Audio blob from stopRecording()
 * @param {string} prompt  Optional context hint for Whisper
 */
export async function transcribeAudio(blob, prompt = '') {
  const groqKey = import.meta.env.VITE_GROQ_API_KEY

  if (groqKey) {
    // ── Direct Groq path (no edge function needed) ──────────────────
    const form = new FormData()
    form.append('file', blob, 'recording.webm')
    form.append('model', 'whisper-large-v3-turbo')
    form.append('response_format', 'json')
    form.append('language', 'en')
    if (prompt) form.append('prompt', prompt)

    const resp = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method:  'POST',
      headers: { 'Authorization': `Bearer ${groqKey}` },
      body:    form,
    })

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}))
      throw new Error(err?.error?.message ?? `Groq error (HTTP ${resp.status})`)
    }

    const { text } = await resp.json()
    return (text ?? '').trim()
  }

  // ── Fallback: Supabase edge function ────────────────────────────
  const url    = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/transcribe`
  const apiKey = import.meta.env.VITE_SUPABASE_ANON_KEY

  const form = new FormData()
  form.append('audio', blob, 'recording.webm')
  if (prompt) form.append('prompt', prompt)

  const resp = await fetch(url, {
    method:  'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'apikey': apiKey },
    body:    form,
  })

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}))
    throw new Error(err.error ?? `Transcription failed (HTTP ${resp.status})`)
  }

  const { text } = await resp.json()
  return (text ?? '').trim()
}

/** Check that the browser can record audio */
export function isVoiceSupported() {
  return !!(
    typeof navigator !== 'undefined' &&
    navigator.mediaDevices?.getUserMedia &&
    typeof MediaRecorder !== 'undefined'
  )
}
