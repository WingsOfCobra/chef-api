import Fastify, { FastifyInstance, FastifyPluginAsync } from 'fastify'
import cachePlugin from '../plugins/cache'
import authPlugin from '../plugins/auth'

export const TEST_API_KEY = 'test-api-key-12345'

interface BuildAppOptions {
  routes?: Array<{ plugin: FastifyPluginAsync; prefix: string }>
  skipAuth?: boolean
  skipCache?: boolean
}

export async function buildApp(opts?: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })

  if (!opts?.skipCache) {
    await app.register(cachePlugin)
  }
  if (!opts?.skipAuth) {
    await app.register(authPlugin)
  }

  if (opts?.routes) {
    for (const { plugin, prefix } of opts.routes) {
      await app.register(plugin, { prefix })
    }
  }

  await app.ready()
  return app
}

export function authHeaders(): Record<string, string> {
  return { 'x-chef-api-key': TEST_API_KEY }
}
