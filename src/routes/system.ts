import { FastifyPluginAsync } from 'fastify'
import * as system from '../services/system.service'

const systemRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /system/health — public, no auth required (handled in auth plugin)
  // Cached for 5s to reduce CPU sampling overhead
  fastify.get('/health', {
    schema: {
      tags: ['System'],
      summary: 'Get system health, memory, and uptime',
      description: 'Returns current system status including CPU usage, memory usage, network bytes, load averages, and uptime. This endpoint does not require authentication.',
      response: {
        200: {
          type: 'object',
          properties: {
            status: { type: 'string' },
            uptime: { type: 'number' },
            uptimeHuman: { type: 'string' },
            hostname: { type: 'string' },
            platform: { type: 'string' },
            nodeVersion: { type: 'string' },
            cpu: {
              type: 'object',
              properties: {
                usage_percent: { type: 'number' },
                cores: { type: 'number' },
                model: { type: 'string' },
              },
            },
            memory: {
              type: 'object',
              properties: {
                total: { type: 'string' },
                free: { type: 'string' },
                usedPercent: { type: 'string' },
              },
            },
            network: {
              type: 'object',
              properties: {
                rx_bytes: { type: 'number' },
                tx_bytes: { type: 'number' },
              },
            },
            loadAvg: { type: 'array', items: { type: 'number' } },
            timestamp: { type: 'string' },
          },
        },
      },
    },
  }, async () => {
    const cacheKey = 'system:health'
    const cached = fastify.cache.get(cacheKey)
    if (cached) return cached

    const health = await system.getHealth()
    fastify.cache.set(cacheKey, health, 5) // 5s TTL
    return health
  })

  // GET /system/disk
  // Cached for 10s - disk usage changes slowly
  fastify.get('/disk', {
    schema: {
      tags: ['System'],
      summary: 'Get disk usage per mount',
      description: 'Returns disk usage information for each mounted filesystem.',
      response: {
        200: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              filesystem: { type: 'string' },
              size: { type: 'string' },
              used: { type: 'string' },
              available: { type: 'string' },
              usePercent: { type: 'string' },
              mountpoint: { type: 'string' },
            },
          },
        },
      },
    },
  }, async () => {
    const cacheKey = 'system:disk'
    const cached = fastify.cache.get(cacheKey)
    if (cached) return cached

    const disk = system.getDiskUsage()
    fastify.cache.set(cacheKey, disk, 10) // 10s TTL
    return disk
  })

  // GET /system/memory — detailed memory breakdown from /proc/meminfo
  fastify.get('/memory', { schema: { tags: ['System'] } }, async () => {
    const cacheKey = 'system:memory'
    const cached = fastify.cache.get(cacheKey)
    if (cached) return cached

    const memory = system.getMemoryDetail()
    fastify.cache.set(cacheKey, memory, 5) // 5s TTL
    return memory
  })

  // GET /system/network — per-interface network stats with IPs
  fastify.get('/network', { schema: { tags: ['System'] } }, async () => {
    const cacheKey = 'system:network'
    const cached = fastify.cache.get(cacheKey)
    if (cached) return cached

    const interfaces = system.getNetworkInterfaces()
    fastify.cache.set(cacheKey, interfaces, 5) // 5s TTL
    return interfaces
  })

  // GET /system/processes
  // Cached for 3s - processes change frequently but don't need real-time
  fastify.get('/processes', {
    schema: {
      tags: ['System'],
      summary: 'Get top processes by CPU usage',
      description: 'Returns a list of top processes sorted by CPU usage. Accepts an optional "limit" query parameter (default 20).',
      querystring: {
        type: 'object',
        properties: {
          limit: { type: 'string' },
        },
      },
      response: {
        200: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              pid: { type: 'number' },
              user: { type: 'string' },
              cpuPercent: { type: 'string' },
              memPercent: { type: 'string' },
              command: { type: 'string' },
            },
          },
        },
      },
    },
  }, async (request) => {
    const query = request.query as { limit?: string }
    const limit = query.limit ? parseInt(query.limit, 10) : 20
    const cacheKey = `system:processes:${limit}`
    const cached = fastify.cache.get(cacheKey)
    if (cached) return cached

    const processes = system.getTopProcesses(limit)
    fastify.cache.set(cacheKey, processes, 3) // 3s TTL
    return processes
  })
}

export default systemRoutes
