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
    cpus: vi.fn(() => [
      { model: 'Test CPU', speed: 3000 },
      { model: 'Test CPU', speed: 3000 },
    ]),
    networkInterfaces: vi.fn(() => ({
      eth0: [
        { family: 'IPv4', address: '192.168.1.100', internal: false },
        { family: 'IPv6', address: 'fe80::1', internal: false },
      ],
      wlan0: [
        { family: 'IPv4', address: '10.0.0.5', internal: false },
      ],
    })),
  },
}))

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>()
  return {
    ...actual,
    default: {
      ...actual,
      existsSync: actual.existsSync,
      readFileSync: actual.readFileSync,
      mkdirSync: actual.mkdirSync,
    },
    readFileSync: vi.fn((path: string, encoding?: string) => {
      if (path === '/proc/stat') {
        return 'cpu  1000 200 300 5000 100 50 30 20 0 0\n'
      }
      if (path === '/proc/net/dev') {
        return `Inter-|   Receive                                                |  Transmit
 face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed
    lo: 1000 10 0 0 0 0 0 0 1000 10 0 0 0 0 0 0
  eth0: 5000 50 0 0 0 0 0 0 3000 30 0 0 0 0 0 0
 wlan0: 2000 20 0 0 0 0 0 0 1500 15 0 0 0 0 0 0
`
      }
      if (path === '/proc/meminfo') {
        return `MemTotal:       16384000 kB
MemFree:         4096000 kB
MemAvailable:    8192000 kB
Buffers:          512000 kB
Cached:          2048000 kB
SwapTotal:       4096000 kB
SwapFree:        3072000 kB
`
      }
      return actual.readFileSync(path, encoding as BufferEncoding)
    }),
  }
})

import { getHealth, getDiskUsage, getTopProcesses, getMemoryDetail, getNetworkInterfaces } from './system.service'
import { readFileSync } from 'fs'

const mockReadFileSync = vi.mocked(readFileSync)

const mockExecSync = vi.mocked(execSync)

describe('system.service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('getHealth', () => {
    it('returns health info with correct structure', async () => {
      const health = await getHealth()

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
      // New fields
      expect(health.cpu).toBeDefined()
      expect(health.cpu.cores).toBe(2)
      expect(health.cpu.model).toBe('Test CPU')
      expect(typeof health.cpu.usage_percent).toBe('number')
      expect(health.network).toBeDefined()
      expect(typeof health.network.rx_bytes).toBe('number')
      expect(typeof health.network.tx_bytes).toBe('number')
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

  describe('getMemoryDetail', () => {
    it('parses /proc/meminfo correctly', () => {
      const mem = getMemoryDetail()

      expect(mem.total).toBe(16384000 * 1024)
      expect(mem.free).toBe(4096000 * 1024)
      expect(mem.available).toBe(8192000 * 1024)
      expect(mem.buffers).toBe(512000 * 1024)
      expect(mem.cached).toBe(2048000 * 1024)
      expect(mem.swapTotal).toBe(4096000 * 1024)
      expect(mem.swapFree).toBe(3072000 * 1024)
      expect(mem.swapUsed).toBe((4096000 - 3072000) * 1024)
    })

    it('calculates usedPercent from total and available', () => {
      const mem = getMemoryDetail()
      // (total - available) / total * 100 = (16384000 - 8192000) / 16384000 * 100 = 50%
      expect(mem.usedPercent).toBe(50)
    })

    it('calculates swapUsedPercent correctly', () => {
      const mem = getMemoryDetail()
      // (4096000 - 3072000) / 4096000 * 100 = 25%
      expect(mem.swapUsedPercent).toBe(25)
    })

    it('handles missing swap lines gracefully', () => {
      mockReadFileSync.mockImplementation((path: string) => {
        if (path === '/proc/meminfo') {
          return `MemTotal:       16384000 kB
MemFree:         4096000 kB
MemAvailable:    8192000 kB
Buffers:          512000 kB
Cached:          2048000 kB
`
        }
        // Re-delegate other paths to avoid breaking other tests
        if (path === '/proc/stat') return 'cpu  1000 200 300 5000 100 50 30 20 0 0\n'
        if (path === '/proc/net/dev') return 'Inter-|\n face |\n'
        return ''
      })

      const mem = getMemoryDetail()
      expect(mem.swapTotal).toBe(0)
      expect(mem.swapFree).toBe(0)
      expect(mem.swapUsed).toBe(0)
      expect(mem.swapUsedPercent).toBe(0)
    })

    it('returns zeroed object on read error', () => {
      mockReadFileSync.mockImplementation((path: string) => {
        if (path === '/proc/meminfo') throw new Error('no such file')
        if (path === '/proc/stat') return 'cpu  1000 200 300 5000 100 50 30 20 0 0\n'
        if (path === '/proc/net/dev') return 'Inter-|\n face |\n'
        return ''
      })

      const mem = getMemoryDetail()
      expect(mem.total).toBe(0)
      expect(mem.free).toBe(0)
      expect(mem.usedPercent).toBe(0)
    })
  })

  describe('getNetworkInterfaces', () => {
    const procNetDev = `Inter-|   Receive                                                |  Transmit
 face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed
    lo: 1000 10 0 0 0 0 0 0 1000 10 0 0 0 0 0 0
  eth0: 5000 50 0 0 0 0 0 0 3000 30 0 0 0 0 0 0
 wlan0: 2000 20 0 0 0 0 0 0 1500 15 0 0 0 0 0 0
`

    beforeEach(() => {
      // Restore default mock behavior for readFileSync since prior tests may have overridden it
      mockReadFileSync.mockImplementation((path: string) => {
        if (path === '/proc/stat') return 'cpu  1000 200 300 5000 100 50 30 20 0 0\n'
        if (path === '/proc/net/dev') return procNetDev
        if (path === '/proc/meminfo') return `MemTotal: 16384000 kB\nMemFree: 4096000 kB\nMemAvailable: 8192000 kB\nBuffers: 512000 kB\nCached: 2048000 kB\nSwapTotal: 4096000 kB\nSwapFree: 3072000 kB\n`
        return ''
      })
    })

    it('parses per-interface stats from /proc/net/dev', () => {
      const ifaces = getNetworkInterfaces()

      expect(ifaces).toHaveLength(2) // eth0 + wlan0, lo excluded
      const eth0 = ifaces.find((i) => i.name === 'eth0')!
      expect(eth0.rx_bytes).toBe(5000)
      expect(eth0.tx_bytes).toBe(3000)
      expect(eth0.rx_packets).toBe(50)
      expect(eth0.tx_packets).toBe(30)
    })

    it('excludes loopback interface', () => {
      const ifaces = getNetworkInterfaces()
      expect(ifaces.find((i) => i.name === 'lo')).toBeUndefined()
    })

    it('attaches IP addresses from os.networkInterfaces()', () => {
      const ifaces = getNetworkInterfaces()

      const eth0 = ifaces.find((i) => i.name === 'eth0')!
      expect(eth0.ipv4).toBe('192.168.1.100')
      expect(eth0.ipv6).toBe('fe80::1')

      const wlan0 = ifaces.find((i) => i.name === 'wlan0')!
      expect(wlan0.ipv4).toBe('10.0.0.5')
      expect(wlan0.ipv6).toBeNull() // no IPv6 configured for wlan0
    })

    it('handles interface with no IP info', async () => {
      // wlan0 has /proc/net/dev entry but os.networkInterfaces() may not list it
      const osModule = (await import('os')).default
      vi.mocked(osModule.networkInterfaces).mockReturnValueOnce({
        eth0: [{ family: 'IPv4', address: '192.168.1.100', internal: false } as any],
      })

      const ifaces = getNetworkInterfaces()
      const wlan0 = ifaces.find((i) => i.name === 'wlan0')!
      expect(wlan0.ipv4).toBeNull()
      expect(wlan0.ipv6).toBeNull()
      expect(wlan0.rx_bytes).toBe(2000) // bytes still parsed from /proc/net/dev
    })

    it('returns empty array on read error', () => {
      mockReadFileSync.mockImplementation((path: string) => {
        if (path === '/proc/net/dev') throw new Error('no such file')
        if (path === '/proc/stat') return 'cpu  1000 200 300 5000 100 50 30 20 0 0\n'
        if (path === '/proc/meminfo') return ''
        return ''
      })

      const ifaces = getNetworkInterfaces()
      expect(ifaces).toEqual([])
    })
  })
})
