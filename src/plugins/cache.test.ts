import { vi, describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { buildApp } from '../test/helpers'
import { FastifyInstance } from 'fastify'

describe('cache plugin', () => {
  let app: FastifyInstance

  beforeAll(async () => {
    app = await buildApp({ skipAuth: true })
  })

  afterAll(async () => {
    await app.close()
  })

  beforeEach(() => {
    // Clean cache between tests
    app.cache.delPattern('%')
  })

  it('set then get returns the value', () => {
    app.cache.set('key1', { foo: 'bar' }, 60)
    const result = app.cache.get('key1')
    expect(result).toEqual({ foo: 'bar' })
  })

  it('get returns null for non-existent key', () => {
    expect(app.cache.get('nonexistent')).toBeNull()
  })

  it('del removes a key', () => {
    app.cache.set('key2', 'value', 60)
    expect(app.cache.get('key2')).toBe('value')

    app.cache.del('key2')
    expect(app.cache.get('key2')).toBeNull()
  })

  it('delPattern removes matching keys', () => {
    app.cache.set('github:repos:me', ['repo1'], 60)
    app.cache.set('github:prs:user/repo', ['pr1'], 60)
    app.cache.set('docker:containers', ['c1'], 60)

    app.cache.delPattern('github:%')

    expect(app.cache.get('github:repos:me')).toBeNull()
    expect(app.cache.get('github:prs:user/repo')).toBeNull()
    expect(app.cache.get('docker:containers')).toEqual(['c1'])
  })

  it('returns null after TTL expires', () => {
    vi.useFakeTimers()
    try {
      app.cache.set('ttl-key', 'data', 5)
      expect(app.cache.get('ttl-key')).toBe('data')

      // Advance past TTL
      vi.advanceTimersByTime(6000)
      expect(app.cache.get('ttl-key')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('handles JSON serialization of various types', () => {
    app.cache.set('str', 'hello', 60)
    app.cache.set('num', 42, 60)
    app.cache.set('arr', [1, 2, 3], 60)
    app.cache.set('obj', { nested: { deep: true } }, 60)
    app.cache.set('bool', true, 60)

    expect(app.cache.get('str')).toBe('hello')
    expect(app.cache.get('num')).toBe(42)
    expect(app.cache.get('arr')).toEqual([1, 2, 3])
    expect(app.cache.get('obj')).toEqual({ nested: { deep: true } })
    expect(app.cache.get('bool')).toBe(true)
  })

  it('overwrites existing key on set', () => {
    app.cache.set('overwrite', 'first', 60)
    expect(app.cache.get('overwrite')).toBe('first')

    app.cache.set('overwrite', 'second', 60)
    expect(app.cache.get('overwrite')).toBe('second')
  })
})
