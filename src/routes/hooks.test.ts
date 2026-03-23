import crypto from 'crypto'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { FastifyInstance } from 'fastify'
import { buildApp, authHeaders } from '../test/helpers'
import { db } from '../db'
import hooksRoutes from './hooks'

// Mock axios with hoisted function
const mockAxiosPost = vi.hoisted(() => vi.fn().mockResolvedValue({ status: 200, data: {} }))
vi.mock('axios', () => ({
  default: { post: mockAxiosPost },
}))

describe('hooks routes', () => {
  let app: FastifyInstance

  beforeEach(async () => {
    db.prepare('DELETE FROM hook_events').run()
    mockAxiosPost.mockClear()
    mockAxiosPost.mockResolvedValue({ status: 200, data: {} } as any)
    app = await buildApp({ routes: [{ plugin: hooksRoutes, prefix: '/hooks' }] })
  })

  afterEach(async () => {
    await app.close()
  })

  describe('POST /hooks/agent-event', () => {
    it('returns 503 when webhook secret is not configured', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/hooks/agent-event',
        payload: {
          eventType: 'agent.completed',
          source: 'test-agent',
          payload: { result: 'ok' },
        },
      })

      // WEBHOOK_SECRET is empty in test setup → 503
      expect(res.statusCode).toBe(503)
      expect(res.json().error).toContain('not configured')
    })

    it('does not require API key auth (uses webhook secret instead)', async () => {
      // No API key headers — should get 503 (not 401) because webhook secret is checked first
      const res = await app.inject({
        method: 'POST',
        url: '/hooks/agent-event',
        payload: { eventType: 'test', payload: {} },
      })

      expect(res.statusCode).toBe(503)
    })
  })

  describe('GET /hooks/events', () => {
    it('requires auth', async () => {
      const res = await app.inject({ method: 'GET', url: '/hooks/events' })
      expect(res.statusCode).toBe(401)
    })

    it('returns paginated events', async () => {
      // Insert events directly into DB (agent-event endpoint requires webhook secret)
      for (let i = 0; i < 3; i++) {
        db.prepare(
          "INSERT INTO hook_events (event_type, source, payload) VALUES (?, ?, ?)"
        ).run('test', `src-${i}`, JSON.stringify({ i }))
      }

      const res = await app.inject({
        method: 'GET',
        url: '/hooks/events?limit=2&page=1',
        headers: authHeaders(),
      })

      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body.events).toHaveLength(2)
      expect(body.total).toBe(3)
    })

    it('filters by eventType', async () => {
      db.prepare(
        "INSERT INTO hook_events (event_type, payload) VALUES (?, ?)"
      ).run('type-a', '{}')
      db.prepare(
        "INSERT INTO hook_events (event_type, payload) VALUES (?, ?)"
      ).run('type-b', '{}')

      const res = await app.inject({
        method: 'GET',
        url: '/hooks/events?eventType=type-a',
        headers: authHeaders(),
      })

      expect(res.json().total).toBe(1)
      expect(res.json().events[0].event_type).toBe('type-a')
    })
  })

  describe('POST /hooks/notify', () => {
    it('requires auth', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/hooks/notify',
        payload: { channel: 'telegram', message: 'test' },
      })
      expect(res.statusCode).toBe(401)
    })

    it('rejects invalid channel', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/hooks/notify',
        headers: authHeaders(),
        payload: { channel: 'sms', message: 'test' },
      })
      // Zod validation failure
      expect(res.statusCode).toBe(500)
    })
  })

  describe('POST /hooks/alertmanager', () => {
    const firingPayload = {
      version: '4',
      status: 'firing',
      groupKey: 'test-group',
      receiver: 'nextcloud-talk',
      groupLabels: {},
      commonLabels: {
        alertname: 'ContainerDown',
        severity: 'critical',
      },
      commonAnnotations: {
        summary: 'Container nginx is down',
        description: 'Has been down for 5 minutes',
      },
      alerts: [
        {
          status: 'firing',
          labels: {
            alertname: 'ContainerDown',
            severity: 'critical',
            name: 'nginx',
          },
          annotations: {
            summary: 'Container nginx is down',
            description: 'Has been down for 5 minutes',
          },
          startsAt: '2026-03-23T10:00:00Z',
          endsAt: '0001-01-01T00:00:00Z',
        },
      ],
    }

    const resolvedPayload = {
      ...firingPayload,
      status: 'resolved',
      commonAnnotations: {
        summary: 'Container nginx is back up',
      },
      alerts: [
        {
          ...firingPayload.alerts[0],
          status: 'resolved',
          annotations: {
            summary: 'Container nginx is back up',
          },
          endsAt: '2026-03-23T10:05:00Z',
        },
      ],
    }

    it('does not require API key auth', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/hooks/alertmanager',
        payload: firingPayload,
      })

      // Should succeed without auth headers (no 401)
      expect(res.statusCode).toBe(200)
    })

    it('formats and sends firing alert to Nextcloud Talk', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/hooks/alertmanager',
        payload: firingPayload,
      })

      expect(res.statusCode).toBe(200)
      expect(res.json()).toEqual({ ok: true })

      // Check axios was called with correct message format
      expect(mockAxiosPost).toHaveBeenCalledTimes(1)
      const [url, body, options] = mockAxiosPost.mock.calls[0]
      
      expect(url).toContain('/ocs/v2.php/apps/spreed/api/v1/chat/')
      expect(body).toHaveProperty('message')
      expect(body.message).toContain('🔴 FIRING: ContainerDown')
      expect(body.message).toContain('critical')
      expect(body.message).toContain('Summary: Container nginx is down')
      expect(body.message).toContain('Description: Has been down for 5 minutes')
      expect(body.message).toContain('Alerts: 1')
      
      expect(options?.headers).toMatchObject({
        'OCS-APIRequest': 'true',
        'Content-Type': 'application/json',
      })
      expect(options?.headers?.Authorization).toMatch(/^Basic /)
    })

    it('formats and sends resolved alert to Nextcloud Talk', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/hooks/alertmanager',
        payload: resolvedPayload,
      })

      expect(res.statusCode).toBe(200)
      expect(res.json()).toEqual({ ok: true })

      expect(mockAxiosPost).toHaveBeenCalledTimes(1)
      const [, body] = mockAxiosPost.mock.calls[0]
      
      expect(body.message).toContain('✅ RESOLVED: ContainerDown')
      expect(body.message).toContain('Summary: Container nginx is back up')
      expect(body.message).not.toContain('Description:')
      expect(body.message).not.toContain('Alerts:')
    })

    it('handles multiple alerts', async () => {
      const multiAlertPayload = {
        ...firingPayload,
        alerts: [
          firingPayload.alerts[0],
          { ...firingPayload.alerts[0], labels: { ...firingPayload.alerts[0].labels, name: 'apache' } },
          { ...firingPayload.alerts[0], labels: { ...firingPayload.alerts[0].labels, name: 'postgres' } },
        ],
      }

      const res = await app.inject({
        method: 'POST',
        url: '/hooks/alertmanager',
        payload: multiAlertPayload,
      })

      expect(res.statusCode).toBe(200)
      
      const [, body] = mockAxiosPost.mock.calls[0]
      expect(body.message).toContain('Alerts: 3')
    })

    it('returns ok even on Nextcloud Talk errors (for alertmanager retry prevention)', async () => {
      mockAxiosPost.mockRejectedValueOnce(new Error('Network error'))

      const res = await app.inject({
        method: 'POST',
        url: '/hooks/alertmanager',
        payload: firingPayload,
      })

      expect(res.statusCode).toBe(200)
      expect(res.json()).toEqual({ ok: true })
    })

    it('validates alertmanager payload schema', async () => {
      const invalidPayload = {
        version: '4',
        // Missing required fields
      }

      const res = await app.inject({
        method: 'POST',
        url: '/hooks/alertmanager',
        payload: invalidPayload,
      })

      // Should still return 200 to prevent alertmanager retries
      expect(res.statusCode).toBe(200)
      expect(res.json()).toEqual({ ok: true })
      
      // But should not call axios
      expect(mockAxiosPost).not.toHaveBeenCalled()
    })
  })
})
