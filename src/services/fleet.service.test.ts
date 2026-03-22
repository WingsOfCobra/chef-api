import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('./ssh.service', () => ({
  getHost: vi.fn((name: string) => {
    if (name === 'dev') {
      return { name: 'dev', user: 'deploy', host: '10.0.0.1', privateKeyPath: '~/.ssh/id_rsa' }
    }
    return undefined
  }),
  runCommand: vi.fn(),
  listHosts: vi.fn(() => [{ name: 'dev', user: 'deploy', host: '10.0.0.1' }]),
}))

import * as fleetService from './fleet.service'
import * as sshService from './ssh.service'
import { db } from '../db'

const SAMPLE_STATUS_OUTPUT = [
  '---HOSTNAME---',
  'web-server-1',
  '---OS---',
  'Linux web-server-1 5.15.0 #1 SMP x86_64 GNU/Linux',
  '---UPTIME---',
  ' 14:30:00 up 30 days, 5:22, 2 users, load average: 0.15, 0.10, 0.05',
  '---MEMORY---',
  '              total        used        free      shared  buff/cache   available',
  'Mem:     8589934592  4294967296  2147483648   134217728  2147483648  4026531840',
  '---DISK---',
  '/dev/sda1       50G   20G   28G  42% /',
  '/dev/sdb1      100G   60G   35G  63% /data',
  '---LOAD---',
  '0.15 0.10 0.05 1/234 5678',
].join('\n')

describe('fleet.service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Clean fleet_servers table between tests
    db.exec('DELETE FROM fleet_servers')
  })

  describe('parseStatusOutput', () => {
    it('parses all sections from SSH output', () => {
      const info = fleetService.parseStatusOutput(SAMPLE_STATUS_OUTPUT)

      expect(info.hostname).toBe('web-server-1')
      expect(info.os).toContain('Linux')
      expect(info.uptime).toContain('up 30 days')
      expect(info.load).toContain('0.15')

      expect(info.memory.total).toBe(8589934592)
      expect(info.memory.used).toBe(4294967296)
      expect(info.memory.free).toBe(2147483648)
      expect(info.memory.usedPercent).toBe(50)

      expect(info.disk).toHaveLength(2)
      expect(info.disk[0].source).toBe('/dev/sda1')
      expect(info.disk[0].percent).toBe('42%')
      expect(info.disk[1].target).toBe('/data')
    })

    it('handles missing sections gracefully', () => {
      const info = fleetService.parseStatusOutput('---HOSTNAME---\ntest-host')

      expect(info.hostname).toBe('test-host')
      expect(info.os).toBe('')
      expect(info.memory.total).toBe(0)
      expect(info.disk).toHaveLength(0)
    })

    it('handles empty output', () => {
      const info = fleetService.parseStatusOutput('')

      expect(info.hostname).toBe('')
      expect(info.os).toBe('')
      expect(info.memory.total).toBe(0)
    })
  })

  describe('addServer', () => {
    it('adds a server that references a configured SSH host', () => {
      const server = fleetService.addServer({ name: 'web1', ssh_host: 'dev' })

      expect(server.name).toBe('web1')
      expect(server.host).toBe('10.0.0.1')
      expect(server.user).toBe('deploy')
      expect(server.ssh_host).toBe('dev')
      expect(server.status).toBe('unknown')
    })

    it('stores tags as JSON', () => {
      const server = fleetService.addServer({ name: 'web1', ssh_host: 'dev', tags: ['web', 'prod'] })

      expect(server.tags).toBe(JSON.stringify(['web', 'prod']))
    })

    it('throws when SSH host is not configured', () => {
      expect(() => fleetService.addServer({ name: 'web1', ssh_host: 'nonexistent' }))
        .toThrow('not configured')
    })

    it('throws when server name already exists', () => {
      fleetService.addServer({ name: 'web1', ssh_host: 'dev' })

      expect(() => fleetService.addServer({ name: 'web1', ssh_host: 'dev' }))
        .toThrow('already exists')
    })
  })

  describe('removeServer', () => {
    it('removes an existing server and returns true', () => {
      fleetService.addServer({ name: 'web1', ssh_host: 'dev' })

      expect(fleetService.removeServer('web1')).toBe(true)
      expect(fleetService.listServers()).toHaveLength(0)
    })

    it('returns false for non-existent server', () => {
      expect(fleetService.removeServer('nonexistent')).toBe(false)
    })
  })

  describe('listServers', () => {
    it('returns empty array when no servers added', () => {
      expect(fleetService.listServers()).toEqual([])
    })

    it('returns all added servers', () => {
      fleetService.addServer({ name: 'web1', ssh_host: 'dev' })

      const servers = fleetService.listServers()
      expect(servers).toHaveLength(1)
      expect(servers[0].name).toBe('web1')
    })
  })

  describe('getServerStatus', () => {
    it('returns online status with parsed info on success', async () => {
      fleetService.addServer({ name: 'web1', ssh_host: 'dev' })

      vi.mocked(sshService.runCommand).mockResolvedValue({
        stdout: SAMPLE_STATUS_OUTPUT,
        stderr: '',
        code: 0,
      })

      const result = await fleetService.getServerStatus('web1')

      expect(result.status).toBe('online')
      expect(result.name).toBe('web1')
      expect(result.info).toBeDefined()
      expect(result.info!.hostname).toBe('web-server-1')
      expect(result.responseTimeMs).toBeGreaterThanOrEqual(0)

      // Verify DB was updated
      const server = fleetService.getServer('web1')
      expect(server!.status).toBe('online')
      expect(server!.last_seen).toBeDefined()
    })

    it('returns offline status when SSH fails', async () => {
      fleetService.addServer({ name: 'web1', ssh_host: 'dev' })

      vi.mocked(sshService.runCommand).mockRejectedValue(new Error('Connection refused'))

      const result = await fleetService.getServerStatus('web1')

      expect(result.status).toBe('offline')
      expect(result.error).toContain('Connection refused')

      const server = fleetService.getServer('web1')
      expect(server!.status).toBe('offline')
    })

    it('throws for unknown server', async () => {
      await expect(fleetService.getServerStatus('nonexistent')).rejects.toThrow('not found')
    })
  })

  describe('getFleetStatus', () => {
    it('returns empty array when no servers', async () => {
      const results = await fleetService.getFleetStatus()
      expect(results).toEqual([])
    })

    it('returns status for all servers in parallel', async () => {
      fleetService.addServer({ name: 'web1', ssh_host: 'dev' })

      vi.mocked(sshService.runCommand).mockResolvedValue({
        stdout: SAMPLE_STATUS_OUTPUT,
        stderr: '',
        code: 0,
      })

      const results = await fleetService.getFleetStatus()

      expect(results).toHaveLength(1)
      expect(results[0].status).toBe('online')
    })
  })

  describe('runOnServers', () => {
    it('runs command on all servers and logs to job_history', async () => {
      fleetService.addServer({ name: 'web1', ssh_host: 'dev' })

      vi.mocked(sshService.runCommand).mockResolvedValue({
        stdout: 'hello',
        stderr: '',
        code: 0,
      })

      const results = await fleetService.runOnServers('echo hello')

      expect(results).toHaveLength(1)
      expect(results[0].server).toBe('web1')
      expect(results[0].stdout).toBe('hello')
      expect(results[0].code).toBe(0)

      // Check job_history
      const history = db.prepare(
        "SELECT * FROM job_history WHERE type = 'fleet_run' ORDER BY id DESC LIMIT 1"
      ).get() as { type: string; target: string; command: string; status: string }
      expect(history.target).toBe('web1')
      expect(history.command).toBe('echo hello')
      expect(history.status).toBe('success')
    })

    it('runs command on selected servers only', async () => {
      fleetService.addServer({ name: 'web1', ssh_host: 'dev' })

      vi.mocked(sshService.runCommand).mockResolvedValue({
        stdout: 'ok',
        stderr: '',
        code: 0,
      })

      const results = await fleetService.runOnServers('uptime', ['web1'])

      expect(results).toHaveLength(1)
      expect(results[0].server).toBe('web1')
    })

    it('throws when no matching servers found', async () => {
      await expect(fleetService.runOnServers('ls', ['nonexistent'])).rejects.toThrow(
        'No matching servers'
      )
    })

    it('handles SSH failures gracefully per server', async () => {
      fleetService.addServer({ name: 'web1', ssh_host: 'dev' })

      vi.mocked(sshService.runCommand).mockRejectedValue(new Error('timeout'))

      const results = await fleetService.runOnServers('uptime')

      expect(results).toHaveLength(1)
      expect(results[0].error).toContain('timeout')
      expect(results[0].code).toBeNull()

      // Check job_history logged the error
      const history = db.prepare(
        "SELECT * FROM job_history WHERE type = 'fleet_run' ORDER BY id DESC LIMIT 1"
      ).get() as { status: string }
      expect(history.status).toBe('error')
    })
  })
})
