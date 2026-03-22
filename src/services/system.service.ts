import { execSync } from 'child_process'
import os from 'os'
import fs from 'fs'
import { readFileSync } from 'fs'
import { config } from '../config'
import { runCommand } from './ssh.service'

export interface DiskMount {
  filesystem: string
  size: string
  used: string
  available: string
  usePercent: string
  mountpoint: string
}

export interface ProcessInfo {
  pid: number
  user: string
  cpuPercent: string
  memPercent: string
  command: string
}

export interface HealthInfo {
  status: 'ok'
  uptime: number
  uptimeHuman: string
  hostname: string
  platform: string
  nodeVersion: string
  cpu: {
    usage_percent: number
    cores: number
    model: string
  }
  memory: {
    total: string
    free: string
    usedPercent: string
  }
  network: {
    rx_bytes: number
    tx_bytes: number
  }
  loadAvg: number[]
  timestamp: string
}

export interface MemoryDetail {
  total: number
  free: number
  available: number
  buffers: number
  cached: number
  swapTotal: number
  swapFree: number
  swapUsed: number
  usedPercent: number
  swapUsedPercent: number
}

export interface NetworkInterface {
  name: string
  rx_bytes: number
  tx_bytes: number
  rx_packets: number
  tx_packets: number
  ipv4: string | null
  ipv6: string | null
}

const startTime = Date.now()

function formatBytes(bytes: number): string {
  const gb = bytes / 1024 / 1024 / 1024
  if (gb >= 1) return `${gb.toFixed(2)} GB`
  const mb = bytes / 1024 / 1024
  return `${mb.toFixed(2)} MB`
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const parts = []
  if (days > 0) parts.push(`${days}d`)
  if (hours > 0) parts.push(`${hours}h`)
  parts.push(`${minutes}m`)
  return parts.join(' ')
}

function parseProcStat(): { idle: number; total: number } {
  try {
    const content = readFileSync('/proc/stat', 'utf-8')
    const firstLine = content.split('\n')[0]
    const fields = firstLine.replace(/^cpu\s+/, '').trim().split(/\s+/).map(Number)
    // fields: user nice system idle iowait irq softirq steal guest guest_nice
    const idle = (fields[3] ?? 0) + (fields[4] ?? 0) // idle + iowait
    const total = fields.reduce((sum, val) => sum + val, 0)
    return { idle, total }
  } catch {
    return { idle: 0, total: 0 }
  }
}

async function getCpuUsage(): Promise<number> {
  const first = parseProcStat()
  await new Promise((resolve) => setTimeout(resolve, 100))
  const second = parseProcStat()

  const idleDelta = second.idle - first.idle
  const totalDelta = second.total - first.total
  if (totalDelta === 0) return 0
  return Math.round(((totalDelta - idleDelta) / totalDelta) * 1000) / 10
}

function getNetworkBytes(): { rx_bytes: number; tx_bytes: number } {
  try {
    const content = readFileSync('/proc/net/dev', 'utf-8')
    const lines = content.trim().split('\n').slice(2) // skip header lines
    let rx = 0
    let tx = 0
    for (const line of lines) {
      const parts = line.trim().split(/\s+/)
      const iface = parts[0]?.replace(':', '')
      if (iface === 'lo') continue
      rx += parseInt(parts[1] ?? '0', 10)
      tx += parseInt(parts[9] ?? '0', 10)
    }
    return { rx_bytes: rx, tx_bytes: tx }
  } catch {
    return { rx_bytes: 0, tx_bytes: 0 }
  }
}

export async function getHealth(): Promise<HealthInfo> {
  const uptimeMs = Date.now() - startTime
  const uptimeSec = Math.floor(uptimeMs / 1000)
  const totalMem = os.totalmem()
  const freeMem = os.freemem()
  const usedPercent = (((totalMem - freeMem) / totalMem) * 100).toFixed(1)

  const cpus = os.cpus()
  const cpuUsage = await getCpuUsage()
  const network = getNetworkBytes()

  return {
    status: 'ok',
    uptime: uptimeSec,
    uptimeHuman: formatUptime(uptimeSec),
    hostname: os.hostname(),
    platform: `${os.platform()} ${os.arch()}`,
    nodeVersion: process.version,
    cpu: {
      usage_percent: cpuUsage,
      cores: cpus.length,
      model: cpus[0]?.model ?? 'unknown',
    },
    memory: {
      total: formatBytes(totalMem),
      free: formatBytes(freeMem),
      usedPercent: `${usedPercent}%`,
    },
    network,
    loadAvg: os.loadavg(),
    timestamp: new Date().toISOString(),
  }
}

export function getDiskUsage(): DiskMount[] {
  try {
    const output = execSync('df -h --output=source,size,used,avail,pcent,target', {
      encoding: 'utf-8',
    })

    const lines = output.trim().split('\n').slice(1)
    return lines
      .map((line) => {
        const parts = line.trim().split(/\s+/)
        return {
          filesystem: parts[0] ?? '',
          size: parts[1] ?? '',
          used: parts[2] ?? '',
          available: parts[3] ?? '',
          usePercent: parts[4] ?? '',
          mountpoint: parts[5] ?? '',
        }
      })
      .filter((m) => m.filesystem.startsWith('/') || m.filesystem.startsWith('tmpfs'))
  } catch {
    return []
  }
}

export function getMemoryDetail(): MemoryDetail {
  try {
    const content = readFileSync('/proc/meminfo', 'utf-8')
    const values: Record<string, number> = {}
    for (const line of content.split('\n')) {
      const match = line.match(/^(\w+):\s+(\d+)\s+kB/)
      if (match) {
        values[match[1]] = parseInt(match[2], 10) * 1024 // kB → bytes
      }
    }

    const total = values['MemTotal'] ?? 0
    const free = values['MemFree'] ?? 0
    const available = values['MemAvailable'] ?? 0
    const buffers = values['Buffers'] ?? 0
    const cached = values['Cached'] ?? 0
    const swapTotal = values['SwapTotal'] ?? 0
    const swapFree = values['SwapFree'] ?? 0
    const swapUsed = swapTotal - swapFree

    return {
      total,
      free,
      available,
      buffers,
      cached,
      swapTotal,
      swapFree,
      swapUsed,
      usedPercent: total > 0 ? Math.round(((total - available) / total) * 1000) / 10 : 0,
      swapUsedPercent: swapTotal > 0 ? Math.round((swapUsed / swapTotal) * 1000) / 10 : 0,
    }
  } catch {
    return { total: 0, free: 0, available: 0, buffers: 0, cached: 0, swapTotal: 0, swapFree: 0, swapUsed: 0, usedPercent: 0, swapUsedPercent: 0 }
  }
}

export function getNetworkInterfaces(): NetworkInterface[] {
  try {
    const content = readFileSync('/proc/net/dev', 'utf-8')
    const lines = content.trim().split('\n').slice(2) // skip header lines
    const osInterfaces = os.networkInterfaces()

    const result: NetworkInterface[] = []
    for (const line of lines) {
      const parts = line.trim().split(/\s+/)
      const name = parts[0]?.replace(':', '')
      if (!name || name === 'lo') continue

      const ifaceAddrs = osInterfaces[name] ?? []
      const ipv4 = ifaceAddrs.find((a) => a.family === 'IPv4')?.address ?? null
      const ipv6 = ifaceAddrs.find((a) => a.family === 'IPv6')?.address ?? null

      result.push({
        name,
        rx_bytes: parseInt(parts[1] ?? '0', 10),
        tx_bytes: parseInt(parts[9] ?? '0', 10),
        rx_packets: parseInt(parts[2] ?? '0', 10),
        tx_packets: parseInt(parts[10] ?? '0', 10),
        ipv4,
        ipv6,
      })
    }
    return result
  } catch {
    return []
  }
}

export function getTopProcesses(limit = 20): ProcessInfo[] {
  try {
    const output = execSync(
      `ps aux --sort=-%cpu | head -${limit + 1}`,
      { encoding: 'utf-8' }
    )

    const lines = output.trim().split('\n').slice(1) // skip header
    return lines.map((line) => {
      const parts = line.trim().split(/\s+/)
      return {
        pid: parseInt(parts[1] ?? '0', 10),
        user: parts[0] ?? '',
        cpuPercent: parts[2] ?? '0',
        memPercent: parts[3] ?? '0',
        command: parts.slice(10).join(' '),
      }
    })
  } catch {
    return []
  }
}

export interface ConnectionInfo {
  proto: string
  localAddr: string
  localPort: number
  remoteAddr: string
  remotePort: number
  state: string
  pid: number | null
  process: string | null
}

export interface BandwidthInfo {
  name: string
  rx_bytes_sec: number
  tx_bytes_sec: number
  rx_mbps: number
  tx_mbps: number
}

export interface LatencyInfo {
  host: string
  avg_ms: number | null
  min_ms: number | null
  max_ms: number | null
  loss_percent: number
  reachable: boolean
}

export async function getNetworkConnections(): Promise<ConnectionInfo[]> {
  try {
    const result = await runCommand(config.servicesSSHHost, 'ss -tunap')
    if (result.code !== 0 && result.code !== null) return []

    const lines = result.stdout.trim().split('\n').slice(1) // skip header
    return lines
      .map((line) => {
        const parts = line.trim().split(/\s+/)
        const proto = parts[0] ?? ''
        const localFull = parts[4] ?? ''
        const remoteFull = parts[5] ?? ''
        const state = parts[1] ?? ''

        const lastColonLocal = localFull.lastIndexOf(':')
        const localAddr = localFull.substring(0, lastColonLocal)
        const localPort = parseInt(localFull.substring(lastColonLocal + 1), 10)

        const lastColonRemote = remoteFull.lastIndexOf(':')
        const remoteAddr = remoteFull.substring(0, lastColonRemote)
        const remotePort = parseInt(remoteFull.substring(lastColonRemote + 1), 10)

        // Parse process info from users:(("name",pid=123,fd=4)) format
        const usersCol = parts.slice(6).join(' ')
        let pid: number | null = null
        let process: string | null = null
        const pidMatch = usersCol.match(/pid=(\d+)/)
        const procMatch = usersCol.match(/\(\("([^"]+)"/)
        if (pidMatch) pid = parseInt(pidMatch[1], 10)
        if (procMatch) process = procMatch[1]

        return { proto, localAddr, localPort, remoteAddr, remotePort, state, pid, process }
      })
      .filter((c) => c.proto === 'tcp' || c.proto === 'udp')
  } catch {
    return []
  }
}

function parseProcNetDev(): Record<string, { rx: number; tx: number }> {
  const content = readFileSync('/proc/net/dev', 'utf-8')
  const lines = content.trim().split('\n').slice(2)
  const result: Record<string, { rx: number; tx: number }> = {}
  for (const line of lines) {
    const parts = line.trim().split(/\s+/)
    const name = parts[0]?.replace(':', '')
    if (!name || name === 'lo') continue
    result[name] = {
      rx: parseInt(parts[1] ?? '0', 10),
      tx: parseInt(parts[9] ?? '0', 10),
    }
  }
  return result
}

export async function getNetworkBandwidth(): Promise<BandwidthInfo[]> {
  try {
    const first = parseProcNetDev()
    await new Promise((resolve) => setTimeout(resolve, 1000))
    const second = parseProcNetDev()

    const result: BandwidthInfo[] = []
    for (const name of Object.keys(second)) {
      const rx1 = first[name]?.rx ?? 0
      const tx1 = first[name]?.tx ?? 0
      const rx2 = second[name]?.rx ?? 0
      const tx2 = second[name]?.tx ?? 0
      const rx_bytes_sec = rx2 - rx1
      const tx_bytes_sec = tx2 - tx1
      result.push({
        name,
        rx_bytes_sec,
        tx_bytes_sec,
        rx_mbps: Math.round((rx_bytes_sec * 8) / 1_000_000 * 100) / 100,
        tx_mbps: Math.round((tx_bytes_sec * 8) / 1_000_000 * 100) / 100,
      })
    }
    return result
  } catch {
    return []
  }
}

export async function getNetworkLatency(hosts: string[]): Promise<LatencyInfo[]> {
  try {
    const results = await Promise.all(
      hosts.map(async (host): Promise<LatencyInfo> => {
        try {
          const result = await runCommand(
            config.servicesSSHHost,
            `ping -c 3 -W 2 ${host}`
          )

          const output = result.stdout
          // Parse "3 packets transmitted, 3 received, 0% packet loss"
          const lossMatch = output.match(/(\d+(?:\.\d+)?)% packet loss/)
          const loss_percent = lossMatch ? parseFloat(lossMatch[1]) : 100

          // Parse "rtt min/avg/max/mdev = 1.234/2.345/3.456/0.567 ms"
          const rttMatch = output.match(/rtt min\/avg\/max\/mdev = ([\d.]+)\/([\d.]+)\/([\d.]+)/)
          if (rttMatch) {
            return {
              host,
              min_ms: parseFloat(rttMatch[1]),
              avg_ms: parseFloat(rttMatch[2]),
              max_ms: parseFloat(rttMatch[3]),
              loss_percent,
              reachable: loss_percent < 100,
            }
          }

          return { host, avg_ms: null, min_ms: null, max_ms: null, loss_percent, reachable: false }
        } catch {
          return { host, avg_ms: null, min_ms: null, max_ms: null, loss_percent: 100, reachable: false }
        }
      })
    )
    return results
  } catch {
    return []
  }
}
