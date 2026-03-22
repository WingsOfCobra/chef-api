import { db, FleetServer, JobHistory } from '../db'
import * as sshService from './ssh.service'

export interface ServerStatusInfo {
  hostname: string
  os: string
  uptime: string
  load: string
  memory: {
    total: number
    used: number
    free: number
    usedPercent: number
  }
  disk: Array<{
    source: string
    size: string
    used: string
    avail: string
    percent: string
    target: string
  }>
}

export interface FleetStatusResult {
  name: string
  status: 'online' | 'offline' | 'error'
  info?: ServerStatusInfo
  error?: string
  responseTimeMs: number
}

export interface FleetRunResult {
  server: string
  stdout: string
  stderr: string
  code: number | null
  error?: string
}

const STATUS_COMMAND = [
  'echo "---HOSTNAME---"',
  'hostname',
  'echo "---OS---"',
  'uname -a',
  'echo "---UPTIME---"',
  'uptime',
  'echo "---MEMORY---"',
  'free -b | head -2',
  'echo "---DISK---"',
  'df -h --output=source,size,used,avail,pcent,target | grep "^/"',
  'echo "---LOAD---"',
  'cat /proc/loadavg',
].join('; ')

export function parseStatusOutput(output: string): ServerStatusInfo {
  const sections: Record<string, string> = {}
  const markers = ['HOSTNAME', 'OS', 'UPTIME', 'MEMORY', 'DISK', 'LOAD']

  for (const marker of markers) {
    const startTag = `---${marker}---`
    const startIdx = output.indexOf(startTag)
    if (startIdx === -1) continue

    const contentStart = startIdx + startTag.length
    // Find next marker or end of string
    let endIdx = output.length
    for (const nextMarker of markers) {
      if (nextMarker === marker) continue
      const nextIdx = output.indexOf(`---${nextMarker}---`, contentStart)
      if (nextIdx !== -1 && nextIdx < endIdx) {
        endIdx = nextIdx
      }
    }
    sections[marker] = output.substring(contentStart, endIdx).trim()
  }

  // Parse memory from free -b output
  const memLines = (sections.MEMORY || '').split('\n')
  const memDataLine = memLines.find((l) => l.trim().startsWith('Mem:'))
  let memory = { total: 0, used: 0, free: 0, usedPercent: 0 }
  if (memDataLine) {
    const parts = memDataLine.trim().split(/\s+/)
    const total = parseInt(parts[1], 10) || 0
    const used = parseInt(parts[2], 10) || 0
    const free = parseInt(parts[3], 10) || 0
    memory = {
      total,
      used,
      free,
      usedPercent: total > 0 ? Math.round((used / total) * 100 * 10) / 10 : 0,
    }
  }

  // Parse disk
  const diskLines = (sections.DISK || '').split('\n').filter((l) => l.trim())
  const disk = diskLines.map((line) => {
    const parts = line.trim().split(/\s+/)
    return {
      source: parts[0] || '',
      size: parts[1] || '',
      used: parts[2] || '',
      avail: parts[3] || '',
      percent: parts[4] || '',
      target: parts[5] || '',
    }
  })

  return {
    hostname: sections.HOSTNAME || '',
    os: sections.OS || '',
    uptime: sections.UPTIME || '',
    load: sections.LOAD || '',
    memory,
    disk,
  }
}

export function listServers(): FleetServer[] {
  const stmt = db.prepare('SELECT * FROM fleet_servers ORDER BY name')
  return stmt.all() as FleetServer[]
}

export function getServer(name: string): FleetServer | undefined {
  const stmt = db.prepare('SELECT * FROM fleet_servers WHERE name = ?')
  return stmt.get(name) as FleetServer | undefined
}

export function addServer(data: {
  name: string
  ssh_host: string
  tags?: string[]
}): FleetServer {
  // Validate SSH host exists in config
  const host = sshService.getHost(data.ssh_host)
  if (!host) {
    throw new Error(`SSH host "${data.ssh_host}" is not configured in SSH_HOSTS`)
  }

  // Check if server already exists
  const existing = getServer(data.name)
  if (existing) {
    throw new Error(`Server "${data.name}" already exists in fleet`)
  }

  const tags = data.tags ? JSON.stringify(data.tags) : null

  const stmt = db.prepare(
    `INSERT INTO fleet_servers (name, host, user, ssh_host, tags, status)
     VALUES (?, ?, ?, ?, ?, 'unknown')`
  )
  stmt.run(data.name, host.host, host.user, data.ssh_host, tags)

  return getServer(data.name)!
}

export function removeServer(name: string): boolean {
  const stmt = db.prepare('DELETE FROM fleet_servers WHERE name = ?')
  const result = stmt.run(name)
  return result.changes > 0
}

export async function getServerStatus(name: string): Promise<FleetStatusResult> {
  const server = getServer(name)
  if (!server) {
    throw new Error(`Server "${name}" not found in fleet`)
  }

  const start = Date.now()
  try {
    const result = await sshService.runCommand(server.ssh_host, STATUS_COMMAND)
    const responseTimeMs = Date.now() - start

    if (result.code !== 0 && !result.stdout) {
      // Update status
      db.prepare('UPDATE fleet_servers SET status = ?, last_seen = datetime(\'now\') WHERE name = ?')
        .run('error', name)

      return {
        name,
        status: 'error',
        error: result.stderr || 'Command failed',
        responseTimeMs,
      }
    }

    const info = parseStatusOutput(result.stdout)

    // Update server record
    db.prepare(
      `UPDATE fleet_servers SET status = 'online', last_seen = datetime('now'), os_info = ? WHERE name = ?`
    ).run(info.os, name)

    return {
      name,
      status: 'online',
      info,
      responseTimeMs,
    }
  } catch (err) {
    const responseTimeMs = Date.now() - start

    db.prepare('UPDATE fleet_servers SET status = \'offline\', last_seen = datetime(\'now\') WHERE name = ?')
      .run(name)

    return {
      name,
      status: 'offline',
      error: err instanceof Error ? err.message : String(err),
      responseTimeMs,
    }
  }
}

export async function getFleetStatus(): Promise<FleetStatusResult[]> {
  const servers = listServers()
  if (servers.length === 0) return []

  const results = await Promise.allSettled(
    servers.map((s) => getServerStatus(s.name))
  )

  return results.map((r, i) => {
    if (r.status === 'fulfilled') return r.value
    return {
      name: servers[i].name,
      status: 'offline' as const,
      error: r.reason?.message || 'Unknown error',
      responseTimeMs: 0,
    }
  })
}

export async function runOnServers(
  command: string,
  serverNames?: string[]
): Promise<FleetRunResult[]> {
  const allServers = listServers()
  const targets = serverNames
    ? allServers.filter((s) => serverNames.includes(s.name))
    : allServers

  if (targets.length === 0) {
    throw new Error('No matching servers found')
  }

  const results = await Promise.allSettled(
    targets.map(async (server) => {
      const result = await sshService.runCommand(server.ssh_host, command)
      return {
        server: server.name,
        stdout: result.stdout,
        stderr: result.stderr,
        code: result.code,
      }
    })
  )

  const fleetResults: FleetRunResult[] = results.map((r, i) => {
    if (r.status === 'fulfilled') return r.value
    return {
      server: targets[i].name,
      stdout: '',
      stderr: '',
      code: null,
      error: r.reason?.message || 'Unknown error',
    }
  })

  // Log to job_history
  for (const result of fleetResults) {
    db.prepare(
      `INSERT INTO job_history (type, target, command, status, output) VALUES (?, ?, ?, ?, ?)`
    ).run(
      'fleet_run',
      result.server,
      command,
      result.error ? 'error' : result.code === 0 ? 'success' : 'failed',
      result.error || result.stdout || result.stderr
    )
  }

  return fleetResults
}
