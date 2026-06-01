#!/usr/bin/env node
/**
 * Personal Task Tracker — MCP Server
 *
 * Exposes your tasks and notes to Claude Desktop, Claude Code,
 * and any MCP-compatible client.
 *
 * Usage:
 *   node mcp-server/index.js          # stdio (Claude Desktop / Claude Code)
 *   node mcp-server/index.js --http   # HTTP on port 3333 (remote / ChatGPT)
 */

import { McpServer }          from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createClient }        from '@supabase/supabase-js'
import { z }                   from 'zod'
import dotenv                  from 'dotenv'
import { fileURLToPath }       from 'url'
import { dirname, join }       from 'path'
import http                    from 'http'

// ── Env ────────────────────────────────────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: join(__dirname, '../.env.local') })

const SUPABASE_URL = process.env.VITE_SUPABASE_URL
const SUPABASE_KEY = process.env.VITE_SUPABASE_ANON_KEY
const MCP_PORT     = process.env.MCP_PORT || 3333
const MCP_SECRET   = process.env.MCP_SECRET || ''   // optional bearer token for HTTP mode

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in .env.local')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

// ── Helpers ────────────────────────────────────────────────────────────────────
function ok(data)  { return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] } }
function err(msg)  { return { content: [{ type: 'text', text: `Error: ${msg}` }], isError: true } }

// ── MCP Server ─────────────────────────────────────────────────────────────────
const server = new McpServer({
  name:    'personal-task-tracker',
  version: '1.0.0',
})

// ── TASK TOOLS ─────────────────────────────────────────────────────────────────

// DB columns: text=title, type=category, prio=priority (high/med/low), context=notes
const PRIO_TO_DB = { high: 'high', medium: 'med', low: 'low' }
const PRIO_TO_UI = { high: 'high', med: 'medium', low: 'low' }
function taskToUI(t) {
  return { id: t.id, title: t.text, category: t.type,
           priority: PRIO_TO_UI[t.prio] ?? t.prio,
           done: t.done, done_at: t.done_at, created_at: t.created_at, notes: t.context }
}

server.tool(
  'list_tasks',
  'List tasks. Filter by category (work | personal | all) and status (todo | done | all).',
  {
    category: z.enum(['all', 'work', 'personal']).optional().default('all'),
    status:   z.enum(['all', 'todo', 'done']).optional().default('all'),
  },
  async ({ category, status }) => {
    let q = supabase
      .from('tasks')
      .select('id, text, type, prio, done, done_at, created_at, context')
      .is('parent_id', null)
      .order('created_at', { ascending: false })

    if (category !== 'all') q = q.eq('type', category)
    if (status   === 'todo') q = q.eq('done', false)
    if (status   === 'done') q = q.eq('done', true)

    const { data, error } = await q
    if (error) return err(error.message)
    return ok({ count: data.length, tasks: (data ?? []).map(taskToUI) })
  }
)

server.tool(
  'create_task',
  'Create a new task. Returns the created task.',
  {
    title:    z.string().min(1).describe('Task title'),
    category: z.enum(['work', 'personal']).optional().default('work'),
    priority: z.enum(['low', 'medium', 'high']).optional().default('medium'),
    notes:    z.string().optional().describe('Optional context or notes for the task'),
  },
  async ({ title, category, priority, notes }) => {
    const { data, error } = await supabase
      .from('tasks')
      .insert([{ text: title, type: category, prio: PRIO_TO_DB[priority] ?? 'med', context: notes ?? '', done: false }])
      .select('id, text, type, prio, done, created_at, context')
      .single()

    if (error) return err(error.message)
    return ok({ message: 'Task created', task: taskToUI(data) })
  }
)

server.tool(
  'complete_task',
  'Mark a task as done or not done.',
  {
    id:   z.string().uuid().describe('Task UUID'),
    done: z.boolean().optional().default(true),
  },
  async ({ id, done }) => {
    const { data, error } = await supabase
      .from('tasks')
      .update({ done, done_at: done ? new Date().toISOString() : null })
      .eq('id', id)
      .select('id, text, done')
      .single()

    if (error) return err(error.message)
    return ok({ message: `Task marked ${done ? 'done' : 'todo'}`, task: { id: data.id, title: data.text, done: data.done } })
  }
)

server.tool(
  'update_task',
  'Update a task title, category, priority, or notes.',
  {
    id:       z.string().uuid(),
    title:    z.string().optional(),
    category: z.enum(['work', 'personal']).optional(),
    priority: z.enum(['low', 'medium', 'high']).optional(),
    notes:    z.string().optional(),
  },
  async ({ id, title, category, priority, notes }) => {
    const fields = {}
    if (title    !== undefined) fields.text    = title
    if (category !== undefined) fields.type    = category
    if (priority !== undefined) fields.prio    = PRIO_TO_DB[priority] ?? priority
    if (notes    !== undefined) fields.context = notes

    const { data, error } = await supabase
      .from('tasks')
      .update(fields)
      .eq('id', id)
      .select('id, text, type, prio, done, context')
      .single()

    if (error) return err(error.message)
    return ok({ message: 'Task updated', task: taskToUI(data) })
  }
)

server.tool(
  'delete_task',
  'Permanently delete a task by ID.',
  { id: z.string().uuid() },
  async ({ id }) => {
    const { error } = await supabase.from('tasks').delete().eq('id', id)
    if (error) return err(error.message)
    return ok({ message: 'Task deleted', id })
  }
)

// ── NOTE TOOLS ─────────────────────────────────────────────────────────────────

server.tool(
  'list_notes',
  'List notes. Pass a search query to filter by title, body, or tags.',
  {
    search: z.string().optional().describe('Optional text search across title and body'),
    limit:  z.number().int().min(1).max(100).optional().default(20),
    source: z.enum(['all', 'user', 'claude', 'gemini']).optional().default('all'),
  },
  async ({ search, limit, source }) => {
    let q = supabase
      .from('notes')
      .select('id, title, tags, pinned, source, updated_at, body')
      .order('pinned', { ascending: false })
      .order('updated_at', { ascending: false })
      .limit(limit)

    if (source !== 'all') q = q.eq('source', source)
    if (search) q = q.or(`title.ilike.%${search}%,body.ilike.%${search}%`)

    const { data, error } = await q
    if (error) return err(error.message)

    // Truncate bodies for listing (full body available via get_note)
    const notes = data.map(n => ({
      ...n,
      body: n.body.length > 200 ? n.body.slice(0, 200) + '…' : n.body,
    }))
    return ok({ count: notes.length, notes })
  }
)

server.tool(
  'get_note',
  'Get the full content of a single note by ID.',
  { id: z.string().uuid() },
  async ({ id }) => {
    const { data, error } = await supabase
      .from('notes')
      .select('*')
      .eq('id', id)
      .single()

    if (error) return err(error.message)
    return ok(data)
  }
)

server.tool(
  'create_note',
  'Create a new note. Returns the created note.',
  {
    title: z.string().optional().default(''),
    body:  z.string().optional().default('').describe('Markdown body'),
    tags:  z.array(z.string()).optional().default([]),
  },
  async ({ title, body, tags }) => {
    const { data, error } = await supabase
      .from('notes')
      .insert([{ title, body, tags, source: 'user' }])
      .select()
      .single()

    if (error) return err(error.message)
    return ok({ message: 'Note created', note: data })
  }
)

server.tool(
  'update_note',
  'Update a note title, body, or tags.',
  {
    id:    z.string().uuid(),
    title: z.string().optional(),
    body:  z.string().optional(),
    tags:  z.array(z.string()).optional(),
  },
  async ({ id, title, body, tags }) => {
    const fields = { updated_at: new Date().toISOString() }
    if (title !== undefined) fields.title = title
    if (body  !== undefined) fields.body  = body
    if (tags  !== undefined) fields.tags  = tags

    const { data, error } = await supabase
      .from('notes')
      .update(fields)
      .eq('id', id)
      .select()
      .single()

    if (error) return err(error.message)
    return ok({ message: 'Note updated', note: data })
  }
)

server.tool(
  'delete_note',
  'Permanently delete a note by ID.',
  { id: z.string().uuid() },
  async ({ id }) => {
    const { error } = await supabase.from('notes').delete().eq('id', id)
    if (error) return err(error.message)
    return ok({ message: 'Note deleted', id })
  }
)

// ── Transport ──────────────────────────────────────────────────────────────────
const useHttp = process.argv.includes('--http')

if (useHttp) {
  // Simple JSON-RPC over HTTP (compatible with OpenAI plugins + custom clients)
  const httpServer = http.createServer(async (req, res) => {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }

    // Auth
    if (MCP_SECRET) {
      const auth = req.headers['authorization'] ?? ''
      if (auth !== `Bearer ${MCP_SECRET}`) {
        res.writeHead(401, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Unauthorized' }))
        return
      }
    }

    // Health check
    if (req.method === 'GET' && req.url === '/') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ name: 'personal-task-tracker', version: '1.0.0', status: 'ok' }))
      return
    }

    // OpenAPI spec
    if (req.method === 'GET' && req.url === '/openapi.json') {
      const spec = buildOpenAPISpec(req)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(spec, null, 2))
      return
    }

    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Use POST /mcp for MCP calls, or see /openapi.json' }))
  })

  httpServer.listen(MCP_PORT, () => {
    console.error(`MCP HTTP server running on http://localhost:${MCP_PORT}`)
    console.error(`OpenAPI spec: http://localhost:${MCP_PORT}/openapi.json`)
  })
} else {
  // stdio — for Claude Desktop / Claude Code
  const transport = new StdioServerTransport()
  await server.connect(transport)
}

// ── OpenAPI spec builder ───────────────────────────────────────────────────────
function buildOpenAPISpec(req) {
  const host = `${req.headers['x-forwarded-proto'] ?? 'http'}://${req.headers.host}`
  return {
    openapi: '3.1.0',
    info: {
      title:       'Personal Task Tracker API',
      description: 'Read and write tasks and notes in Rahul\'s personal tracker.',
      version:     '1.0.0',
    },
    servers: [{ url: host }],
    paths: {
      '/tasks':        { get: taskListOp(), post: taskCreateOp() },
      '/tasks/{id}':   { patch: taskUpdateOp(), delete: taskDeleteOp() },
      '/tasks/{id}/complete': { post: taskCompleteOp() },
      '/notes':        { get: noteListOp(), post: noteCreateOp() },
      '/notes/{id}':   { get: noteGetOp(), patch: noteUpdateOp(), delete: noteDeleteOp() },
    },
    components: {
      securitySchemes: MCP_SECRET ? {
        bearerAuth: { type: 'http', scheme: 'bearer' }
      } : {},
    },
  }
}

function taskListOp() {
  return {
    operationId: 'listTasks',
    summary: 'List tasks',
    parameters: [
      { name: 'category', in: 'query', schema: { type: 'string', enum: ['all','work','personal'] } },
      { name: 'status',   in: 'query', schema: { type: 'string', enum: ['all','todo','done'] } },
    ],
    responses: { '200': { description: 'List of tasks' } },
  }
}
function taskCreateOp() {
  return {
    operationId: 'createTask',
    summary: 'Create a task',
    requestBody: { content: { 'application/json': { schema: {
      type: 'object', required: ['title'],
      properties: {
        title:    { type: 'string' },
        category: { type: 'string', enum: ['work','personal'] },
        priority: { type: 'string', enum: ['low','medium','high'] },
        notes:    { type: 'string' },
      }
    }}}},
    responses: { '200': { description: 'Created task' } },
  }
}
function taskUpdateOp() {
  return {
    operationId: 'updateTask', summary: 'Update a task',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
    requestBody: { content: { 'application/json': { schema: { type: 'object' } } } },
    responses: { '200': { description: 'Updated task' } },
  }
}
function taskDeleteOp() {
  return {
    operationId: 'deleteTask', summary: 'Delete a task',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
    responses: { '200': { description: 'Deleted' } },
  }
}
function taskCompleteOp() {
  return {
    operationId: 'completeTask', summary: 'Mark task done/undone',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
    requestBody: { content: { 'application/json': { schema: {
      type: 'object', properties: { done: { type: 'boolean' } }
    }}}},
    responses: { '200': { description: 'Updated' } },
  }
}
function noteListOp() {
  return {
    operationId: 'listNotes', summary: 'List notes',
    parameters: [
      { name: 'search', in: 'query', schema: { type: 'string' } },
      { name: 'limit',  in: 'query', schema: { type: 'integer', default: 20 } },
      { name: 'source', in: 'query', schema: { type: 'string', enum: ['all','user','claude','gemini'] } },
    ],
    responses: { '200': { description: 'List of notes' } },
  }
}
function noteCreateOp() {
  return {
    operationId: 'createNote', summary: 'Create a note',
    requestBody: { content: { 'application/json': { schema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        body:  { type: 'string', description: 'Markdown body' },
        tags:  { type: 'array', items: { type: 'string' } },
      }
    }}}},
    responses: { '200': { description: 'Created note' } },
  }
}
function noteGetOp() {
  return {
    operationId: 'getNote', summary: 'Get a single note',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
    responses: { '200': { description: 'Note' } },
  }
}
function noteUpdateOp() {
  return {
    operationId: 'updateNote', summary: 'Update a note',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
    requestBody: { content: { 'application/json': { schema: { type: 'object' } } } },
    responses: { '200': { description: 'Updated note' } },
  }
}
function noteDeleteOp() {
  return {
    operationId: 'deleteNote', summary: 'Delete a note',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
    responses: { '200': { description: 'Deleted' } },
  }
}
