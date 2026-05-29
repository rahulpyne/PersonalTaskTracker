#!/usr/bin/env node
/**
 * Obsidian Knowledge Sync
 * =======================
 * Syncs three sources into ~/Documents/ObsidianVault for Graph View idea cloud:
 *
 *   1. Tracker Notes (Supabase `notes` table)
 *   2. Claude Code chats (~/.claude/projects/**\/*.jsonl)
 *   3. ChatGPT export  (drop conversations.json in agents/obsidian/)
 *
 * Each markdown file gets [[wiki-links]] to shared topic hubs so
 * Obsidian's Graph View clusters related ideas together.
 *
 * Usage:
 *   node agents/obsidian/sync.js
 *   node agents/obsidian/sync.js --only=tracker   # just notes
 *   node agents/obsidian/sync.js --only=claude    # just Claude chats
 *   node agents/obsidian/sync.js --only=chatgpt   # just ChatGPT
 */

import { createClient }       from '@supabase/supabase-js'
import fs                     from 'fs'
import path                   from 'path'
import os                     from 'os'
import { fileURLToPath }      from 'url'

// ── Config ────────────────────────────────────────────────────────────────────
const __dirname   = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT   = path.resolve(__dirname, '../..')
const ENV_FILE    = path.join(REPO_ROOT, '.env.local')
const VAULT       = path.join(os.homedir(), 'Documents', 'ObsidianVault')
const CLAUDE_ROOT = path.join(os.homedir(), '.claude', 'projects')
const GPT_FILE    = path.join(__dirname, 'conversations.json')  // drop ChatGPT export here
const GEMINI_KEY_FILE = path.join(REPO_ROOT, 'supabase', 'functions', 'ai-subtasks', 'index.ts')

// Parse .env.local
function loadEnv() {
  const env = {}
  try {
    fs.readFileSync(ENV_FILE, 'utf8').split('\n').forEach(line => {
      const m = line.match(/^([A-Z_]+)=(.*)$/)
      if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
    })
  } catch {}
  return env
}
const env = loadEnv()
const SUPABASE_URL  = env.VITE_SUPABASE_URL  || process.env.VITE_SUPABASE_URL
const SUPABASE_KEY  = env.VITE_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY

// Parse Gemini key from edge function file (it's set as Supabase secret, not in local env)
let GEMINI_KEY = process.env.GEMINI_API_KEY
if (!GEMINI_KEY) {
  // Fall back: check if user set it locally
  GEMINI_KEY = env.GEMINI_API_KEY
}

// ── CLI flags ─────────────────────────────────────────────────────────────────
const args    = process.argv.slice(2)
const onlyArg = args.find(a => a.startsWith('--only='))?.split('=')[1]
const only    = onlyArg ? new Set(onlyArg.split(',')) : new Set(['tracker', 'claude', 'chatgpt'])

// ── Helpers ───────────────────────────────────────────────────────────────────
function slugify(str) {
  return str
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 60)
    .trim()
}

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, content, 'utf8')
}

function formatDate(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('en', { year: 'numeric', month: 'long', day: 'numeric' })
}

// ── Topic extraction (keyword frequency, no external deps) ───────────────────
const STOP_WORDS = new Set([
  'the','a','an','and','or','but','in','on','at','to','for','of','with','by',
  'from','up','about','into','through','during','is','was','are','were','be',
  'been','being','have','has','had','do','does','did','will','would','could',
  'should','may','might','must','shall','can','need','this','that','these',
  'those','i','you','he','she','it','we','they','me','him','her','us','them',
  'my','your','his','its','our','their','what','which','who','whom','how',
  'when','where','why','all','each','every','both','few','more','most','other',
  'some','such','no','not','only','same','so','than','too','very','just','also',
  'then','than','there','here','now','after','before','over','under','again',
  'further','s','t','re','ll','ve','d','m','didn','isn','aren','wasn','wouldn',
  'couldn','shouldn','don','doesn','haven','hadn',
])

function extractTopics(text, topN = 8) {
  const freq = {}
  const words = text.toLowerCase().replace(/[^\w\s]/g, ' ').split(/\s+/)
  for (const w of words) {
    if (w.length < 4) continue
    if (STOP_WORDS.has(w)) continue
    freq[w] = (freq[w] || 0) + 1
  }
  return Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([w]) => w)
}

// Topic clusters → grouped into meaningful hub names via simple pattern matching
const TOPIC_PATTERNS = [
  { hub: 'AI & Machine Learning', terms: ['model','training','inference','embedding','llm','gpt','claude','gemini','neural','prompt','agent','ai'] },
  { hub: 'Software Engineering', terms: ['code','function','class','api','database','query','schema','deploy','build','test','react','typescript','javascript','python','node','sql','supabase','vercel'] },
  { hub: 'Product & Design', terms: ['product','feature','user','ux','design','flow','interface','dashboard','sprint','roadmap','stakeholder'] },
  { hub: 'Business & Strategy', terms: ['business','strategy','market','revenue','growth','customer','sales','metric','kpi','goal','objective'] },
  { hub: 'Health & Fitness', terms: ['workout','exercise','gym','weight','strength','cardio','nutrition','sleep','recovery','protein'] },
  { hub: 'Finance & Money', terms: ['finance','money','budget','investment','tax','expense','income','savings','stock','crypto'] },
  { hub: 'Personal & Life', terms: ['personal','life','family','travel','relationship','goal','habit','routine','journal','reflection'] },
]

function assignTopicHubs(keywords, tags = []) {
  const all = [...keywords, ...tags].map(t => t.toLowerCase())
  const hubs = new Set()
  for (const { hub, terms } of TOPIC_PATTERNS) {
    if (all.some(w => terms.some(t => w.includes(t)))) {
      hubs.add(hub)
    }
  }
  return [...hubs]
}

// ── Gemini summarizer (used for Claude chat summaries) ───────────────────────
async function geminiSummarize(text) {
  if (!GEMINI_KEY) {
    // Fallback: just take first 300 chars
    return text.slice(0, 300).replace(/\n+/g, ' ').trim() + '…'
  }
  try {
    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${GEMINI_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text:
            `Summarize this conversation in 2-3 sentences. Focus on the main topic, what was built/decided, and the key outcome. Be concise.\n\n${text.slice(0, 3000)}`
          }] }],
          generationConfig: { temperature: 0.2, maxOutputTokens: 200 },
        }),
      }
    )
    const j = await resp.json()
    return j?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? text.slice(0, 300)
  } catch {
    return text.slice(0, 300)
  }
}

// ── 1. Sync Tracker Notes ─────────────────────────────────────────────────────
async function syncTrackerNotes() {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.warn('⚠ Skipping Tracker Notes — VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY missing')
    return []
  }
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)
  const { data: notes, error } = await supabase
    .from('notes')
    .select('*')
    .order('updated_at', { ascending: false })
  if (error) { console.error('Notes fetch error:', error.message); return [] }

  const dir = path.join(VAULT, 'Tracker Notes')
  const written = []

  for (const note of notes ?? []) {
    const title    = note.title || 'Untitled'
    const keywords = extractTopics((note.title || '') + ' ' + (note.body || ''))
    const hubs     = assignTopicHubs(keywords, note.tags ?? [])
    const hubLinks = hubs.map(h => `[[Topics/${h}]]`).join('  ')
    const tagStr   = (note.tags ?? []).map(t => `#${t}`).join(' ')

    const md = `---
title: "${title.replace(/"/g, '\\"')}"
tags: [${(note.tags ?? []).map(t => `"${t}"`).join(', ')}]
updated: "${note.updated_at}"
source: tracker
---

# ${title}

${note.body || ''}

---
*Topics:* ${hubLinks || '—'}
*Tags:* ${tagStr || '—'}
*Updated:* ${formatDate(note.updated_at)}
`
    const fileName = `${slugify(title) || note.id}.md`
    writeFile(path.join(dir, fileName), md)
    written.push({ title, hubs, keywords })
  }

  console.log(`✓ Tracker Notes: ${written.length} notes synced`)
  return written
}

// ── 2. Sync Claude Chats ──────────────────────────────────────────────────────
async function syncClaudeChats() {
  if (!fs.existsSync(CLAUDE_ROOT)) {
    console.warn('⚠ Skipping Claude Chats — ~/.claude/projects not found')
    return []
  }

  const projects = fs.readdirSync(CLAUDE_ROOT).filter(p => {
    return fs.statSync(path.join(CLAUDE_ROOT, p)).isDirectory()
  })

  const written = []

  for (const proj of projects) {
    const projPath    = path.join(CLAUDE_ROOT, proj)
    const projName    = proj.replace(/^-Users-\w+-?/, '').replace(/-/g, ' ').trim() || 'home'
    const projDir     = path.join(VAULT, 'Claude Chats', slugify(projName) || 'home')
    const jsonlFiles  = fs.readdirSync(projPath).filter(f => f.endsWith('.jsonl'))

    for (const file of jsonlFiles) {
      const sessionId = file.replace('.jsonl', '')
      const fp        = path.join(projPath, file)

      let lines
      try {
        lines = fs.readFileSync(fp, 'utf8').split('\n').filter(Boolean)
      } catch { continue }

      // Extract user messages (enqueue operations)
      const userMessages = []
      let firstTimestamp = null
      let lastTimestamp  = null

      for (const line of lines) {
        try {
          const d = JSON.parse(line)
          if (!firstTimestamp && d.timestamp) firstTimestamp = d.timestamp
          if (d.timestamp) lastTimestamp = d.timestamp

          if (d.type === 'queue-operation' && d.operation === 'enqueue' && typeof d.content === 'string') {
            userMessages.push(d.content)
          }
        } catch {}
      }

      if (userMessages.length === 0) continue

      const firstMsg  = userMessages[0]
      const title     = firstMsg.slice(0, 70).replace(/\n/g, ' ').trim()
      const fullConvo = userMessages.join('\n\n')
      const dateStr   = firstTimestamp ? new Date(firstTimestamp).toISOString().slice(0, 10) : 'unknown'

      // Summarize (rate-limit: only summarize if needed)
      const summary = await geminiSummarize(fullConvo)

      const keywords = extractTopics(fullConvo)
      const hubs     = assignTopicHubs(keywords)
      const hubLinks = hubs.map(h => `[[Topics/${h}]]`).join('  ')

      const md = `---
title: "${title.replace(/"/g, '\\"')}"
project: "${projName}"
date: "${dateStr}"
session: "${sessionId}"
source: claude
---

# ${title}

**Project:** ${projName}
**Date:** ${formatDate(firstTimestamp)}
**Session:** \`${sessionId}\`

## Summary

${summary}

## User Messages (${userMessages.length} turns)

${userMessages.slice(0, 5).map((m, i) => `**[${i + 1}]** ${m.slice(0, 200).replace(/\n/g, ' ')}…`).join('\n\n')}

---
*Topics:* ${hubLinks || '—'}
`
      const fileName = `${dateStr}-${slugify(title) || sessionId.slice(0, 8)}.md`
      writeFile(path.join(projDir, fileName), md)
      written.push({ title, project: projName, hubs, keywords })
    }
  }

  console.log(`✓ Claude Chats: ${written.length} sessions synced`)
  return written
}

// ── 3. Sync ChatGPT Export ────────────────────────────────────────────────────
async function syncChatGPT() {
  if (!fs.existsSync(GPT_FILE)) {
    console.log(`ℹ ChatGPT: drop your conversations.json export at agents/obsidian/conversations.json`)
    return []
  }

  let convos
  try {
    convos = JSON.parse(fs.readFileSync(GPT_FILE, 'utf8'))
    if (!Array.isArray(convos)) convos = convos.conversations ?? Object.values(convos)
  } catch (e) {
    console.error('ChatGPT parse error:', e.message)
    return []
  }

  const dir     = path.join(VAULT, 'ChatGPT')
  const written = []

  for (const convo of convos) {
    const title     = (convo.title || 'Untitled').slice(0, 70)
    const dateStr   = convo.create_time
      ? new Date(convo.create_time * 1000).toISOString().slice(0, 10)
      : 'unknown'

    // Extract text from messages mapping
    const messages  = convo.mapping ? Object.values(convo.mapping) : []
    const userMsgs  = messages
      .filter(m => m?.message?.author?.role === 'user')
      .map(m => {
        const content = m.message.content
        if (typeof content === 'string') return content
        if (Array.isArray(content?.parts)) return content.parts.filter(p => typeof p === 'string').join(' ')
        return ''
      })
      .filter(Boolean)

    const fullText  = userMsgs.join('\n\n')
    if (!fullText) continue

    const summary   = await geminiSummarize(fullText)
    const keywords  = extractTopics(fullText)
    const hubs      = assignTopicHubs(keywords)
    const hubLinks  = hubs.map(h => `[[Topics/${h}]]`).join('  ')

    const md = `---
title: "${title.replace(/"/g, '\\"')}"
date: "${dateStr}"
source: chatgpt
---

# ${title}

**Date:** ${dateStr}

## Summary

${summary}

---
*Topics:* ${hubLinks || '—'}
`
    const fileName = `${dateStr}-${slugify(title) || 'chat'}.md`
    writeFile(path.join(dir, fileName), md)
    written.push({ title, hubs, keywords })
  }

  console.log(`✓ ChatGPT: ${written.length} conversations synced`)
  return written
}

// ── 4. Generate Topic Hub Notes ───────────────────────────────────────────────
async function buildTopicHubs(allItems) {
  const topicMap = {}  // hub → items[]

  for (const item of allItems) {
    for (const hub of item.hubs ?? []) {
      if (!topicMap[hub]) topicMap[hub] = []
      topicMap[hub].push(item)
    }
  }

  const dir = path.join(VAULT, 'Topics')

  for (const [hub, items] of Object.entries(topicMap)) {
    const fileName = `${slugify(hub)}.md`
    const links    = items
      .slice(0, 30)
      .map(item => {
        const folder = item.source === 'tracker'
          ? 'Tracker Notes'
          : item.source === 'claude'
            ? `Claude Chats/${slugify(item.project || 'home')}`
            : 'ChatGPT'
        return `- [[${folder}/${slugify(item.title || 'untitled')}|${item.title}]]`
      })
      .join('\n')

    const md = `---
type: topic-hub
topic: "${hub}"
count: ${items.length}
---

# ${hub}

*${items.length} note${items.length !== 1 ? 's' : ''} related to this topic*

## Notes

${links}

---
*This hub is auto-generated by the sync agent to cluster related ideas in the Graph View.*
`
    writeFile(path.join(dir, fileName), md)
  }

  console.log(`✓ Topics: ${Object.keys(topicMap).length} hub notes created`)
}

// ── 5. Update Home index ──────────────────────────────────────────────────────
function updateHome(stats) {
  const now = new Date().toLocaleString('en')
  const md  = `# 🧠 Personal Knowledge Base

*Last synced: ${now}*

## Stats
- 📝 Tracker Notes: **${stats.tracker}**
- 🤖 Claude Chats: **${stats.claude}**
- 💬 ChatGPT Conversations: **${stats.chatgpt}**

## Sections
- [[Tracker Notes/]] — Notes from the personal app
- [[Claude Chats/]] — Claude Code conversation summaries
- [[ChatGPT/]] — ChatGPT conversations
- [[Topics/]] — Topic hub notes (for Graph View clusters)

---
*Run \`node agents/obsidian/sync.js\` from the tracker repo to refresh.*
`
  writeFile(path.join(VAULT, '_Home.md'), md)
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n🔄 Obsidian Knowledge Sync\n')
  console.log(`Vault: ${VAULT}`)
  console.log(`Gemini: ${GEMINI_KEY ? 'enabled (AI summaries)' : 'disabled (plain text)'}`)
  console.log(`Sources: ${[...only].join(', ')}\n`)

  const allItems = []
  const stats    = { tracker: 0, claude: 0, chatgpt: 0 }

  if (only.has('tracker')) {
    const items = await syncTrackerNotes()
    items.forEach(i => { i.source = 'tracker' })
    allItems.push(...items)
    stats.tracker = items.length
  }

  if (only.has('claude')) {
    const items = await syncClaudeChats()
    items.forEach(i => { i.source = 'claude' })
    allItems.push(...items)
    stats.claude = items.length
  }

  if (only.has('chatgpt')) {
    const items = await syncChatGPT()
    items.forEach(i => { i.source = 'chatgpt' })
    allItems.push(...items)
    stats.chatgpt = items.length
  }

  await buildTopicHubs(allItems)
  updateHome(stats)

  console.log(`\n✅ Done! Open ~/Documents/ObsidianVault in Obsidian`)
  console.log(`   → Enable Graph View (⌘G) to see the idea cloud\n`)
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1) })
