import { FastifyPluginAsync } from 'fastify'
import { config } from '../config'
import { runCommand } from '../services/ssh.service'

interface ServiceStatus {
  name: string
  active: boolean
  status: string
  uptime: string | null
  memory: string | null
  pid: number | null
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
}

function formatUptime(timestamp: string): string | null {
  if (!timestamp || timestamp === '') return null
  const date = new Date(timestamp)
  if (isNaN(date.getTime())) return null
  const now = Date.now()
  const diffMs = now - date.getTime()
  if (diffMs < 0) return null
  const seconds = Math.floor(diffMs / 1000)
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const parts: string[] = []
  if (days > 0) parts.push(`${days}d`)
  if (hours > 0) parts.push(`${hours}h`)
  if (parts.length === 0 || minutes > 0) parts.push(`${minutes}m`)
  return parts.join(' ')
}

function parseServiceBlocks(output: string, serviceNames: string[]): ServiceStatus[] {
  const blocks = output.trim().split('\n\n')
  return blocks.map((block, idx) => {
    const props: Record<string, string> = {}
    for (const line of block.split('\n')) {
      const eqIdx = line.indexOf('=')
      if (eqIdx >= 0) {
        props[line.substring(0, eqIdx)] = line.substring(eqIdx + 1)
      }
    }
    const activeState = props['ActiveState'] ?? 'unknown'
    const subState = props['SubState'] ?? 'unknown'
    const mainPid = parseInt(props['MainPID'] ?? '0', 10)
    const memoryCurrent = parseInt(props['MemoryCurrent'] ?? '0', 10)
    const activeEnter = props['ActiveEnterTimestamp'] ?? ''

    return {
      name: serviceNames[idx] ?? 'unknown',
      active: activeState === 'active',
      status: `${activeState} (${subState})`,
      uptime: activeState === 'active' ? formatUptime(activeEnter) : null,
      memory: memoryCurrent > 0 && !isNaN(memoryCurrent) ? formatBytes(memoryCurrent) : null,
      pid: mainPid > 0 ? mainPid : null,
    }
  })
}

const servicesRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /services/status
  fastify.get('/status', { schema: { tags: ['Services'] } }, async () => {
    const serviceNames = config.monitoredServices
    const timestamp = new Date().toISOString()

    if (serviceNames.length === 0 || !config.servicesSSHHost) {
      return { services: [], timestamp }
    }

    try {
      const cmd = `systemctl show ${serviceNames.join(' ')} --property=ActiveState,SubState,MainPID,MemoryCurrent,ActiveEnterTimestamp --no-pager`
      const result = await runCommand(config.servicesSSHHost, cmd)

      if (result.code !== 0) {
        return { services: [], timestamp }
      }

      const services = parseServiceBlocks(result.stdout, serviceNames)
      return { services, timestamp }
    } catch {
      return { services: [], timestamp }
    }
  })
}

export default servicesRoutes
