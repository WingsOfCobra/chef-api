import { vi, describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { FastifyInstance } from 'fastify'
import { buildApp, authHeaders } from '../test/helpers'

vi.mock('../services/system.service', () => ({
  getHealth: vi.fn(async () => ({
    status: 'ok',
    uptime: 100,
    uptimeHuman: '1m',
    hostname: 'test',
    platform: 'linux x64',
    nodeVersion: 'v20.0.0',
    cpu: { usage_percent: 15.2, cores: 4, model: 'Test CPU' },
    memory: { total: '16.00 GB', free: '8.00 GB', usedPercent: '50.0%' },
    network: { rx_bytes: 5000, tx_bytes: 3000 },
    loadAvg: [1, 0.8, 0.5],
    timestamp: '2025-01-01T00:00:00.000Z',
  })),
  getDiskUsage: vi.fn(() => [
    { filesystem: '/dev/sda1', size: '50G', used: '20G', available: '28G', usePercent: '42%', mountpoint: '/' },
  ]),
  getTopProcesses: vi.fn(() => [
    { pid: 1, user: 'root', cpuPercent: '2.5', memPercent: '0.1', command: '/sbin/init' },
  ]),
  getMemoryDetail: vi.fn(() => ({
    total: 16777216000, free: 4194304000, available: 8388608000,
    buffers: 524288000, cached: 2097152000,
    swapTotal: 4194304000, swapFree: 3145728000, swapUsed: 1048576000,
    usedPercent: 50, swapUsedPercent: 25,
  })),
  getNetworkInterfaces: vi.fn(() => [
    { name: 'eth0', rx_bytes: 5000, tx_bytes: 3000, rx_packets: 50, tx_packets: 30, ipv4: '192.168.1.100', ipv6: null },
  ]),
}))

import systemRoutes from './system'

describe('system routes', () => {
  let app: FastifyInstance

  beforeAll(async () => {
    app = await buildApp({
      routes: [{ plugin: systemRoutes, prefix: '/system' }],
    })
  })

  afterAll(async () => {
    await app.close()
  })

  beforeEach(() => {
    app.cache.delPattern('%')
    vi.clearAllMocks()
  })

  it('GET /system/health returns 200 without auth', async () => {
    const res = await app.inject({ method: 'GET', url: '/system/health' })
    expect(res.statusCode).toBe(200)
    expect(res.json().status).toBe('ok')
  })

  it('GET /system/disk requires auth', async () => {
    const res = await app.inject({ method: 'GET', url: '/system/disk' })
    expect(res.statusCode).toBe(401)
  })

  it('GET /system/disk returns disk data with auth', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/system/disk',
      headers: authHeaders(),
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toHaveLength(1)
    expect(res.json()[0].filesystem).toBe('/dev/sda1')
  })

  it('GET /system/processes returns process data', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/system/processes',
      headers: authHeaders(),
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toHaveLength(1)
  })

  it('GET /system/memory requires auth', async () => {
    const res = await app.inject({ method: 'GET', url: '/system/memory' })
    expect(res.statusCode).toBe(401)
  })

  it('GET /system/memory returns detailed memory breakdown', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/system/memory',
      headers: authHeaders(),
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.total).toBe(16777216000)
    expect(body.usedPercent).toBe(50)
    expect(body.swapUsed).toBe(1048576000)
    expect(body.swapUsedPercent).toBe(25)
  })

  it('GET /system/memory uses cache on second call', async () => {
    const { getMemoryDetail } = await import('../services/system.service')
    vi.mocked(getMemoryDetail).mockClear()

    await app.inject({ method: 'GET', url: '/system/memory', headers: authHeaders() })
    await app.inject({ method: 'GET', url: '/system/memory', headers: authHeaders() })

    expect(getMemoryDetail).toHaveBeenCalledTimes(1)
  })

  it('GET /system/network requires auth', async () => {
    const res = await app.inject({ method: 'GET', url: '/system/network' })
    expect(res.statusCode).toBe(401)
  })

  it('GET /system/network returns per-interface data', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/system/network',
      headers: authHeaders(),
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body).toHaveLength(1)
    expect(body[0].name).toBe('eth0')
    expect(body[0].ipv4).toBe('192.168.1.100')
    expect(body[0].rx_bytes).toBe(5000)
  })
})
