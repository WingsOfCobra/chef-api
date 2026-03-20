import { execSync } from 'child_process'
import os from 'os'
import fs from 'fs'

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
  memory: {
    total: string
    free: string
    usedPercent: string
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

export function getHealth(): HealthInfo {
  const uptimeMs = Date.now() - startTime
  const uptimeSec = Math.floor(uptimeMs / 1000)
  const totalMem = os.totalmem()
  const freeMem = os.freemem()
  const usedPercent = (((totalMem - freeMem) / totalMem) * 100).toFixed(1)

  return {
    status: 'ok',
    uptime: uptimeSec,
    uptimeHuman: formatUptime(uptimeSec),
    hostname: os.hostname(),
    platform: `${os.platform()} ${os.arch()}`,
    nodeVersion: process.version,
    memory: {
      total: formatBytes(totalMem),
      free: formatBytes(freeMem),
      usedPercent: `${usedPercent}%`,
    },
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
