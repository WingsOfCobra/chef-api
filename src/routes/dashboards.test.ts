import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { FastifyInstance } from 'fastify'
import { buildApp, authHeaders } from '../test/helpers'
import { db } from '../db'
import dashboardsRoutes from './dashboards'

describe('dashboards routes', () => {
  let app: FastifyInstance

  beforeEach(async () => {
    db.prepare('DELETE FROM settings').run()
    db.prepare('DELETE FROM dashboard_layouts').run()
    app = await buildApp({ routes: [{ plugin: dashboardsRoutes, prefix: '/dashboards' }] })
  })

  afterEach(async () => {
    await app.close()
  })

  describe('GET /dashboards', () => {
    it('returns empty list initially', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/dashboards',
        headers: authHeaders(),
      })

      expect(res.statusCode).toBe(200)
      expect(res.json()).toEqual([])
    })

    it('requires auth', async () => {
      const res = await app.inject({ method: 'GET', url: '/dashboards' })
      expect(res.statusCode).toBe(401)
    })
  })

  describe('POST /dashboards', () => {
    it('creates a dashboard layout', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/dashboards',
        headers: authHeaders(),
        payload: {
          name: 'My Dashboard',
          widgets: [
            { type: 'chart', id: 'cpu' },
            { type: 'table', id: 'containers' },
          ],
        },
      })

      expect(res.statusCode).toBe(201)
      const body = res.json()
      expect(body.name).toBe('My Dashboard')
      expect(body.widgets).toHaveLength(2)
      expect(body.id).toBeTypeOf('number')
      expect(body.createdAt).toBeTypeOf('string')
      expect(body.updatedAt).toBeTypeOf('string')
    })

    it('validates required fields', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/dashboards',
        headers: authHeaders(),
        payload: { name: 'Test' },
      })

      expect(res.statusCode).toBe(400) // Schema validation error
    })
  })

  describe('PUT /dashboards/:id', () => {
    it('updates an existing dashboard', async () => {
      const create = await app.inject({
        method: 'POST',
        url: '/dashboards',
        headers: authHeaders(),
        payload: { name: 'Original', widgets: [] },
      })
      const id = create.json().id

      const res = await app.inject({
        method: 'PUT',
        url: `/dashboards/${id}`,
        headers: authHeaders(),
        payload: {
          name: 'Updated',
          widgets: [{ type: 'new-widget' }],
        },
      })

      expect(res.statusCode).toBe(200)
      expect(res.json().name).toBe('Updated')
      expect(res.json().widgets).toHaveLength(1)
      expect(res.json().id).toBe(id)
    })

    it('returns 404 for nonexistent dashboard', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: '/dashboards/999',
        headers: authHeaders(),
        payload: { name: 'Test', widgets: [] },
      })

      expect(res.statusCode).toBe(404)
    })
  })

  describe('DELETE /dashboards/:id', () => {
    it('deletes an existing dashboard', async () => {
      const create = await app.inject({
        method: 'POST',
        url: '/dashboards',
        headers: authHeaders(),
        payload: { name: 'To Delete', widgets: [] },
      })
      const id = create.json().id

      const res = await app.inject({
        method: 'DELETE',
        url: `/dashboards/${id}`,
        headers: authHeaders(),
      })

      expect(res.statusCode).toBe(204)

      // Verify deletion
      const list = await app.inject({
        method: 'GET',
        url: '/dashboards',
        headers: authHeaders(),
      })
      expect(list.json()).toHaveLength(0)
    })

    it('clears active setting when deleting active dashboard', async () => {
      const create = await app.inject({
        method: 'POST',
        url: '/dashboards',
        headers: authHeaders(),
        payload: { name: 'Active', widgets: [] },
      })
      const id = create.json().id

      // Set as active
      await app.inject({
        method: 'POST',
        url: `/dashboards/${id}/activate`,
        headers: authHeaders(),
      })

      // Delete it
      await app.inject({
        method: 'DELETE',
        url: `/dashboards/${id}`,
        headers: authHeaders(),
      })

      // Active setting should be cleared
      const active = await app.inject({
        method: 'GET',
        url: '/dashboards/active',
        headers: authHeaders(),
      })
      expect(active.json().activeDashboardId).toBeNull()
    })

    it('returns 404 for nonexistent dashboard', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: '/dashboards/999',
        headers: authHeaders(),
      })

      expect(res.statusCode).toBe(404)
    })
  })

  describe('GET /dashboards/active', () => {
    it('returns null when no active dashboard is set', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/dashboards/active',
        headers: authHeaders(),
      })

      expect(res.statusCode).toBe(200)
      expect(res.json().activeDashboardId).toBeNull()
    })

    it('returns active dashboard ID when set', async () => {
      const create = await app.inject({
        method: 'POST',
        url: '/dashboards',
        headers: authHeaders(),
        payload: { name: 'Active', widgets: [] },
      })
      const id = create.json().id

      await app.inject({
        method: 'POST',
        url: `/dashboards/${id}/activate`,
        headers: authHeaders(),
      })

      const res = await app.inject({
        method: 'GET',
        url: '/dashboards/active',
        headers: authHeaders(),
      })

      expect(res.statusCode).toBe(200)
      expect(res.json().activeDashboardId).toBe(id)
    })
  })

  describe('POST /dashboards/:id/activate', () => {
    it('sets a dashboard as active', async () => {
      const create = await app.inject({
        method: 'POST',
        url: '/dashboards',
        headers: authHeaders(),
        payload: { name: 'Test', widgets: [] },
      })
      const id = create.json().id

      const res = await app.inject({
        method: 'POST',
        url: `/dashboards/${id}/activate`,
        headers: authHeaders(),
      })

      expect(res.statusCode).toBe(200)
      expect(res.json().activeDashboardId).toBe(id)
    })

    it('overwrites previous active dashboard', async () => {
      const create1 = await app.inject({
        method: 'POST',
        url: '/dashboards',
        headers: authHeaders(),
        payload: { name: 'First', widgets: [] },
      })
      const id1 = create1.json().id

      const create2 = await app.inject({
        method: 'POST',
        url: '/dashboards',
        headers: authHeaders(),
        payload: { name: 'Second', widgets: [] },
      })
      const id2 = create2.json().id

      await app.inject({
        method: 'POST',
        url: `/dashboards/${id1}/activate`,
        headers: authHeaders(),
      })

      await app.inject({
        method: 'POST',
        url: `/dashboards/${id2}/activate`,
        headers: authHeaders(),
      })

      const active = await app.inject({
        method: 'GET',
        url: '/dashboards/active',
        headers: authHeaders(),
      })

      expect(active.json().activeDashboardId).toBe(id2)
    })

    it('returns 404 for nonexistent dashboard', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/dashboards/999/activate',
        headers: authHeaders(),
      })

      expect(res.statusCode).toBe(404)
    })
  })
})
