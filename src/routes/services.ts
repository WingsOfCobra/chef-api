import { FastifyPluginAsync } from 'fastify'
import { config } from '../config'
import { runCommand } from '../services/ssh.service'
import { errorRing } from '../lib/error-ring'

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

/**
 * Parse systemctl's locale timestamp format: "Tue 2026-03-17 19:49:29 CET"
 * Strips the day-of-week prefix and timezone suffix, parses the ISO-like middle part.
 */
function parseSystemctlTimestamp(raw: string): Date | null {
  if (!raw || raw === '') return null

  // Strip day-of-week (first token) and timezone (last token) → "2026-03-17 19:49:29"
  const parts = raw.trim().split(/\s+/)
  if (parts.length < 3) return null

  // Format can be: "Mon 2026-03-17 19:49:29 CET" (4 parts) or just "2026-03-17 19:49:29" (2 parts)
  let datePart: string
  let timePart: string
  if (parts.length >= 4) {
    // day-of-week date time tz
    datePart = parts[1]
    timePart = parts[2]
  } else {
    datePart = parts[0]
    timePart = parts[1]
  }

  // Parse as UTC (close enough for uptime display; TZ offset is small vs day-level precision)
  const d = new Date(`${datePart}T${timePart}Z`)
  if (isNaN(d.getTime())) return null
  return d
}

function formatUptime(timestamp: string): string | null {
  if (!timestamp || timestamp === '') return null

  const date = parseSystemctlTimestamp(timestamp)
  if (!date) return null

  const diffMs = Date.now() - date.getTime()
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

// How long to wait for SSH before returning stale cache or empty
const SSH_TIMEOUT_MS = 6000
// Cache TTL — services don't change often, 30s is fine
const CACHE_TTL_S = 30

const servicesRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/status', {
    schema: {
      tags: ['Services'],
      summary: 'Get monitored service statuses',
      description: 'Returns the status of all monitored systemd services configured via MONITORED_SERVICES env var. Queries via SSH. Cached for 30s. Returns stale cache on timeout.',
      response: {
        200: {
          type: 'object',
          properties: {
            services: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  active: { type: 'boolean' },
                  status: { type: 'string' },
                  uptime: { type: ['string', 'null'] },
                  memory: { type: ['string', 'null'] },
                  pid: { type: ['number', 'null'] },
                },
              },
            },
            timestamp: { type: 'string' },
            stale: { type: 'boolean' },
          },
        },
      },
    },
  }, async (request) => {
    const cacheKey = 'services:status'
    const cached = fastify.cache.get(cacheKey)
    if (cached) return cached

    const serviceNames = config.monitoredServices
    const timestamp = new Date().toISOString()

    if (serviceNames.length === 0 || !config.servicesSSHHost) {
      return { services: [], timestamp, stale: false }
    }

    const fetchServices = async () => {
      const cmd = `systemctl show ${serviceNames.join(' ')} --property=ActiveState,SubState,MainPID,MemoryCurrent,ActiveEnterTimestamp --no-pager`
      const result = await runCommand(config.servicesSSHHost, cmd)
      if (result.code !== 0) return null
      return parseServiceBlocks(result.stdout, serviceNames)
    }

    try {
      const timeoutPromise = new Promise<null>((_, reject) =>
        setTimeout(() => reject(new Error('services SSH timeout')), SSH_TIMEOUT_MS)
      )

      const services = await Promise.race([fetchServices(), timeoutPromise])
      if (!services) return { services: [], timestamp, stale: false }

      const response = { services, timestamp, stale: false }
      fastify.cache.set(cacheKey, response, CACHE_TTL_S)
      return response
    } catch (err: any) {
      const message = err.message?.substring(0, 500) || 'Unknown error'
      fastify.log.error({ service: 'ssh', err: message }, 'SSH service status call failed')
      errorRing.add({
        timestamp: new Date().toISOString(),
        service: 'ssh',
        message: `Service status check failed: ${message}`,
      })
      // Return stale cache if available, otherwise return empty with stale flag
      const staleCache = fastify.cache.get(cacheKey)
      if (staleCache) {
        request.log.warn('Services SSH slow/timeout, returning stale cache')
        return staleCache
      }
      return { services: [], timestamp, stale: true }
    }
  })
}

export default servicesRoutes
