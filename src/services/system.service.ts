import { execSync } from 'child_process'
import os from 'os'
import fs from 'fs'
import { readFileSync } from 'fs'

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
