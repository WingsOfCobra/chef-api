import { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { db } from '../db'

const createDashboardSchema = z.object({
  name: z.string().min(1).max(100),
  widgets: z.array(z.unknown()),
})

const updateDashboardSchema = z.object({
  name: z.string().min(1).max(100),
  widgets: z.array(z.unknown()),
})

const dashboardSchema = {
  type: 'object',
  properties: {
    id: { type: 'number' },
    name: { type: 'string' },
    widgets: { type: 'array', items: {} },
    createdAt: { type: 'string' },
    updatedAt: { type: 'string' },
  },
} as const

const errorResponse = {
  type: 'object',
  properties: {
    error: { type: 'string' },
  },
} as const

interface DashboardRow {
  id: number
  name: string
  widgets: string
  created_at: string
  updated_at: string
}

interface Dashboard {
  id: number
  name: string
  widgets: unknown[]
  createdAt: string
  updatedAt: string
}

// Ensure tables exist
db.exec(`
  CREATE TABLE IF NOT EXISTS dashboard_layouts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    widgets TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`)

function rowToDashboard(row: DashboardRow): Dashboard {
  return {
    id: row.id,
    name: row.name,
    widgets: JSON.parse(row.widgets),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

const dashboardRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /dashboards — list all saved dashboard layouts
  fastify.get('/', {
    schema: {
      tags: ['Dashboards'],
      summary: 'List all dashboards',
      description: 'Returns all saved dashboard layouts.',
      response: {
        200: { type: 'array', items: dashboardSchema },
      },
    },
  }, async () => {
    const rows = db.prepare('SELECT * FROM dashboard_layouts ORDER BY created_at DESC').all() as DashboardRow[]
    return rows.map(rowToDashboard)
  })

  // POST /dashboards — create a new layout
  fastify.post('/', {
    schema: {
      tags: ['Dashboards'],
      summary: 'Create a dashboard',
      description: 'Creates a new dashboard layout with the specified name and widgets.',
      body: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          widgets: { type: 'array', items: {} },
        },
        required: ['name', 'widgets'],
      },
      response: {
        201: dashboardSchema,
      },
    },
  }, async (request, reply) => {
    const body = createDashboardSchema.parse(request.body)

    const result = db.prepare(
      'INSERT INTO dashboard_layouts (name, widgets) VALUES (?, ?) RETURNING *'
    ).get(body.name, JSON.stringify(body.widgets)) as DashboardRow

    reply.code(201)
    return rowToDashboard(result)
  })

  // PUT /dashboards/:id — replace a layout (full update)
  fastify.put<{ Params: { id: string } }>('/:id', {
    schema: {
      tags: ['Dashboards'],
      summary: 'Update a dashboard',
      description: 'Replaces an existing dashboard layout with new name and widgets.',
      params: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
      body: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          widgets: { type: 'array', items: {} },
        },
        required: ['name', 'widgets'],
      },
      response: {
        200: dashboardSchema,
        404: errorResponse,
      },
    },
  }, async (request, reply) => {
    const id = parseInt(request.params.id, 10)
    const body = updateDashboardSchema.parse(request.body)

    const existing = db.prepare('SELECT id FROM dashboard_layouts WHERE id = ?').get(id)
    if (!existing) {
      reply.code(404)
      return { error: 'Not found' }
    }

    const result = db.prepare(
      `UPDATE dashboard_layouts 
       SET name = ?, widgets = ?, updated_at = datetime('now')
       WHERE id = ? RETURNING *`
    ).get(body.name, JSON.stringify(body.widgets), id) as DashboardRow

    return rowToDashboard(result)
  })

  // DELETE /dashboards/:id — delete a layout
  fastify.delete<{ Params: { id: string } }>('/:id', {
    schema: {
      tags: ['Dashboards'],
      summary: 'Delete a dashboard',
      description: 'Deletes a dashboard layout by ID.',
      params: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
      response: {
        204: { type: 'null', description: 'Dashboard deleted successfully' },
        404: errorResponse,
      },
    },
  }, async (request, reply) => {
    const id = parseInt(request.params.id, 10)

    const result = db.prepare('DELETE FROM dashboard_layouts WHERE id = ?').run(id)
    if (result.changes === 0) {
      reply.code(404)
      return { error: 'Not found' }
    }

    // If this was the active dashboard, clear the setting
    const activeSetting = db.prepare('SELECT value FROM settings WHERE key = ?').get('active_dashboard') as { value: string } | undefined
    if (activeSetting && parseInt(activeSetting.value, 10) === id) {
      db.prepare('DELETE FROM settings WHERE key = ?').run('active_dashboard')
    }

    reply.code(204)
  })

  // GET /dashboards/active — return the currently active dashboard id
  fastify.get('/active', {
    schema: {
      tags: ['Dashboards'],
      summary: 'Get active dashboard',
      description: 'Returns the ID of the currently active dashboard, or null if none is set.',
      response: {
        200: {
          type: 'object',
          properties: {
            activeDashboardId: { type: ['number', 'null'] },
          },
        },
      },
    },
  }, async () => {
    const setting = db.prepare('SELECT value FROM settings WHERE key = ?').get('active_dashboard') as { value: string } | undefined
    return {
      activeDashboardId: setting ? parseInt(setting.value, 10) : null,
    }
  })

  // POST /dashboards/:id/activate — set a dashboard as active
  fastify.post<{ Params: { id: string } }>('/:id/activate', {
    schema: {
      tags: ['Dashboards'],
      summary: 'Activate a dashboard',
      description: 'Sets the specified dashboard as the active one.',
      params: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
      response: {
        200: {
          type: 'object',
          properties: {
            activeDashboardId: { type: 'number' },
          },
        },
        404: errorResponse,
      },
    },
  }, async (request, reply) => {
    const id = parseInt(request.params.id, 10)

    // Verify dashboard exists
    const existing = db.prepare('SELECT id FROM dashboard_layouts WHERE id = ?').get(id)
    if (!existing) {
      reply.code(404)
      return { error: 'Not found' }
    }

    // Upsert into settings table
    db.prepare(
      `INSERT INTO settings (key, value) VALUES ('active_dashboard', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
    ).run(id.toString())

    return { activeDashboardId: id }
  })
}

export default dashboardRoutes
