import { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import * as fleetService from '../services/fleet.service'

const addServerSchema = z.object({
  name: z.string().min(1),
  ssh_host: z.string().min(1),
  tags: z.array(z.string()).optional(),
})

const fleetRunSchema = z.object({
  command: z.string().min(1),
  servers: z.array(z.string()).optional(),
})

const fleetServerResponseSchema = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    host: { type: 'string' },
    user: { type: 'string' },
    ssh_host: { type: 'string' },
    tags: { type: ['string', 'null'] },
    last_seen: { type: ['string', 'null'] },
    os_info: { type: ['string', 'null'] },
    status: { type: 'string' },
    created_at: { type: 'string' },
  },
} as const

const memorySchema = {
  type: 'object',
  properties: {
    total: { type: 'number' },
    used: { type: 'number' },
    free: { type: 'number' },
    usedPercent: { type: 'number' },
  },
} as const

const diskSchema = {
  type: 'object',
  properties: {
    source: { type: 'string' },
    size: { type: 'string' },
    used: { type: 'string' },
    avail: { type: 'string' },
    percent: { type: 'string' },
    target: { type: 'string' },
  },
} as const

const fleetStatusResponseSchema = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    status: { type: 'string' },
    info: {
      type: 'object',
      properties: {
        hostname: { type: 'string' },
        os: { type: 'string' },
        uptime: { type: 'string' },
        load: { type: 'string' },
        memory: memorySchema,
        disk: { type: 'array', items: diskSchema },
      },
    },
    error: { type: 'string' },
    responseTimeMs: { type: 'number' },
  },
} as const

const fleetRunResultSchema = {
  type: 'object',
  properties: {
    server: { type: 'string' },
    stdout: { type: 'string' },
    stderr: { type: 'string' },
    code: { type: ['number', 'null'] },
    error: { type: 'string' },
  },
} as const

const fleetRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /fleet/servers — list all fleet servers
  fastify.get('/servers', {
    schema: {
      tags: ['Fleet'],
      summary: 'List all fleet servers',
      response: {
        200: {
          type: 'array',
          items: fleetServerResponseSchema,
        },
      },
    },
  }, async (_request, reply) => {
    const cached = fastify.cache.get('fleet_servers')
    if (cached) return cached

    const servers = fleetService.listServers()
    fastify.cache.set('fleet_servers', servers, 30)
    return servers
  })

  // POST /fleet/servers — add server to fleet
  fastify.post('/servers', {
    schema: {
      tags: ['Fleet'],
      summary: 'Add a server to the fleet',
      response: {
        201: fleetServerResponseSchema,
      },
    },
  }, async (request, reply) => {
    const body = addServerSchema.parse(request.body)
    try {
      const server = fleetService.addServer(body)
      fastify.cache.delPattern('fleet_%')
      reply.code(201)
      return server
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (message.includes('not configured') || message.includes('already exists')) {
        reply.code(400)
        return { error: message }
      }
      throw err
    }
  })

  // DELETE /fleet/servers/:name — remove server from fleet
  fastify.delete('/servers/:name', {
    schema: {
      tags: ['Fleet'],
      summary: 'Remove a server from the fleet',
      response: {
        204: { type: 'null', description: 'Server removed' },
        404: { type: 'object', properties: { error: { type: 'string' } } },
      },
    },
  }, async (request, reply) => {
    const { name } = request.params as { name: string }
    const deleted = fleetService.removeServer(name)
    if (!deleted) {
      reply.code(404)
      return { error: 'Server not found' }
    }
    fastify.cache.delPattern('fleet_%')
    reply.code(204)
    return null
  })

  // POST /fleet/run — run command on fleet servers
  fastify.post('/run', {
    schema: {
      tags: ['Fleet'],
      summary: 'Run a command on all or selected fleet servers',
      response: {
        200: {
          type: 'array',
          items: fleetRunResultSchema,
        },
      },
    },
  }, async (request, reply) => {
    const body = fleetRunSchema.parse(request.body)
    try {
      const results = await fleetService.runOnServers(body.command, body.servers)
      return results
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (message.includes('No matching servers')) {
        reply.code(400)
        return { error: message }
      }
      throw err
    }
  })

  // GET /fleet/status — health summary across fleet
  fastify.get('/status', {
    schema: {
      tags: ['Fleet'],
      summary: 'Get health status of all fleet servers',
      response: {
        200: {
          type: 'array',
          items: fleetStatusResponseSchema,
        },
      },
    },
  }, async (_request, reply) => {
    const cached = fastify.cache.get('fleet_status')
    if (cached) return cached

    const status = await fleetService.getFleetStatus()
    fastify.cache.set('fleet_status', status, 30)
    return status
  })
}

export default fleetRoutes
