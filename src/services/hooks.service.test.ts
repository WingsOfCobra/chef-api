import crypto from 'crypto'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import { db } from '../db'
import * as hooksService from './hooks.service'

// Mock axios to avoid real HTTP calls
vi.mock('axios', () => ({
  default: { post: vi.fn().mockResolvedValue({ status: 200 }) },
}))

describe('hooks.service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    db.prepare('DELETE FROM hook_events').run()
  })

  describe('verifySignature', () => {
    const secret = 'test-secret-key'

    it('returns true for valid signature', () => {
      const payload = '{"event":"test"}'
      const signature = 'sha256=' + crypto
        .createHmac('sha256', secret)
        .update(payload)
        .digest('hex')

      expect(hooksService.verifySignature(payload, signature, secret)).toBe(true)
    })

    it('returns false for invalid signature', () => {
      const payload = '{"event":"test"}'
      const badSig = 'sha256=' + 'a'.repeat(64)

      expect(hooksService.verifySignature(payload, badSig, secret)).toBe(false)
    })

    it('returns false when secret is empty (verification cannot be skipped)', () => {
      expect(hooksService.verifySignature('anything', 'anything', '')).toBe(false)
    })

    it('returns false for wrong-length signature', () => {
      expect(hooksService.verifySignature('payload', 'sha256=short', secret)).toBe(false)
    })
  })

  describe('storeEvent', () => {
    it('stores an event and returns it', () => {
      const event = hooksService.storeEvent({
        eventType: 'agent.completed',
        source: 'openclaw-agent-1',
        payload: { result: 'success', data: [1, 2, 3] },
      })

      expect(event.id).toBeTypeOf('number')
      expect(event.event_type).toBe('agent.completed')
      expect(event.source).toBe('openclaw-agent-1')
      expect(JSON.parse(event.payload)).toEqual({ result: 'success', data: [1, 2, 3] })
    })

    it('stores event without source', () => {
      const event = hooksService.storeEvent({
        eventType: 'system.alert',
        payload: { level: 'warn' },
      })

      expect(event.source).toBeNull()
    })
  })

  describe('listEvents', () => {
    beforeEach(() => {
      for (let i = 0; i < 5; i++) {
        hooksService.storeEvent({
          eventType: i < 3 ? 'agent.completed' : 'system.alert',
          source: `source-${i}`,
          payload: { index: i },
        })
      }
    })

    it('returns paginated events', () => {
      const result = hooksService.listEvents({ page: 1, limit: 3 })

      expect(result.events).toHaveLength(3)
      expect(result.total).toBe(5)
      expect(result.page).toBe(1)
      expect(result.limit).toBe(3)
    })

    it('filters by eventType', () => {
      const result = hooksService.listEvents({ eventType: 'system.alert' })

      expect(result.events).toHaveLength(2)
      expect(result.total).toBe(2)
      result.events.forEach((e) => expect(e.event_type).toBe('system.alert'))
    })

    it('returns parsed payload', () => {
      const result = hooksService.listEvents({ limit: 1 })

      expect(result.events[0].payload).toBeTypeOf('object')
    })

    it('returns empty for out-of-range page', () => {
      const result = hooksService.listEvents({ page: 100, limit: 10 })

      expect(result.events).toHaveLength(0)
      expect(result.total).toBe(5)
    })
  })

  describe('cleanupOldEvents', () => {
    it('removes events older than TTL', () => {
      // Insert an event with old timestamp
      db.prepare(
        "INSERT INTO hook_events (event_type, payload, created_at) VALUES (?, ?, datetime('now', '-60 days'))"
      ).run('old.event', '{}')
      hooksService.storeEvent({ eventType: 'new.event', payload: {} })

      const removed = hooksService.cleanupOldEvents(30)
      expect(removed).toBe(1)

      const remaining = hooksService.listEvents()
      expect(remaining.total).toBe(1)
      expect(remaining.events[0].event_type).toBe('new.event')
    })

    it('returns 0 when nothing to clean', () => {
      hooksService.storeEvent({ eventType: 'fresh', payload: {} })
      expect(hooksService.cleanupOldEvents(30)).toBe(0)
    })
  })

  describe('sendNotification', () => {
    it('throws when telegram is not configured', async () => {
      await expect(hooksService.sendNotification('telegram', 'test'))
        .rejects.toThrow('Telegram notification not configured')
    })

    it('throws when discord is not configured', async () => {
      await expect(hooksService.sendNotification('discord', 'test'))
        .rejects.toThrow('Discord notification not configured')
    })
  })
})
