#!/usr/bin/env node
/**
 * Claude Chats → Supabase Notes Import
 * =====================================
 * Reads every JSONL session from ~/.claude/projects/, summarises it with
 * Gemini, and upserts the result into the Supabase `notes` table so it
 * shows up in the app's Graph view alongside your regular notes.
 *
 * Deduplication: each note stores the session UUID as `source_ref` with a
 * unique DB index, so re-running this is always safe — already-imported
 * sessions are skipped.
 *
 * Usage:
 *   node agents/claude-import/run.js              # import everything new
 *   node agents/claude-import/run.js --dry-run    # preview without writing
 *   node agents/claude-import/run.js --reimport   # re-import already-seen sessions
 */

import { createClient } from '@supabase/supabase-js'
import fs               from 'fs'
import path             from 'path'
import os               from 'os'
import { fileURLToPath } from 'url'

const __dirname   = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT   = path.resolve(__dirname, '../..')
const CLAUDE_ROOT = path.join(os.homedir(), '.claude', 'projects')

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

const env         = loadEnv()
const SUPABASE_URL  = env.VITE_SUPABASE_URL      || process.env.VITE_SUPABASE_URL
const SUPABASE_KEY  = env.VITE_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY
const AI_NOTES_URL  = SUPABASE_URL ? `${SUPABASE_URL}/functions/v1/ai-notes` : null

const DRY_RUN   = process.argv.includes('--dry-run')
const REIMPORT  = process.argv.includes('--reimport')

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('✗  Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY in .env.local')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

// ── AI structuring via the deployed ai-notes edge function ────────────────────
// The edge function already has the Gemini key as a Supabase secret, so we
// don't need it locally.
async function structureSession(userMessages, projName) {
  const text = userMessages
    .map((m, i) => `[Turn ${i + 1}] ${m}`)
    .join('\n\n')

  // Prepend project context
  const contextText = `Project: ${projName}\n\n${text}`

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
        // Always ensure claude-chat tag is present
        result.tags = [...new Set(['claude-chat', ...(result.tags || [])])]
        return result
      }
    }
  } catch {}

  // Fallback if edge function is unavailable
  const first = userMessages[0] || ''
  return {
    title: first.slice(0, 55).replace(/\n/g, ' ').trim() || 'Claude Chat',
    body:  `## Conversation\n\n${text.slice(0, 2000)}`,
    tags:  ['claude-chat'],
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n🤖  Claude Chats → Supabase\n')
  console.log(`AI Notes  : ${AI_NOTES_URL ? '✓ edge function' : '✗ unavailable'}`)
  console.log(`Mode      : ${DRY_RUN ? 'DRY RUN (no writes)' : 'LIVE'}`)
  console.log(`Reimport  : ${REIMPORT ? 'yes (re-process existing)' : 'no (skip already imported)'}\n`)

  if (!fs.existsSync(CLAUDE_ROOT)) {
    console.error(`✗  ${CLAUDE_ROOT} not found`)
    process.exit(1)
  }

  // Fetch already-imported refs (unless --reimport)
  let alreadyImported = new Set()
  if (!REIMPORT) {
    const { data } = await supabase
      .from('notes')
      .select('source_ref')
      .eq('source', 'claude')
      .not('source_ref', 'is', null)
    alreadyImported = new Set((data || []).map(n => n.source_ref))
    console.log(`Already in DB : ${alreadyImported.size} sessions\n`)
  }

  const projects = fs.readdirSync(CLAUDE_ROOT)
    .filter(p => fs.statSync(path.join(CLAUDE_ROOT, p)).isDirectory())

  let newCount     = 0
  let skipCount    = 0
  let failCount    = 0

  for (const proj of projects) {
    const projPath  = path.join(CLAUDE_ROOT, proj)
    const projLabel = proj.replace(/^-Users-[^-]+-?/, '').replace(/-+/g, ' ').trim() || 'home'
    const files     = fs.readdirSync(projPath).filter(f => f.endsWith('.jsonl'))

    if (files.length === 0) continue
    console.log(`📁  ${projLabel}  (${files.length} session${files.length !== 1 ? 's' : ''})`)

    for (const file of files) {
      const sessionId = file.replace('.jsonl', '')

      if (alreadyImported.has(sessionId)) {
        skipCount++
        process.stdout.write(`     ${sessionId.slice(0, 8)}  skip (already imported)\n`)
        continue
      }

      // Parse user messages from JSONL
      let lines
      try {
        lines = fs.readFileSync(path.join(projPath, file), 'utf8').split('\n').filter(Boolean)
      } catch {
        process.stdout.write(`     ${sessionId.slice(0, 8)}  ✗ unreadable\n`)
        failCount++
        continue
      }

      const userMessages = []
      let firstTs = null

      for (const line of lines) {
        try {
          const d = JSON.parse(line)
          if (!firstTs && d.timestamp) firstTs = d.timestamp
          if (
            d.type === 'queue-operation' &&
            d.operation === 'enqueue' &&
            typeof d.content === 'string' &&
            d.content.trim()
          ) {
            userMessages.push(d.content.trim().slice(0, 600))
          }
        } catch {}
      }

      if (userMessages.length === 0) {
        skipCount++
        process.stdout.write(`     ${sessionId.slice(0, 8)}  skip (no user messages)\n`)
        continue
      }

      process.stdout.write(`     ${sessionId.slice(0, 8)}  structuring…  `)

      const result = await structureSession(userMessages, projLabel)
      const tags   = [...new Set(['claude-chat', ...result.tags])]
      const ts     = firstTs || new Date().toISOString()
      const header = `*Source: Claude Code · Project: ${projLabel}*\n\n`
      const body   = header + result.body

      if (DRY_RUN) {
        process.stdout.write(`[dry] "${result.title}"  [${tags.join(', ')}]\n`)
        newCount++
        continue
      }

      const { error } = await supabase.from('notes').insert({
        title:      result.title,
        body,
        tags,
        source:     'claude',
        source_ref: sessionId,
        created_at: ts,
        updated_at: ts,
      })

      if (error) {
        // unique constraint hit = already exists from a previous reimport
        if (error.code === '23505') {
          process.stdout.write(`skip (already exists)\n`)
          skipCount++
        } else {
          process.stdout.write(`✗  ${error.message}\n`)
          failCount++
        }
      } else {
        process.stdout.write(`✓  "${result.title}"\n`)
        newCount++
      }

      // Avoid hammering Gemini
      await new Promise(r => setTimeout(r, 350))
    }
    console.log('')
  }

  console.log('─'.repeat(52))
  console.log(`✅  Done!   New: ${newCount}  |  Skipped: ${skipCount}  |  Failed: ${failCount}`)
  if (!DRY_RUN && newCount > 0) {
    console.log('\n   Refresh the app and open Graph to see your Claude sessions.\n')
  }
}

main().catch(e => { console.error('\n✗  Fatal:', e.message); process.exit(1) })
