import { FastifyPluginAsync } from 'fastify'
import * as system from '../services/system.service'

const systemRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /system/health — public, no auth required (handled in auth plugin)
  fastify.get('/health', async () => {
    return system.getHealth()
  })

  // GET /system/disk
  fastify.get('/disk', async () => {
    return system.getDiskUsage()
  })

  // GET /system/processes
  fastify.get('/processes', async (request) => {
    const query = request.query as { limit?: string }
    const limit = query.limit ? parseInt(query.limit, 10) : 20
    return system.getTopProcesses(limit)
  })
}

export default systemRoutes
