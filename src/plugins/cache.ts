import { FastifyPluginAsync } from 'fastify'
import fp from 'fastify-plugin'
import { db } from '../db'

declare module 'fastify' {
  interface FastifyInstance {
    cache: {
      get: (key: string) => unknown | null
      set: (key: string, value: unknown, ttlSeconds: number) => void
      del: (key: string) => void
      delPattern: (pattern: string) => void
    }
  }
}

const cachePlugin: FastifyPluginAsync = async (fastify) => {
  const get = (key: string): unknown | null => {
    const row = db
      .prepare(
        'SELECT value, created_at, ttl FROM cache WHERE key = ?'
      )
      .get(key) as { value: string; created_at: number; ttl: number } | undefined

    if (!row) return null

    const ageSeconds = Math.floor(Date.now() / 1000) - row.created_at
    if (ageSeconds > row.ttl) {
      db.prepare('DELETE FROM cache WHERE key = ?').run(key)
      return null
    }

    try {
      return JSON.parse(row.value)
    } catch {
      return null
    }
  }

  const set = (key: string, value: unknown, ttlSeconds: number): void => {
    db.prepare(
      `INSERT INTO cache (key, value, ttl, created_at)
       VALUES (?, ?, ?, unixepoch())
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, ttl = excluded.ttl, created_at = unixepoch()`
    ).run(key, JSON.stringify(value), ttlSeconds)
  }

  const del = (key: string): void => {
    db.prepare('DELETE FROM cache WHERE key = ?').run(key)
  }

  const delPattern = (pattern: string): void => {
    db.prepare("DELETE FROM cache WHERE key LIKE ?").run(pattern)
  }

  fastify.decorate('cache', { get, set, del, delPattern })
}

export default fp(cachePlugin, { name: 'cache' })
