import { FastifyPluginAsync } from 'fastify'
import * as docker from '../services/docker.service'

const dockerRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /docker/containers
  fastify.get('/containers', { schema: { tags: ['Docker'] } }, async () => {
    const cacheKey = 'docker:containers'
    const cached = fastify.cache.get(cacheKey)
    if (cached) return cached

    const containers = await docker.listContainers()
    fastify.cache.set(cacheKey, containers, 10)
    return containers
  })

  // POST /docker/containers/:id/restart
  fastify.post<{ Params: { id: string } }>(
    '/containers/:id/restart',
    { schema: { tags: ['Docker'] } },
    async (request, reply) => {
      const { id } = request.params
      await docker.restartContainer(id)
      fastify.cache.del('docker:containers')
      reply.code(204)
    }
  )

  // POST /docker/containers/:id/stop
  fastify.post<{ Params: { id: string } }>(
    '/containers/:id/stop',
    { schema: { tags: ['Docker'] } },
    async (request, reply) => {
      const { id } = request.params
      await docker.stopContainer(id)
      fastify.cache.del('docker:containers')
      reply.code(204)
    }
  )

  // GET /docker/containers/:id/logs
  fastify.get<{ Params: { id: string } }>(
    '/containers/:id/logs',
    { schema: { tags: ['Docker'] } },
    async (request) => {
      const { id } = request.params
      const query = request.query as { lines?: string }
      const lines = query.lines ? parseInt(query.lines, 10) : 100

      const logs = await docker.getContainerLogs(id, lines)
      return { id, lines, logs }
    }
  )

  // GET /docker/containers/:id/stats
  fastify.get<{ Params: { id: string } }>(
    '/containers/:id/stats',
    { schema: { tags: ['Docker'] } },
    async (request) => {
      const { id } = request.params
      return await docker.getContainerStats(id)
    }
  )

  // GET /docker/stats
  fastify.get('/stats', { schema: { tags: ['Docker'] } }, async () => {
    const cacheKey = 'docker:stats'
    const cached = fastify.cache.get(cacheKey)
    if (cached) return cached

    const stats = await docker.getDockerStats()
    fastify.cache.set(cacheKey, stats, 10)
    return stats
  })
}

export default dockerRoutes
