import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import Fastify, { FastifyInstance } from 'fastify'
import websocket from '@fastify/websocket'
import cachePlugin from '../plugins/cache'
import authPlugin from '../plugins/auth'
import wsRoutes from './ws'
import WebSocket from 'ws'

let app: FastifyInstance
let baseUrl: string

beforeAll(async () => {
  app = Fastify({ logger: false })
  await app.register(websocket)
  await app.register(cachePlugin)
  await app.register(authPlugin)
  await app.register(wsRoutes, { prefix: '/ws' })
  await app.listen({ port: 0, host: '127.0.0.1' })
  const addr = app.server.address()
  if (addr && typeof addr === 'object') {
    baseUrl = `ws://127.0.0.1:${addr.port}`
  }
})

afterAll(async () => {
  await app.close()
})

describe('WebSocket auth rejection', () => {
  it('rejects /ws/system with no key', async () => {
    const ws = new WebSocket(`${baseUrl}/ws/system`)
    const code = await new Promise<number>((resolve) => {
      ws.on('close', (code) => resolve(code))
    })
    expect(code).toBe(4001)
  })

  it('rejects /ws/system with wrong key', async () => {
    const ws = new WebSocket(`${baseUrl}/ws/system?key=wrong-key`)
    const code = await new Promise<number>((resolve) => {
      ws.on('close', (code) => resolve(code))
    })
    expect(code).toBe(4001)
  })

  it('rejects /ws/containers with no key', async () => {
    const ws = new WebSocket(`${baseUrl}/ws/containers`)
    const code = await new Promise<number>((resolve) => {
      ws.on('close', (code) => resolve(code))
    })
    expect(code).toBe(4001)
  })

  it('rejects /ws/logs/:id with no key', async () => {
    const ws = new WebSocket(`${baseUrl}/ws/logs/test-container`)
    const code = await new Promise<number>((resolve) => {
      ws.on('close', (code) => resolve(code))
    })
    expect(code).toBe(4001)
  })

  it('accepts /ws/system with valid key and receives data', async () => {
    const ws = new WebSocket(`${baseUrl}/ws/system?key=test-api-key-12345`)
    const message = await new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => {
        ws.close()
        reject(new Error('Timeout waiting for message'))
      }, 5000)
      ws.on('message', (data) => {
        clearTimeout(timeout)
        resolve(data.toString())
        ws.close()
      })
      ws.on('error', reject)
    })
    const parsed = JSON.parse(message)
    expect(parsed.type).toBe('system')
    expect(typeof parsed.cpu).toBe('number')
    expect(typeof parsed.memUsedPercent).toBe('number')
    expect(Array.isArray(parsed.loadAvg)).toBe(true)
    expect(typeof parsed.timestamp).toBe('string')
  })
})
