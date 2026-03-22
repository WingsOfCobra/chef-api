import { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { db, Todo } from '../db'
import fs from 'fs'
import { config } from '../config'

// Parse TODO.md into structured items
function parseTodoMd(): Array<{ id: number; title: string; completed: boolean; source: 'file' }> {
  try {
    if (!fs.existsSync(config.todoPath)) return []
    const content = fs.readFileSync(config.todoPath, 'utf-8')
    const lines = content.split('\n')
    const items: Array<{ id: number; title: string; completed: boolean; source: 'file' }> = []
    let id = 10000 // offset to avoid collision with DB IDs

    for (const line of lines) {
      const doneMatch = line.match(/^[-*]\s+\[x\]\s+(.+)/i)
      const todoMatch = line.match(/^[-*]\s+\[\s\]\s+(.+)/i)
      if (doneMatch) {
        items.push({ id: id++, title: doneMatch[1].trim(), completed: true, source: 'file' })
      } else if (todoMatch) {
        items.push({ id: id++, title: todoMatch[1].trim(), completed: false, source: 'file' })
      }
    }
    return items
  } catch {
    return []
  }
}

const todoItemSchema = {
  type: 'object',
  properties: {
    id: { type: 'number' },
    title: { type: 'string' },
    description: { type: ['string', 'null'] },
    completed: { type: 'number' },
    created_at: { type: 'string' },
    updated_at: { type: 'string' },
  },
} as const

const fileTodoSchema = {
  type: 'object',
  properties: {
    id: { type: 'number' },
    title: { type: 'string' },
    completed: { type: 'boolean' },
    source: { type: 'string' },
  },
} as const

const errorResponse = {
  type: 'object',
  properties: {
    error: { type: 'string' },
  },
} as const

const todoRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /todo
  fastify.get('/', {
    schema: {
      tags: ['Todos'],
      summary: 'List all todos',
      description: 'Returns all todos from the database and from the TODO.md file, with a total count.',
      response: {
        200: {
          type: 'object',
          properties: {
            db: { type: 'array', items: todoItemSchema },
            file: { type: 'array', items: fileTodoSchema },
            total: { type: 'number' },
          },
        },
      },
    },
  }, async () => {
    const dbItems = db.prepare('SELECT * FROM todos ORDER BY created_at DESC').all() as Todo[]
    const fileItems = parseTodoMd()
    return {
      db: dbItems,
      file: fileItems,
      total: dbItems.length + fileItems.length,
    }
  })

  // POST /todo
  const createSchema = z.object({
    title: z.string().min(1),
    description: z.string().optional(),
  })

  fastify.post('/', {
    schema: {
      tags: ['Todos'],
      summary: 'Create a new todo',
      description: 'Creates a new todo in the database with a title and optional description.',
      response: {
        201: todoItemSchema,
      },
    },
  }, async (request, reply) => {
    const body = createSchema.parse(request.body)

    const result = db
      .prepare(
        'INSERT INTO todos (title, description) VALUES (?, ?) RETURNING *'
      )
      .get(body.title, body.description ?? null) as Todo

    reply.code(201)
    return result
  })

  // PATCH /todo/:id
  const updateSchema = z.object({
    title: z.string().min(1).optional(),
    description: z.string().optional(),
    completed: z.boolean().optional(),
  })

  fastify.patch<{ Params: { id: string } }>('/:id', {
    schema: {
      tags: ['Todos'],
      summary: 'Update a todo',
      description: 'Updates an existing todo by ID. Supports partial updates for title, description, and completed status.',
      params: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
      response: {
        200: todoItemSchema,
        404: errorResponse,
      },
    },
  }, async (request, reply) => {
    const id = parseInt(request.params.id, 10)
    const body = updateSchema.parse(request.body)

    const existing = db.prepare('SELECT * FROM todos WHERE id = ?').get(id) as Todo | undefined
    if (!existing) {
      reply.code(404)
      return { error: 'Not found' }
    }

    const updated = db
      .prepare(
        `UPDATE todos SET
          title = COALESCE(?, title),
          description = COALESCE(?, description),
          completed = COALESCE(?, completed),
          updated_at = datetime('now')
         WHERE id = ? RETURNING *`
      )
      .get(
        body.title ?? null,
        body.description ?? null,
        body.completed !== undefined ? (body.completed ? 1 : 0) : null,
        id
      ) as Todo

    return updated
  })

  // DELETE /todo/:id
  fastify.delete<{ Params: { id: string } }>('/:id', {
    schema: {
      tags: ['Todos'],
      summary: 'Delete a todo',
      description: 'Deletes a todo by ID. Only works for database todos (id < 10000), not file-based todos.',
      params: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
      response: {
        204: { type: 'null', description: 'Todo deleted successfully' },
        404: errorResponse,
      },
    },
  }, async (request, reply) => {
    const id = parseInt(request.params.id, 10)

    const existing = db.prepare('SELECT * FROM todos WHERE id = ?').get(id) as Todo | undefined
    if (!existing) {
      reply.code(404)
      return { error: 'Not found' }
    }

    db.prepare('DELETE FROM todos WHERE id = ?').run(id)
    reply.code(204)
  })
}

export default todoRoutes
