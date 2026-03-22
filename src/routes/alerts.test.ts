import { vi, describe, it, expect, beforeAll, afterAll } from 'vitest'
import { FastifyInstance } from 'fastify'
import { buildApp, authHeaders } from '../test/helpers'
import alertsRoutes from './alerts'

vi.mock('axios', () => ({
  default: { post: vi.fn().mockRejectedValue(new Error('test webhook unreachable')) },
}))

describe('alerts routes', () => {
  let app: FastifyInstance

  beforeAll(async () => {
    app = await buildApp({
      routes: [{ plugin: alertsRoutes, prefix: '/alerts' }],
    })
  })

  afterAll(async () => {
    await app.close()
  })

  it('GET /alerts/rules returns empty array initially', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/alerts/rules',
      headers: authHeaders(),
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual([])
  })

  it('POST /alerts/rules creates a rule', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/alerts/rules',
      headers: { ...authHeaders(), 'content-type': 'application/json' },
      payload: {
        name: 'Disk Warning',
        type: 'disk_usage',
        target: '/',
        threshold: 80,
        webhook_url: 'https://example.com/webhook',
      },
    })
    expect(res.statusCode).toBe(201)
    const body = res.json()
    expect(body.name).toBe('Disk Warning')
    expect(body.type).toBe('disk_usage')
    expect(body.target).toBe('/')
    expect(body.threshold).toBe(80)
    expect(body.webhook_url).toBe('https://example.com/webhook')
    expect(body.enabled).toBe(1)
    expect(body.id).toBeDefined()
  })

  it('GET /alerts/rules returns created rules', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/alerts/rules',
      headers: authHeaders(),
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.length).toBeGreaterThanOrEqual(1)
  })

  it('PATCH /alerts/rules/:id updates a rule', async () => {
    // Create one first
    const createRes = await app.inject({
      method: 'POST',
      url: '/alerts/rules',
      headers: { ...authHeaders(), 'content-type': 'application/json' },
      payload: {
        name: 'Memory Alert',
        type: 'memory_usage',
        threshold: 90,
        webhook_url: 'https://example.com/hook',
      },
    })
    const created = createRes.json()

    const res = await app.inject({
      method: 'PATCH',
      url: `/alerts/rules/${created.id}`,
      headers: { ...authHeaders(), 'content-type': 'application/json' },
      payload: { enabled: false },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().enabled).toBe(0)
  })

  it('PATCH /alerts/rules/:id returns 404 for non-existent', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/alerts/rules/99999',
      headers: { ...authHeaders(), 'content-type': 'application/json' },
      payload: { name: 'Nope' },
    })
    expect(res.statusCode).toBe(404)
  })

  it('DELETE /alerts/rules/:id deletes a rule', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/alerts/rules',
      headers: { ...authHeaders(), 'content-type': 'application/json' },
      payload: {
        name: 'To delete',
        type: 'cron_failure',
        webhook_url: 'https://example.com/hook',
      },
    })
    const created = createRes.json()

    const res = await app.inject({
      method: 'DELETE',
      url: `/alerts/rules/${created.id}`,
      headers: authHeaders(),
    })
    expect(res.statusCode).toBe(204)
  })

  it('DELETE /alerts/rules/:id returns 404 for non-existent', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/alerts/rules/99999',
      headers: authHeaders(),
    })
    expect(res.statusCode).toBe(404)
  })

  it('GET /alerts/events returns events list', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/alerts/events',
      headers: authHeaders(),
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body).toHaveProperty('events')
    expect(body).toHaveProperty('total')
  })

  it('POST /alerts/rules/:id/test fires a test webhook', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/alerts/rules',
      headers: { ...authHeaders(), 'content-type': 'application/json' },
      payload: {
        name: 'Test Rule',
        type: 'disk_usage',
        threshold: 50,
        webhook_url: 'https://example.com/test',
      },
    })
    const rule = createRes.json()

    const res = await app.inject({
      method: 'POST',
      url: `/alerts/rules/${rule.id}/test`,
      headers: authHeaders(),
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.rule_id).toBe(rule.id)
    expect(body.attempts).toBeGreaterThan(0)
  }, 120000)

  it('POST /alerts/rules/:id/test returns 404 for non-existent', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/alerts/rules/99999/test',
      headers: authHeaders(),
    })
    expect(res.statusCode).toBe(404)
  })

  it('POST /alerts/rules with invalid body returns error', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/alerts/rules',
      headers: { ...authHeaders(), 'content-type': 'application/json' },
      payload: { name: '' },
    })
    expect(res.statusCode).toBeGreaterThanOrEqual(400)
  })

  it('requires auth', async () => {
    const res = await app.inject({ method: 'GET', url: '/alerts/rules' })
    expect(res.statusCode).toBe(401)
  })
})
