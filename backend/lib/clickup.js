/**
 * ClickUp tools — available to agents via Claude tool use.
 * Alfred has all of these. Add selectively to other agents as needed.
 */

const BASE = 'https://api.clickup.com/api/v2'
const KEY = process.env.CLICKUP_API_KEY
const TEAM_ID = process.env.CLICKUP_TEAM_ID

const headers = () => ({
  'Authorization': KEY,
  'Content-Type': 'application/json',
})

// ─── Tool definitions (sent to Claude as tool specs) ─────────────────────────

export const CLICKUP_TOOL_DEFINITIONS = [
  {
    name: 'create_task',
    description: 'Create a new task in ClickUp. Use when Sanyuja mentions something that needs to be done, tracked, or followed up on.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Clear, specific task name in imperative form.' },
        description: { type: 'string', description: 'Context, details, or notes about the task.' },
        list_name: { type: 'string', description: 'Name of the ClickUp list to add it to. Default: infer from context, or use "ML projects".' },
        due_date: { type: 'string', description: 'Due date in YYYY-MM-DD format. Only include if explicitly mentioned.' },
        priority: { type: 'number', enum: [1, 2, 3, 4], description: '1=urgent, 2=high, 3=normal, 4=low. Default: 3.' },
      },
      required: ['name'],
    },
  },
  {
    name: 'add_meeting_note',
    description: 'Add a note or meeting summary as a comment on an existing task.',
    input_schema: {
      type: 'object',
      properties: {
        task_id: { type: 'string', description: 'ClickUp task ID to comment on.' },
        note: { type: 'string', description: 'The note or meeting summary to add.' },
      },
      required: ['task_id', 'note'],
    },
  },
  {
    name: 'update_task_status',
    description: 'Update the status of an existing task.',
    input_schema: {
      type: 'object',
      properties: {
        task_id: { type: 'string', description: 'The ClickUp task ID.' },
        status: { type: 'string', description: 'New status. Common values: "not started", "in progress", "completed".' },
      },
      required: ['task_id', 'status'],
    },
  },
  {
    name: 'search_tasks',
    description: 'Search for tasks in ClickUp by keyword. Use before creating a task to avoid duplicates, or when Sanyuja asks about existing work.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search term.' },
      },
      required: ['query'],
    },
  },
  {
    name: 'list_tasks',
    description: 'List tasks in a specific ClickUp list. Use to get an overview of what\'s in a project.',
    input_schema: {
      type: 'object',
      properties: {
        list_id: { type: 'string', description: 'ClickUp list ID. Use search_tasks first if you only have a name.' },
        include_closed: { type: 'boolean', description: 'Include completed tasks. Default false.' },
      },
      required: ['list_id'],
    },
  },
]

// ─── Tool implementations ─────────────────────────────────────────────────────

export async function executeTool(toolName, input) {
  switch (toolName) {
    case 'create_task':     return createTask(input)
    case 'add_meeting_note': return addMeetingNote(input)
    case 'update_task_status': return updateTaskStatus(input)
    case 'search_tasks':    return searchTasks(input)
    case 'list_tasks':      return listTasks(input)
    default: throw new Error(`Unknown tool: ${toolName}`)
  }
}

async function createTask({ name, description, list_name = 'ML projects', due_date, priority = 3 }) {
  // 1. Find the list by name
  const lists = await findListsByName(list_name)
  if (!lists.length) {
    return { error: `Could not find a ClickUp list named "${list_name}". Task not created.` }
  }
  const listId = lists[0].id

  // 2. Create the task
  const body = { name, priority }
  if (description) body.description = description
  if (due_date) body.due_date = new Date(due_date).getTime()

  const res = await fetch(`${BASE}/list/${listId}/task`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(body),
  })
  const data = await res.json()
  if (!res.ok) return { error: data.err || 'Failed to create task', details: data }

  return {
    success: true,
    task_id: data.id,
    task_name: data.name,
    url: data.url,
    list: list_name,
  }
}

async function addMeetingNote({ task_id, note }) {
  const res = await fetch(`${BASE}/task/${task_id}/comment`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ comment_text: note }),
  })
  const data = await res.json()
  if (!res.ok) return { error: data.err || 'Failed to add note' }
  return { success: true, comment_id: data.id }
}

async function updateTaskStatus({ task_id, status }) {
  const res = await fetch(`${BASE}/task/${task_id}`, {
    method: 'PUT',
    headers: headers(),
    body: JSON.stringify({ status }),
  })
  const data = await res.json()
  if (!res.ok) return { error: data.err || 'Failed to update status' }
  return { success: true, task_id, new_status: status }
}

async function searchTasks({ query }) {
  const res = await fetch(
    `${BASE}/team/${TEAM_ID}/task?query=${encodeURIComponent(query)}&include_closed=false`,
    { headers: headers() }
  )
  const data = await res.json()
  if (!res.ok) return { error: data.err || 'Search failed' }
  return {
    results: (data.tasks || []).map((t) => ({
      id: t.id,
      name: t.name,
      status: t.status?.status,
      url: t.url,
      list: t.list?.name,
    })),
    count: data.tasks?.length ?? 0,
  }
}

async function listTasks({ list_id, include_closed = false }) {
  const url = `${BASE}/list/${list_id}/task?include_closed=${include_closed}`
  const res = await fetch(url, { headers: headers() })
  const data = await res.json()
  if (!res.ok) return { error: data.err || 'Failed to list tasks' }
  return {
    tasks: (data.tasks || []).map((t) => ({
      id: t.id,
      name: t.name,
      status: t.status?.status,
      assignees: t.assignees?.map((a) => a.username),
      due_date: t.due_date ? new Date(Number(t.due_date)).toISOString().split('T')[0] : null,
    })),
  }
}

// ─── Helper ───────────────────────────────────────────────────────────────────

async function findListsByName(name) {
  // Get full workspace hierarchy and search for a list matching the name
  const res = await fetch(`${BASE}/team/${TEAM_ID}/space?archived=false`, { headers: headers() })
  const { spaces = [] } = await res.json()

  const matches = []
  for (const space of spaces) {
    // Get lists in this space
    const lr = await fetch(`${BASE}/space/${space.id}/list`, { headers: headers() })
    const { lists = [] } = await lr.json()
    matches.push(...lists.filter((l) => l.name.toLowerCase().includes(name.toLowerCase())))

    // Also check folders
    const fr = await fetch(`${BASE}/space/${space.id}/folder`, { headers: headers() })
    const { folders = [] } = await fr.json()
    for (const folder of folders) {
      const flr = await fetch(`${BASE}/folder/${folder.id}/list`, { headers: headers() })
      const { lists: fl = [] } = await flr.json()
      matches.push(...fl.filter((l) => l.name.toLowerCase().includes(name.toLowerCase())))
    }
  }
  return matches
}
