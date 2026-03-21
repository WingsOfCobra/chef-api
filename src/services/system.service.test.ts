import { vi, describe, it, expect, beforeEach } from 'vitest'
import { execSync } from 'child_process'
import os from 'os'

vi.mock('child_process', () => ({
  execSync: vi.fn(),
}))

vi.mock('os', () => ({
  default: {
    totalmem: vi.fn(() => 16 * 1024 * 1024 * 1024),
    freemem: vi.fn(() => 8 * 1024 * 1024 * 1024),
    hostname: vi.fn(() => 'test-host'),
    platform: vi.fn(() => 'linux'),
    arch: vi.fn(() => 'x64'),
    loadavg: vi.fn(() => [1.0, 0.8, 0.5]),
    homedir: vi.fn(() => '/home/test'),
  },
}))

import { getHealth, getDiskUsage, getTopProcesses } from './system.service'

const mockExecSync = vi.mocked(execSync)

describe('system.service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('getHealth', () => {
    it('returns health info with correct structure', () => {
      const health = getHealth()

      expect(health.status).toBe('ok')
      expect(health.hostname).toBe('test-host')
      expect(health.platform).toBe('linux x64')
      expect(health.nodeVersion).toBe(process.version)
      expect(health.loadAvg).toEqual([1.0, 0.8, 0.5])
      expect(health.memory.total).toBe('16.00 GB')
      expect(health.memory.free).toBe('8.00 GB')
      expect(health.memory.usedPercent).toBe('50.0%')
      expect(health.timestamp).toBeDefined()
      expect(typeof health.uptime).toBe('number')
      expect(typeof health.uptimeHuman).toBe('string')
    })
  })

  describe('getDiskUsage', () => {
    it('parses df output correctly', () => {
      mockExecSync.mockReturnValue(
        `Filesystem      Size  Used Avail Use% Mounted on
/dev/sda1        50G   20G   28G  42% /
tmpfs           7.8G  1.2M  7.8G   1% /dev/shm
overlay          50G   20G   28G  42% /var/lib/docker`
      )

      const disks = getDiskUsage()

      expect(disks).toHaveLength(2)
      expect(disks[0]).toEqual({
        filesystem: '/dev/sda1',
        size: '50G',
        used: '20G',
        available: '28G',
        usePercent: '42%',
        mountpoint: '/',
      })
      expect(disks[1]).toEqual({
        filesystem: 'tmpfs',
        size: '7.8G',
        used: '1.2M',
        available: '7.8G',
        usePercent: '1%',
        mountpoint: '/dev/shm',
      })
    })

    it('filters out non-device and non-tmpfs filesystems', () => {
      mockExecSync.mockReturnValue(
        `Filesystem      Size  Used Avail Use% Mounted on
/dev/sda1        50G   20G   28G  42% /
none             50G   20G   28G  42% /dev`
      )

      const disks = getDiskUsage()
      expect(disks).toHaveLength(1)
      expect(disks[0].filesystem).toBe('/dev/sda1')
    })

    it('returns empty array on error', () => {
      mockExecSync.mockImplementation(() => {
        throw new Error('command failed')
      })

      const disks = getDiskUsage()
      expect(disks).toEqual([])
    })
  })

  describe('getTopProcesses', () => {
    it('parses ps output correctly', () => {
      mockExecSync.mockReturnValue(
        `USER         PID %CPU %MEM    VSZ   RSS TTY      STAT START   TIME COMMAND
root           1  2.5  0.1 169364 11664 ?        Ss   Mar18   0:05 /sbin/init
www-data     123  1.2  0.3 525632 52124 ?        Sl   Mar18   0:10 nginx: worker process`
      )

      const procs = getTopProcesses(2)

      expect(procs).toHaveLength(2)
      expect(procs[0]).toEqual({
        pid: 1,
        user: 'root',
        cpuPercent: '2.5',
        memPercent: '0.1',
        command: '/sbin/init',
      })
      expect(procs[1].command).toBe('nginx: worker process')
    })

    it('passes limit to ps command', () => {
      mockExecSync.mockReturnValue('USER PID %CPU %MEM VSZ RSS TTY STAT START TIME COMMAND\n')

      getTopProcesses(5)
      expect(mockExecSync).toHaveBeenCalledWith(
        'ps aux --sort=-%cpu | head -6',
        { encoding: 'utf-8' }
      )
    })

    it('returns empty array on error', () => {
      mockExecSync.mockImplementation(() => {
        throw new Error('command failed')
      })

      const procs = getTopProcesses()
      expect(procs).toEqual([])
    })
  })
})
