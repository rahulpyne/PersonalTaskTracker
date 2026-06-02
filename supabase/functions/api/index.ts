/**
 * Personal Task Tracker — Public REST API
 * Supabase Edge Function: /functions/v1/api
 *
 * Used by:
 *  - ChatGPT custom GPT (via OpenAPI spec)
 *  - Any third-party app integration
 *
 * Auth: Bearer token in Authorization header (set MCP_SECRET as a Supabase secret)
 *       If MCP_SECRET is empty, the API is open (fine for personal use).
 *
 * Routes:
 *   GET    /api                  → health check + tool list
 *   GET    /api/openapi.json     → OpenAPI spec for ChatGPT
 *   GET    /api/tasks            → list tasks (?category=&status=)
 *   POST   /api/tasks            → create task
 *   PATCH  /api/tasks/:id        → update task
 *   DELETE /api/tasks/:id        → delete task
 *   POST   /api/tasks/:id/complete → toggle done
 *   GET    /api/notes            → list notes (?search=&limit=&source=)
 *   GET    /api/notes/:id        → get note
 *   POST   /api/notes            → create note
 *   PATCH  /api/notes/:id        → update note
 *   DELETE /api/notes/:id        → delete note
 */

const SUPABASE_URL  = Deno.env.get('SUPABASE_URL')!
const ANON_KEY      = Deno.env.get('SUPABASE_ANON_KEY')!
const MCP_SECRET    = Deno.env.get('MCP_SECRET') ?? ''

// Call PostgREST directly — same approach as the browser app, avoids JS client issues
const REST = `${SUPABASE_URL}/rest/v1`
const AUTH = { 'Authorization': `Bearer ${ANON_KEY}`, 'apikey': ANON_KEY,
               'Content-Type': 'application/json', 'Prefer': 'return=representation' }

async function pgRest(path: string, method = 'GET', body?: unknown) {
  const resp = await fetch(`${REST}${path}`, {
    method,
    headers: AUTH,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const data = await resp.json()
  if (!resp.ok) throw new Error(data?.message ?? data?.error ?? `HTTP ${resp.status}`)
  return data
}

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  })
}

function err(msg: string, status = 400) {
  return json({ error: msg }, status)
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })

  // ── Auth ────────────────────────────────────────────────────────────────────
  if (MCP_SECRET) {
    const auth = req.headers.get('authorization') ?? ''
    if (auth !== `Bearer ${MCP_SECRET}`) return err('Unauthorized', 401)
  }

  const url     = new URL(req.url)
  // Strip any Supabase function prefix to get a clean path like /tasks or /notes/uuid
  const rawPath = url.pathname
    .replace(/^\/functions\/v1\/api/, '')
    .replace(/^\/api/, '')
    || '/'
  const parts   = rawPath.split('/').filter(Boolean)  // e.g. ['tasks'] or ['notes','uuid']
  const method  = req.method

  const PRIO_TO_UI: Record<string,string> = { med: 'medium', high: 'high', low: 'low' }
  const PRIO_TO_DB: Record<string,string> = { medium: 'med', high: 'high', low: 'low' }
  function taskToUI(t: Record<string,unknown>) {
    return { id: t.id, title: t.text, category: t.type,
             priority: PRIO_TO_UI[t.prio as string] ?? t.prio,
             done: t.done, done_at: t.done_at, created_at: t.created_at, notes: t.context }
  }

  // ── Health / root ───────────────────────────────────────────────────────────
  if (parts.length === 0 || rawPath === '/' || rawPath === '') {
    return json({
      name:    'personal-task-tracker',
      version: '1.0.0',
      status:  'ok',
      tools:   ['list_tasks','create_task','complete_task','update_task','delete_task',
                 'list_notes','get_note','create_note','update_note','delete_note'],
    })
  }

  // ── OpenAPI spec ────────────────────────────────────────────────────────────
  if (rawPath === '/openapi.json' && method === 'GET') {
    const base = `https://${url.host}/functions/v1/api`
    return json(buildSpec(base, !!MCP_SECRET))
  }

  try {

  // ── Tasks ───────────────────────────────────────────────────────────────────
  if (parts[0] === 'tasks') {
    const id = parts[1]

    // POST /tasks/:id/complete
    if (id && parts[2] === 'complete' && method === 'POST') {
      const body = await req.json().catch(() => ({}))
      const done = body.done !== false
      const rows = await pgRest(`/tasks?id=eq.${id}`, 'PATCH',
        { done, done_at: done ? new Date().toISOString() : null })
      return json({ message: `Task marked ${done ? 'done' : 'todo'}`, task: taskToUI(rows[0]) })
    }

    // GET /tasks
    if (!id && method === 'GET') {
      const category = url.searchParams.get('category') ?? 'all'
      const status   = url.searchParams.get('status')   ?? 'all'
      const filters  = ['parent_id=is.null']
      if (category !== 'all') filters.push(`type=eq.${category}`)
      if (status === 'todo')  filters.push('done=eq.false')
      if (status === 'done')  filters.push('done=eq.true')
      const qs = `select=id,text,type,prio,done,done_at,created_at,context&${filters.join('&')}&order=created_at.desc`
      const data = await pgRest(`/tasks?${qs}`)
      return json({ count: data.length, tasks: data.map(taskToUI) })
    }

    // POST /tasks
    if (!id && method === 'POST') {
      const body = await req.json().catch(() => ({}))
      if (!body.title) return err('title is required')
      const rows = await pgRest('/tasks', 'POST', {
        text:    body.title,
        type:    body.category ?? 'work',
        prio:    PRIO_TO_DB[body.priority ?? 'medium'] ?? 'med',
        context: body.notes ?? '',
        done:    false,
      })
      return json({ message: 'Task created', task: taskToUI(rows[0]) })
    }

    // PATCH /tasks/:id
    if (id && method === 'PATCH') {
      const body = await req.json().catch(() => ({}))
      const fields: Record<string,unknown> = {}
      if (body.title    !== undefined) fields.text    = body.title
      if (body.category !== undefined) fields.type    = body.category
      if (body.priority !== undefined) fields.prio    = PRIO_TO_DB[body.priority] ?? body.priority
      if (body.notes    !== undefined) fields.context = body.notes
      const rows = await pgRest(`/tasks?id=eq.${id}`, 'PATCH', fields)
      return json({ message: 'Task updated', task: taskToUI(rows[0]) })
    }

    // DELETE /tasks/:id
    if (id && method === 'DELETE') {
      await pgRest(`/tasks?id=eq.${id}`, 'DELETE')
      return json({ message: 'Task deleted', id })
    }
  }

  // ── Notes ───────────────────────────────────────────────────────────────────
  if (parts[0] === 'notes') {
    const id = parts[1]

    // GET /notes
    if (!id && method === 'GET') {
      const search = url.searchParams.get('search')
      const limit  = Math.min(parseInt(url.searchParams.get('limit') ?? '20'), 100)
      const source = url.searchParams.get('source') ?? 'all'
      const filters: string[] = []
      if (source !== 'all') filters.push(`source=eq.${source}`)
      if (search) filters.push(`or=(title.ilike.*${encodeURIComponent(search)}*,body.ilike.*${encodeURIComponent(search)}*)`)
      const qs = `select=id,title,tags,pinned,source,updated_at,body&order=pinned.desc,updated_at.desc&limit=${limit}${filters.length ? '&' + filters.join('&') : ''}`
      const data = await pgRest(`/notes?${qs}`)
      const notes = (data ?? []).map((n: {body:string}) => ({
        ...n, body: n.body.length > 200 ? n.body.slice(0, 200) + '…' : n.body,
      }))
      return json({ count: notes.length, notes })
    }

    // GET /notes/:id
    if (id && method === 'GET') {
      const data = await pgRest(`/notes?id=eq.${id}&select=*`)
      if (!data.length) return err('Note not found', 404)
      return json(data[0])
    }

    // POST /notes
    if (!id && method === 'POST') {
      const body = await req.json().catch(() => ({}))
      const rows = await pgRest('/notes', 'POST', {
        title: body.title ?? '', body: body.body ?? '', tags: body.tags ?? [], source: 'user',
      })
      return json({ message: 'Note created', note: rows[0] })
    }

    // PATCH /notes/:id
    if (id && method === 'PATCH') {
      const body = await req.json().catch(() => ({}))
      const fields: Record<string,unknown> = { updated_at: new Date().toISOString() }
      if (body.title !== undefined) fields.title = body.title
      if (body.body  !== undefined) fields.body  = body.body
      if (body.tags  !== undefined) fields.tags  = body.tags
      const rows = await pgRest(`/notes?id=eq.${id}`, 'PATCH', fields)
      return json({ message: 'Note updated', note: rows[0] })
    }

    // DELETE /notes/:id
    if (id && method === 'DELETE') {
      await pgRest(`/notes?id=eq.${id}`, 'DELETE')
      return json({ message: 'Note deleted', id })
    }
  }

  } catch (e: unknown) {
    return err((e as Error).message ?? 'Internal error', 500)
  }

  return err('Not found', 404)
})

// ── OpenAPI spec ──────────────────────────────────────────────────────────────
function buildSpec(base: string, secured: boolean) {
  const security = secured ? [{ bearerAuth: [] }] : []
  return {
    openapi: '3.1.0',
    info: {
      title:   'Personal Task Tracker API',
      version: '1.0.0',
      description: 'Manage tasks and notes in the Personal Task Tracker app.',
    },
    servers: [{ url: base }],
    ...(secured ? {
      components: { securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' } } }
    } : {}),
    paths: {
      '/tasks': {
        get: {
          operationId: 'listTasks', summary: 'List tasks', security,
          parameters: [
            { name: 'category', in: 'query', schema: { type: 'string', enum: ['all','work','personal'], default: 'all' } },
            { name: 'status',   in: 'query', schema: { type: 'string', enum: ['all','todo','done'],     default: 'all' } },
          ],
          responses: { '200': { description: 'Tasks list' } },
        },
        post: {
          operationId: 'createTask', summary: 'Create a task', security,
          requestBody: { required: true, content: { 'application/json': { schema: {
            type: 'object', required: ['title'],
            properties: {
              title:    { type: 'string' },
              category: { type: 'string', enum: ['work','personal'], default: 'work' },
              priority: { type: 'string', enum: ['low','medium','high'], default: 'medium' },
              notes:    { type: 'string' },
            },
          }}}},
          responses: { '200': { description: 'Created task' } },
        },
      },
      '/tasks/{id}': {
        patch: {
          operationId: 'updateTask', summary: 'Update a task', security,
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: { content: { 'application/json': { schema: {
            type: 'object',
            properties: {
              title:    { type: 'string' },
              category: { type: 'string', enum: ['work','personal'] },
              priority: { type: 'string', enum: ['low','medium','high'] },
              notes:    { type: 'string' },
            },
          }}}},
          responses: { '200': { description: 'Updated task' } },
        },
        delete: {
          operationId: 'deleteTask', summary: 'Delete a task', security,
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'Deleted' } },
        },
      },
      '/tasks/{id}/complete': {
        post: {
          operationId: 'completeTask', summary: 'Mark task done or undone', security,
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: { content: { 'application/json': { schema: {
            type: 'object', properties: { done: { type: 'boolean', default: true } },
          }}}},
          responses: { '200': { description: 'Updated' } },
        },
      },
      '/notes': {
        get: {
          operationId: 'listNotes', summary: 'List notes', security,
          parameters: [
            { name: 'search', in: 'query', schema: { type: 'string' } },
            { name: 'limit',  in: 'query', schema: { type: 'integer', default: 20, maximum: 100 } },
            { name: 'source', in: 'query', schema: { type: 'string', enum: ['all','user','claude','gemini'], default: 'all' } },
          ],
          responses: { '200': { description: 'Notes list' } },
        },
        post: {
          operationId: 'createNote', summary: 'Create a note', security,
          requestBody: { content: { 'application/json': { schema: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              body:  { type: 'string', description: 'Markdown body' },
              tags:  { type: 'array', items: { type: 'string' } },
            },
          }}}},
          responses: { '200': { description: 'Created note' } },
        },
      },
      '/notes/{id}': {
        get: {
          operationId: 'getNote', summary: 'Get a single note', security,
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'Note' } },
        },
        patch: {
          operationId: 'updateNote', summary: 'Update a note', security,
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: { content: { 'application/json': { schema: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              body:  { type: 'string' },
              tags:  { type: 'array', items: { type: 'string' } },
            },
          }}}},
          responses: { '200': { description: 'Updated note' } },
        },
        delete: {
          operationId: 'deleteNote', summary: 'Delete a note', security,
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'Deleted' } },
        },
      },
    },
  }
}
