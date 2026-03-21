import { vi, describe, it, expect, beforeAll, afterAll } from 'vitest'
import { FastifyInstance } from 'fastify'
import { buildApp, authHeaders } from '../test/helpers'

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>()
  return {
    ...actual,
    default: {
      ...actual,
      existsSync: vi.fn((p: string) => {
        if (p === '/tmp/test-todo.md') return false
        return actual.existsSync(p)
      }),
      readFileSync: actual.readFileSync,
      mkdirSync: actual.mkdirSync,
    },
  }
})

import todoRoutes from './todo'

describe('todo routes', () => {
  let app: FastifyInstance

  beforeAll(async () => {
    app = await buildApp({
      routes: [{ plugin: todoRoutes, prefix: '/todo' }],
    })
  })

  afterAll(async () => {
    await app.close()
  })

  it('GET /todo returns db and file items', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/todo',
      headers: authHeaders(),
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body).toHaveProperty('db')
    expect(body).toHaveProperty('file')
    expect(body).toHaveProperty('total')
  })

  it('POST /todo creates a todo item', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/todo',
      headers: { ...authHeaders(), 'content-type': 'application/json' },
      payload: { title: 'Test task', description: 'A test' },
    })
    expect(res.statusCode).toBe(201)
    const body = res.json()
    expect(body.title).toBe('Test task')
    expect(body.description).toBe('A test')
    expect(body.id).toBeDefined()
  })

  it('POST /todo with invalid body returns error', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/todo',
      headers: { ...authHeaders(), 'content-type': 'application/json' },
      payload: { title: '' },
    })
    // Zod throws, Fastify returns 500 (no custom error handler)
    expect(res.statusCode).toBeGreaterThanOrEqual(400)
  })

  it('PATCH /todo/:id updates a todo item', async () => {
    // First create one
    const createRes = await app.inject({
      method: 'POST',
      url: '/todo',
      headers: { ...authHeaders(), 'content-type': 'application/json' },
      payload: { title: 'To update' },
    })
    const created = createRes.json()

    const res = await app.inject({
      method: 'PATCH',
      url: `/todo/${created.id}`,
      headers: { ...authHeaders(), 'content-type': 'application/json' },
      payload: { completed: true },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().completed).toBe(1)
  })

  it('PATCH /todo/:id returns 404 for non-existent item', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/todo/99999',
      headers: { ...authHeaders(), 'content-type': 'application/json' },
      payload: { title: 'Nope' },
    })
    expect(res.statusCode).toBe(404)
  })

  it('DELETE /todo/:id deletes a todo item', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/todo',
      headers: { ...authHeaders(), 'content-type': 'application/json' },
      payload: { title: 'To delete' },
    })
    const created = createRes.json()

    const res = await app.inject({
      method: 'DELETE',
      url: `/todo/${created.id}`,
      headers: authHeaders(),
    })
    expect(res.statusCode).toBe(204)
  })

  it('DELETE /todo/:id returns 404 for non-existent item', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/todo/99999',
      headers: authHeaders(),
    })
    expect(res.statusCode).toBe(404)
  })

  it('GET /todo requires auth', async () => {
    const res = await app.inject({ method: 'GET', url: '/todo' })
    expect(res.statusCode).toBe(401)
  })
})
