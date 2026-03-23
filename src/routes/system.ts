import { FastifyPluginAsync } from 'fastify'
import * as system from '../services/system.service'
import { errorRing } from '../lib/error-ring'

const systemRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /system/health — public, no auth required (handled in auth plugin)
  // Cached for 5s to reduce CPU sampling overhead
  fastify.get('/health', {
    schema: {
      tags: ['System'],
      summary: 'Get system health, memory, and uptime',
      description: 'Returns current system status including CPU usage, memory usage, network bytes, load averages, uptime, and recent errors. This endpoint does not require authentication.',
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
            recentErrors: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  timestamp: { type: 'string' },
                  service: { type: 'string' },
                  message: { type: 'string' },
                  statusCode: { type: 'number' },
                  method: { type: 'string' },
                  url: { type: 'string' },
                },
              },
            },
          },
        },
      },
    },
  }, async () => {
    const cacheKey = 'system:health'
    const cached = fastify.cache.get(cacheKey)
    if (cached) return cached

    const health = await system.getHealth()
    const recentErrors = errorRing.getRecent()
    const healthWithErrors = { ...health, recentErrors }
    fastify.cache.set(cacheKey, healthWithErrors, 5) // 5s TTL
    return healthWithErrors
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
  // GET /system/network/connections — Active network connections via SSH
  fastify.get('/network/connections', {
    schema: {
      tags: ['System'],
      summary: 'Get active network connections on the host',
      description: 'Returns active TCP/UDP connections from the host via SSH (ss -tunap).',
      response: {
        200: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              proto: { type: 'string' },
              localAddr: { type: 'string' },
              localPort: { type: 'number' },
              remoteAddr: { type: 'string' },
              remotePort: { type: 'number' },
              state: { type: 'string' },
              pid: { type: ['number', 'null'] },
              process: { type: ['string', 'null'] },
            },
          },
        },
      },
    },
  }, async () => {
    const cacheKey = 'system:network:connections'
    const cached = fastify.cache.get(cacheKey)
    if (cached) return cached

    const connections = await system.getNetworkConnections()
    fastify.cache.set(cacheKey, connections, 5) // 5s TTL
    return connections
  })

  // GET /system/network/bandwidth — Real-time bandwidth per interface
  fastify.get('/network/bandwidth', {
    schema: {
      tags: ['System'],
      summary: 'Get real-time bandwidth per network interface',
      description: 'Reads /proc/net/dev twice with 1s delay and computes bytes/sec delta for each interface.',
      response: {
        200: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              rx_bytes_sec: { type: 'number' },
              tx_bytes_sec: { type: 'number' },
              rx_mbps: { type: 'number' },
              tx_mbps: { type: 'number' },
            },
          },
        },
      },
    },
  }, async () => {
    const cacheKey = 'system:network:bandwidth'
    const cached = fastify.cache.get(cacheKey)
    if (cached) return cached

    const bandwidth = await system.getNetworkBandwidth()
    fastify.cache.set(cacheKey, bandwidth, 3) // 3s TTL
    return bandwidth
  })

  // GET /system/network/latency — Ping latency to specified hosts
  fastify.get('/network/latency', {
    schema: {
      tags: ['System'],
      summary: 'Check ping latency to specified hosts',
      description: 'Pings each host 3 times via SSH and returns min/avg/max latency. Defaults to google.com, 1.1.1.1, 8.8.8.8. Max 5 hosts.',
      querystring: {
        type: 'object',
        properties: {
          hosts: { type: 'string' },
        },
      },
      response: {
        200: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              host: { type: 'string' },
              avg_ms: { type: ['number', 'null'] },
              min_ms: { type: ['number', 'null'] },
              max_ms: { type: ['number', 'null'] },
              loss_percent: { type: 'number' },
              reachable: { type: 'boolean' },
            },
          },
        },
      },
    },
  }, async (request) => {
    const query = request.query as { hosts?: string }
    const defaultHosts = ['google.com', '1.1.1.1', '8.8.8.8']
    const hosts = query.hosts
      ? query.hosts.split(',').map((h) => h.trim()).filter(Boolean).slice(0, 5)
      : defaultHosts

    const cacheKey = `system:network:latency:${[...hosts].sort().join(',')}`
    const cached = fastify.cache.get(cacheKey)
    if (cached) return cached

    const latency = await system.getNetworkLatency(hosts)
    fastify.cache.set(cacheKey, latency, 10) // 10s TTL
    return latency
  })
}

export default systemRoutes
