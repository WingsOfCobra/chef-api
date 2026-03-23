import { FastifyPluginAsync } from 'fastify'
import * as docker from '../services/docker.service'
import { errorRing } from '../lib/error-ring'

const errorResponse = {
  type: 'object',
  properties: {
    error: { type: 'string' },
  },
} as const

const dockerRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /docker/containers
  fastify.get('/containers', {
    schema: {
      tags: ['Docker'],
      summary: 'List all Docker containers',
      description: 'Returns all containers (running, stopped, paused) with their status, health, ports, and uptime.',
      response: {
        200: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              name: { type: 'string' },
              image: { type: 'string' },
              status: { type: 'string' },
              state: { type: 'string' },
              health: { type: ['string', 'null'] },
              uptime: { type: 'string' },
              ports: { type: 'array', items: { type: 'string' } },
            },
          },
        },
      },
    },
  }, async () => {
    const cacheKey = 'docker:containers'
    const cached = fastify.cache.get(cacheKey)
    if (cached) return cached

    try {
      const containers = await docker.listContainers()
      fastify.cache.set(cacheKey, containers, 10)
      return containers
    } catch (err: any) {
      const message = err.message?.substring(0, 500) || 'Unknown error'
      fastify.log.error({ service: 'docker', err: message, stack: err.stack?.substring(0, 500) }, 'Docker socket call failed')
      errorRing.add({
        timestamp: new Date().toISOString(),
        service: 'docker',
        message: `listContainers failed: ${message}`,
      })
      throw err
    }
  })

  // POST /docker/containers/:id/restart
  fastify.post<{ Params: { id: string } }>(
    '/containers/:id/restart',
    {
      schema: {
        tags: ['Docker'],
        summary: 'Restart a container',
        description: 'Restarts the specified container by ID or name.',
        params: {
          type: 'object',
          properties: { id: { type: 'string' } },
          required: ['id'],
        },
        response: {
          204: { type: 'null', description: 'Container restarted successfully' },
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params
      try {
        await docker.restartContainer(id)
        fastify.cache.del('docker:containers')
        reply.code(204)
      } catch (err: any) {
        const message = err.message?.substring(0, 500) || 'Unknown error'
        fastify.log.error({ service: 'docker', err: message, container: id }, 'Docker restart failed')
        errorRing.add({
          timestamp: new Date().toISOString(),
          service: 'docker',
          message: `restartContainer(${id}) failed: ${message}`,
        })
        throw err
      }
    }
  )

  // POST /docker/containers/:id/stop
  fastify.post<{ Params: { id: string } }>(
    '/containers/:id/stop',
    {
      schema: {
        tags: ['Docker'],
        summary: 'Stop a container',
        description: 'Stops the specified container by ID or name.',
        params: {
          type: 'object',
          properties: { id: { type: 'string' } },
          required: ['id'],
        },
        response: {
          204: { type: 'null', description: 'Container stopped successfully' },
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params
      await docker.stopContainer(id)
      fastify.cache.del('docker:containers')
      reply.code(204)
    }
  )

  // DELETE /docker/containers/:id
  fastify.delete<{ Params: { id: string } }>(
    '/containers/:id',
    {
      schema: {
        tags: ['Docker'],
        summary: 'Remove a container',
        description: 'Removes the specified container by ID or name. Container must be stopped first.',
        params: {
          type: 'object',
          properties: { id: { type: 'string' } },
          required: ['id'],
        },
        response: {
          200: {
            type: 'object',
            properties: {
              message: { type: 'string' },
            },
          },
          404: errorResponse,
          409: errorResponse,
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params
      try {
        await docker.removeContainer(id)
        fastify.cache.delPattern('docker:*')
        reply.code(200).send({ message: 'Container removed' })
      } catch (err: any) {
        if (err.statusCode === 404) {
          reply.code(404).send({ error: 'Container not found' })
        } else if (err.statusCode === 409) {
          reply.code(409).send({ error: err.message })
        } else {
          throw err
        }
      }
    }
  )

  // GET /docker/containers/:id/logs
  fastify.get<{ Params: { id: string } }>(
    '/containers/:id/logs',
    {
      schema: {
        tags: ['Docker'],
        summary: 'Get container logs',
        description: 'Returns the last N lines of logs for a container. Accepts optional "lines" query parameter (default 100).',
        params: {
          type: 'object',
          properties: { id: { type: 'string' } },
          required: ['id'],
        },
        querystring: {
          type: 'object',
          properties: { lines: { type: 'string' } },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              lines: { type: 'number' },
              logs: { type: 'string' },
            },
          },
        },
      },
    },
    async (request) => {
      const { id } = request.params
      const query = request.query as { lines?: string }
      const lines = query.lines ? parseInt(query.lines, 10) : 100

      const logs = await docker.getContainerLogs(id, lines)
      return { id, lines, logs }
    }
  )

  // GET /docker/containers/:id/inspect — full container detail
  fastify.get<{ Params: { id: string } }>(
    '/containers/:id/inspect',
    { schema: { tags: ['Docker'] } },
    async (request) => {
      const { id } = request.params
      const cacheKey = `docker:inspect:${id}`
      const cached = fastify.cache.get(cacheKey)
      if (cached) return cached

      const detail = await docker.inspectContainer(id)
      fastify.cache.set(cacheKey, detail, 10)
      return detail
    }
  )

  // GET /docker/containers/:id/stats
  fastify.get<{ Params: { id: string } }>(
    '/containers/:id/stats',
    {
      schema: {
        tags: ['Docker'],
        summary: 'Get per-container resource stats',
        description: 'Returns CPU, memory, network, and block I/O stats for a single container. Not cached — intended for frequent polling.',
        params: {
          type: 'object',
          properties: { id: { type: 'string' } },
          required: ['id'],
        },
        response: {
          200: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              name: { type: 'string' },
              cpu_percent: { type: 'number' },
              memory_usage: { type: 'number' },
              memory_limit: { type: 'number' },
              memory_percent: { type: 'number' },
              network_rx: { type: 'number' },
              network_tx: { type: 'number' },
              block_read: { type: 'number' },
              block_write: { type: 'number' },
              timestamp: { type: 'string' },
            },
          },
        },
      },
    },
    async (request) => {
      const { id } = request.params
      return await docker.getContainerStats(id)
    }
  )

  // GET /docker/stats
  // Cached for 5s - Docker stats are expensive to compute
  fastify.get('/stats', {
    schema: {
      tags: ['Docker'],
      summary: 'Get overall Docker resource usage',
      description: 'Returns aggregate Docker stats including container counts, image/volume counts, and disk usage breakdown.',
      response: {
        200: {
          type: 'object',
          properties: {
            containers: {
              type: 'object',
              properties: {
                total: { type: 'number' },
                running: { type: 'number' },
                stopped: { type: 'number' },
                paused: { type: 'number' },
              },
            },
            images: { type: 'number' },
            volumes: { type: 'number' },
            diskUsage: {
              type: 'object',
              properties: {
                images: { type: 'string' },
                containers: { type: 'string' },
                volumes: { type: 'string' },
                buildCache: { type: 'string' },
              },
            },
          },
        },
      },
    },
  }, async () => {
    const cacheKey = 'docker:stats'
    const cached = fastify.cache.get(cacheKey)
    if (cached) return cached

    try {
      const stats = await docker.getDockerStats()
      fastify.cache.set(cacheKey, stats, 5) // Reduced to 5s for better performance
      return stats
    } catch (err: any) {
      const message = err.message?.substring(0, 500) || 'Unknown error'
      fastify.log.error({ service: 'docker', err: message }, 'Docker stats call failed')
      errorRing.add({
        timestamp: new Date().toISOString(),
        service: 'docker',
        message: `getDockerStats failed: ${message}`,
      })
      throw err
    }
  })

  // GET /docker/images — list all images
  fastify.get('/images', { schema: { tags: ['Docker'] } }, async () => {
    const cacheKey = 'docker:images'
    const cached = fastify.cache.get(cacheKey)
    if (cached) return cached

    const images = await docker.listImages()
    fastify.cache.set(cacheKey, images, 10)
    return images
  })

  // GET /docker/networks — list all networks
  fastify.get('/networks', { schema: { tags: ['Docker'] } }, async () => {
    const cacheKey = 'docker:networks'
    const cached = fastify.cache.get(cacheKey)
    if (cached) return cached

    const networks = await docker.listNetworks()
    fastify.cache.set(cacheKey, networks, 10)
    return networks
  })
}

export default dockerRoutes
