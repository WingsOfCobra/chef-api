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
    { schema: { tags: ['Docker'] } },
    async (request) => {
      const { id } = request.params
      return await docker.getContainerStats(id)
    }
  )

  // GET /docker/stats
  // Cached for 5s - Docker stats are expensive to compute
  fastify.get('/stats', { schema: { tags: ['Docker'] } }, async () => {
    const cacheKey = 'docker:stats'
    const cached = fastify.cache.get(cacheKey)
    if (cached) return cached

    const stats = await docker.getDockerStats()
    fastify.cache.set(cacheKey, stats, 5) // Reduced to 5s for better performance
    return stats
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
