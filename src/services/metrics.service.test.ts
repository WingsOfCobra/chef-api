import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('./system.service', () => ({
  getHealth: vi.fn().mockResolvedValue({
    status: 'ok',
    uptime: 1000,
    uptimeHuman: '16m',
    hostname: 'test-host',
    platform: 'linux x64',
    nodeVersion: 'v20.0.0',
    cpu: { usage_percent: 45.2, cores: 4, model: 'Test CPU' },
    memory: { total: '16.00 GB', free: '8.00 GB', usedPercent: '50.0%' },
    network: { rx_bytes: 5000, tx_bytes: 3000 },
    loadAvg: [0.5, 0.3, 0.2],
    timestamp: '2024-01-01T00:00:00.000Z',
  }),
  getMemoryDetail: vi.fn().mockReturnValue({
    total: 16 * 1024 * 1024 * 1024,
    free: 8 * 1024 * 1024 * 1024,
    available: 8 * 1024 * 1024 * 1024,
    buffers: 0,
    cached: 0,
    swapTotal: 0,
    swapFree: 0,
    swapUsed: 0,
    usedPercent: 50,
    swapUsedPercent: 0,
  }),
  getDiskUsage: vi.fn().mockReturnValue([
    { filesystem: '/dev/sda1', size: '50G', used: '20G', available: '28G', usePercent: '42%', mountpoint: '/' },
    { filesystem: '/dev/sda2', size: '100G', used: '72G', available: '28G', usePercent: '72%', mountpoint: '/home' },
  ]),
}))

vi.mock('./docker.service', () => ({
  listContainers: vi.fn().mockResolvedValue([
    { id: 'abc', name: 'web', image: 'nginx', status: 'Up 2h', state: 'running', health: null, uptime: 'Up 2h', ports: [] },
    { id: 'def', name: 'db', image: 'postgres', status: 'Up 1h', state: 'running', health: null, uptime: 'Up 1h', ports: [] },
    { id: 'ghi', name: 'old', image: 'alpine', status: 'Exited', state: 'exited', health: null, uptime: 'Exited', ports: [] },
  ]),
}))

vi.mock('../db', () => {
  const prepare = vi.fn().mockReturnValue({
    get: vi.fn().mockReturnValue({ total: 45, success: 42, error: 3 }),
  })
  return {
    db: { prepare },
  }
})

import { getMetricsSnapshot, getPrometheusText } from './metrics.service'

describe('metrics.service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('getMetricsSnapshot', () => {
    it('returns correct JSON structure', async () => {
      const snapshot = await getMetricsSnapshot()

      expect(snapshot.cpu.usage_percent).toBe(45.2)
      expect(snapshot.cpu.cores).toBe(4)
      expect(snapshot.cpu.load_avg).toEqual([0.5, 0.3, 0.2])
      expect(snapshot.memory.total_bytes).toBe(16 * 1024 * 1024 * 1024)
      expect(snapshot.memory.used_percent).toBe(50)
      expect(snapshot.disk).toHaveLength(2)
      expect(snapshot.disk[0]).toEqual({ mountpoint: '/', use_percent: 42 })
      expect(snapshot.disk[1]).toEqual({ mountpoint: '/home', use_percent: 72 })
      expect(snapshot.containers).toEqual({ running: 2, stopped: 1, paused: 0 })
      expect(snapshot.ssh_jobs).toEqual({ total: 45, success: 42, error: 3 })
      expect(snapshot.timestamp).toBeDefined()
    })
  })

  describe('getPrometheusText', () => {
    it('returns valid Prometheus exposition format', async () => {
      const text = await getPrometheusText()

      expect(text).toContain('# HELP chef_cpu_usage_percent')
      expect(text).toContain('# TYPE chef_cpu_usage_percent gauge')
      expect(text).toContain('chef_cpu_usage_percent 45.2')

      expect(text).toContain('# HELP chef_memory_usage_percent')
      expect(text).toContain('chef_memory_usage_percent 50')

      expect(text).toContain('chef_disk_usage_percent{mountpoint="/"} 42')
      expect(text).toContain('chef_disk_usage_percent{mountpoint="/home"} 72')

      expect(text).toContain('chef_containers_total{state="running"} 2')
      expect(text).toContain('chef_containers_total{state="stopped"} 1')
      expect(text).toContain('chef_containers_total{state="paused"} 0')

      expect(text).toContain('chef_load_average{period="1m"} 0.5')
      expect(text).toContain('chef_load_average{period="5m"} 0.3')
      expect(text).toContain('chef_load_average{period="15m"} 0.2')

      expect(text).toContain('chef_ssh_jobs_total{status="success"} 42')
      expect(text).toContain('chef_ssh_jobs_total{status="error"} 3')
    })

    it('ends with a newline', async () => {
      const text = await getPrometheusText()
      expect(text.endsWith('\n')).toBe(true)
    })

    it('contains HELP and TYPE for each metric', async () => {
      const text = await getPrometheusText()
      const helpCount = (text.match(/^# HELP /gm) || []).length
      const typeCount = (text.match(/^# TYPE /gm) || []).length
      expect(helpCount).toBe(6)
      expect(typeCount).toBe(6)
    })
  })
})
