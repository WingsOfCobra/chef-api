import { FastifyPluginAsync } from 'fastify'
import * as system from '../services/system.service'

const systemRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /system/health — public, no auth required (handled in auth plugin)
  // Cached for 5s to reduce CPU sampling overhead
  fastify.get('/health', { schema: { tags: ['System'] } }, async () => {
    const cacheKey = 'system:health'
    const cached = fastify.cache.get(cacheKey)
    if (cached) return cached

    const health = await system.getHealth()
    fastify.cache.set(cacheKey, health, 5) // 5s TTL
    return health
  })

  // GET /system/disk
  // Cached for 10s - disk usage changes slowly
  fastify.get('/disk', { schema: { tags: ['System'] } }, async () => {
    const cacheKey = 'system:disk'
    const cached = fastify.cache.get(cacheKey)
    if (cached) return cached

    const disk = system.getDiskUsage()
    fastify.cache.set(cacheKey, disk, 10) // 10s TTL
    return disk
  })

  // GET /system/processes
  // Cached for 3s - processes change frequently but don't need real-time
  fastify.get('/processes', { schema: { tags: ['System'] } }, async (request) => {
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
