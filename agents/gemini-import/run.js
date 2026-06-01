#!/usr/bin/env node
/**
 * Gemini Takeout → Supabase Notes Import
 * =======================================
 * Reads a Google Takeout JSON export of your Gemini conversations and
 * upserts each one into the Supabase `notes` table so it appears in
 * the app's Graph view.
 *
 * HOW TO GET YOUR EXPORT
 * ──────────────────────
 * 1. Go to https://takeout.google.com
 * 2. Click "Deselect all"
 * 3. Scroll down and enable ONLY "Gemini Apps Activity"
 * 4. Click "Next step" → "Create export"
 * 5. Download the ZIP when the email arrives
 * 6. Unzip it — find the JSON file inside:
 *      Takeout/Gemini Apps Activity/MyActivity.json
 *      (or Bard Activity / Conversations / similar folder name)
 * 7. Drop that JSON file here:
 *      agents/gemini-import/MyActivity.json
 * 8. Run: node agents/gemini-import/run.js
 *
 * USAGE
 * ──────────────────────
 *   node agents/gemini-import/run.js              # import new conversations
 *   node agents/gemini-import/run.js --dry-run    # preview without writing
 *   node agents/gemini-import/run.js --reimport   # re-import already-seen ones
 *   node agents/gemini-import/run.js --file path/to/file.json
 */

import { createClient } from '@supabase/supabase-js'
import fs               from 'fs'
import path             from 'path'
import crypto           from 'crypto'
import { fileURLToPath } from 'url'

const __dirname  = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT  = path.resolve(__dirname, '../..')
const DRY_RUN    = process.argv.includes('--dry-run')
const REIMPORT   = process.argv.includes('--reimport')
const FILE_ARG   = process.argv.find(a => a.startsWith('--file='))?.split('=').slice(1).join('=')

// ── Load env ──────────────────────────────────────────────────────────────────
function loadEnv() {
  const env = {}
  try {
    fs.readFileSync(path.join(REPO_ROOT, '.env.local'), 'utf8')
      .split('\n')
      .forEach(line => {
        const m = line.match(/^([A-Z_]+)=(.*)$/)
        if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
      })
  } catch {}
  return env
}

const env          = loadEnv()
const SUPABASE_URL = env.VITE_SUPABASE_URL      || process.env.VITE_SUPABASE_URL
const SUPABASE_KEY = env.VITE_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY
const AI_NOTES_URL = SUPABASE_URL ? `${SUPABASE_URL}/functions/v1/ai-notes` : null

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('✗  Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY in .env.local')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

// ── Find the export file ──────────────────────────────────────────────────────
function findExportFile() {
  if (FILE_ARG) return FILE_ARG

  // Common names Google Takeout uses
  const candidates = [
    path.join(__dirname, 'MyActivity.json'),
    path.join(__dirname, 'my_activity.json'),
    path.join(__dirname, 'conversations.json'),
    path.join(__dirname, 'Conversations.json'),
    path.join(__dirname, 'BardActivity.json'),
  ]

  // Also check one level up (Takeout folder structure)
  const downloadsBase = path.join(process.env.HOME || '~', 'Downloads')
  const takeoutDirs = ['Takeout/Gemini Apps Activity', 'Takeout/Bard Activity', 'Takeout/Gemini']
  for (const dir of takeoutDirs) {
    candidates.push(
      path.join(downloadsBase, dir, 'MyActivity.json'),
      path.join(downloadsBase, dir, 'my_activity.json'),
    )
  }

  return candidates.find(f => fs.existsSync(f)) || null
}

// ── Detect and normalise Takeout format ───────────────────────────────────────
//
// Google Takeout has shipped several formats over time:
//
// Format A — Activity log (no conversation content, just titles + timestamps)
//   [ { "title": "Talked with Gemini", "time": "...", "titleUrl": "..." }, ... ]
//
// Format B — Full conversations (newer Takeout)
//   [ { "title": "...", "createTime": "...", "conversation": [
//       { "role": "user", "parts": [{ "text": "..." }] }, ... ]
//   }, ... ]
//
// Format C — Nested structure
//   { "conversations": [ ... ] }
//
// Format D — Bard/Gemini history with "textPayload"
//   [ { "title": "...", "time": "...", "subtitles": [{ "name": "..." }] }, ... ]

function parseExport(raw) {
  let data = raw
  if (!Array.isArray(data)) {
    data = raw.conversations ?? raw.items ?? raw.data ?? Object.values(raw)
  }
  if (!Array.isArray(data)) throw new Error('Unrecognised JSON structure')

  const conversations = []

  for (const item of data) {
    // Format B — has a "conversation" array with actual content
    if (Array.isArray(item.conversation)) {
      const userTexts = item.conversation
        .filter(m => m.role === 'user' || m.author?.role === 'user')
        .flatMap(m => {
          const parts = m.parts || m.content?.parts || []
          return parts.map(p => (typeof p === 'string' ? p : p.text || '')).filter(Boolean)
        })
      if (userTexts.length === 0) continue
      conversations.push({
        id:        stableId(item.title || '', item.createTime || item.time || ''),
        title:     item.title || '',
        time:      item.createTime || item.updateTime || item.time || null,
        userTexts,
      })
      continue
    }

    // Format B variant — "messages" array
    if (Array.isArray(item.messages)) {
      const userTexts = item.messages
        .filter(m => (m.role || m.author) === 'user')
        .map(m => m.content || m.text || '')
        .filter(Boolean)
      if (userTexts.length === 0) continue
      conversations.push({
        id:        stableId(item.title || '', item.createTime || item.time || ''),
        title:     item.title || '',
        time:      item.createTime || item.time || null,
        userTexts,
      })
      continue
    }

    // Format A / D — activity log, only has the title (no message content)
    if (item.title && (item.time || item.date)) {
      const text = [
        item.title,
        ...(item.subtitles || []).map(s => s.name || s.text || ''),
      ].filter(Boolean).join(' ')

      conversations.push({
        id:        stableId(item.title, item.time || ''),
        title:     item.title,
        time:      item.time || null,
        userTexts: [text],   // use the title/subtitle as the only signal
        titleOnly: true,
      })
    }
  }

  return conversations
}

function stableId(title, time) {
  return crypto.createHash('sha1').update(`${title}::${time}`).digest('hex').slice(0, 32)
}

// ── AI structuring via ai-notes edge function ─────────────────────────────────
async function structureConversation(conv) {
  const text = conv.userTexts
    .map((t, i) => `[Turn ${i + 1}] ${t.slice(0, 500)}`)
    .join('\n\n')

  const contextText = conv.titleOnly
    ? `Gemini conversation titled: "${conv.title}"\n\nNote: Only the title is available — no conversation content was exported.`
    : `Gemini conversation: "${conv.title}"\n\n${text}`

  try {
    const resp = await fetch(AI_NOTES_URL, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'apikey':        SUPABASE_KEY,
      },
      body: JSON.stringify({ text: contextText.slice(0, 4800), mode: 'voice' }),
    })

    if (resp.ok) {
      const result = await resp.json()
      if (result?.title) {
        result.tags = [...new Set(['gemini-chat', ...(result.tags || [])])]
        return result
      }
    }
  } catch {}

  // Fallback
  return {
    title: (conv.title || 'Gemini Chat').slice(0, 55),
    body:  `## Conversation\n\n${text.slice(0, 2000)}`,
    tags:  ['gemini-chat'],
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n✦  Gemini → Supabase\n')

  const exportFile = findExportFile()
  if (!exportFile) {
    console.error(`✗  No export file found.

  Drop your Gemini Takeout JSON here:
    agents/gemini-import/MyActivity.json

  Or pass the path explicitly:
    node agents/gemini-import/run.js --file=/path/to/MyActivity.json

  HOW TO EXPORT:
    1. Go to https://takeout.google.com
    2. Click "Deselect all"
    3. Enable "Gemini Apps Activity" only
    4. Export → download ZIP → unzip
    5. Copy the JSON file from the Takeout folder here
`)
    process.exit(1)
  }

  console.log(`File      : ${exportFile}`)
  console.log(`AI Notes  : ${AI_NOTES_URL ? '✓ edge function' : '✗ unavailable'}`)
  console.log(`Mode      : ${DRY_RUN ? 'DRY RUN (no writes)' : 'LIVE'}`)
  console.log(`Reimport  : ${REIMPORT ? 'yes' : 'no'}\n`)

  // Parse export
  let raw
  try {
    raw = JSON.parse(fs.readFileSync(exportFile, 'utf8'))
  } catch (e) {
    console.error('✗  Could not parse JSON:', e.message)
    process.exit(1)
  }

  let conversations
  try {
    conversations = parseExport(raw)
  } catch (e) {
    console.error('✗  Unrecognised format:', e.message)
    console.error('   Please open an issue or paste the first 5 lines of the file.')
    process.exit(1)
  }

  console.log(`Found ${conversations.length} conversations in export\n`)

  if (conversations.length === 0) {
    console.log('Nothing to import.')
    return
  }

  // Fetch already-imported IDs
  let alreadyImported = new Set()
  if (!REIMPORT) {
    const { data } = await supabase
      .from('notes')
      .select('source_ref')
      .eq('source', 'gemini')
      .not('source_ref', 'is', null)
    alreadyImported = new Set((data || []).map(n => n.source_ref))
    console.log(`Already in DB: ${alreadyImported.size}\n`)
  }

  let newCount = 0, skipCount = 0, failCount = 0

  for (const conv of conversations) {
    if (alreadyImported.has(conv.id)) {
      skipCount++
      continue
    }

    const label = (conv.title || 'untitled').slice(0, 50)
    process.stdout.write(`  ${label.padEnd(52)} `)

    const result = await structureConversation(conv)
    const tags   = [...new Set(['gemini-chat', ...(result.tags || [])])]
    const ts     = conv.time ? new Date(conv.time).toISOString() : new Date().toISOString()
    const body   = `*Source: Gemini · ${new Date(ts).toLocaleDateString('en', { year: 'numeric', month: 'short', day: 'numeric' })}*\n\n${result.body}`

    if (DRY_RUN) {
      process.stdout.write(`[dry] "${result.title}"  [${tags.slice(0, 3).join(', ')}…]\n`)
      newCount++
      continue
    }

    const { error } = await supabase.from('notes').insert({
      title:      result.title,
      body,
      tags,
      source:     'gemini',
      source_ref: conv.id,
      created_at: ts,
      updated_at: ts,
    })

    if (error) {
      if (error.code === '23505') {
        process.stdout.write(`skip (duplicate)\n`)
        skipCount++
      } else {
        process.stdout.write(`✗  ${error.message}\n`)
        failCount++
      }
    } else {
      process.stdout.write(`✓  "${result.title}"\n`)
      newCount++
    }

    await new Promise(r => setTimeout(r, 350))
  }

  console.log('\n' + '─'.repeat(60))
  console.log(`✅  Done!   New: ${newCount}  |  Skipped: ${skipCount}  |  Failed: ${failCount}`)
  if (!DRY_RUN && newCount > 0) {
    console.log('\n   Open the app → Graph to see your Gemini conversations.\n')
  }
}

main().catch(e => { console.error('\n✗  Fatal:', e.message); process.exit(1) })
