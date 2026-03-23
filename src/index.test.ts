import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { FastifyInstance } from 'fastify'

// Import build function - we'll need to export it from index.ts
async function buildApp() {
  // Dynamically import to avoid side effects
  const { default: Fastify } = await import('fastify')
  const { default: swagger } = await import('@fastify/swagger')
  const { default: swaggerUi } = await import('@fastify/swagger-ui')
  const { default: websocket } = await import('@fastify/websocket')
  const { config } = await import('./config')
  const { default: authPlugin } = await import('./plugins/auth')
  const { default: cachePlugin } = await import('./plugins/cache')
  const { default: errorHandlerPlugin } = await import('./middleware/error-handler')
  const { default: githubRoutes } = await import('./routes/github')
  const { default: dockerRoutes } = await import('./routes/docker')
  const { default: sshRoutes } = await import('./routes/ssh')
  const { default: systemRoutes } = await import('./routes/system')
  const { default: todoRoutes } = await import('./routes/todo')
  const { default: cronRoutes } = await import('./routes/cron')
  const { default: hooksRoutes } = await import('./routes/hooks')
  const { default: logsRoutes } = await import('./routes/logs')
  const { default: emailRoutes } = await import('./routes/email')
  const { default: servicesRoutes } = await import('./routes/services')
  const { default: alertsRoutes } = await import('./routes/alerts')
  const { default: secretsRoutes } = await import('./routes/secrets')
  const { default: ansibleRoutes } = await import('./routes/ansible')
  const { default: metricsRoutes } = await import('./routes/metrics')
  const { default: dashboardsRoutes } = await import('./routes/dashboards')
  const { default: wsRoutes } = await import('./routes/ws')

  const fastify = Fastify({
    logger: false, // Disable logging in tests
  })

  // Swagger / OpenAPI docs
  await fastify.register(swagger, {
    openapi: {
      openapi: '3.0.0',
      info: {
        title: 'Chef API',
        description: "Chef's local orchestration API — GitHub, Docker, SSH, system management",
        version: '0.1.0',
      },
      components: {
        securitySchemes: {
          apiKey: {
            type: 'apiKey',
            name: 'X-Chef-API-Key',
            in: 'header',
          },
        },
      },
      security: [{ apiKey: [] }],
    },
  })

  await fastify.register(swaggerUi, {
    routePrefix: '/docs',
  })

  // Plugins
  await fastify.register(websocket)
  await fastify.register(cachePlugin)
  await fastify.register(authPlugin)
  await fastify.register(errorHandlerPlugin)

  // Node mode filter
  if (config.nodeMode) {
    const allowedPrefixes = ['/system', '/docker', '/services', '/metrics', '/node', '/docs']
    fastify.addHook('onRequest', async (request, reply) => {
      if (request.url.startsWith('/docs') || request.url === '/system/health') {
        return
      }
      const isAllowed = allowedPrefixes.some(prefix => request.url.startsWith(prefix))
      if (!isAllowed) {
        reply.code(503).send({ error: 'Not available in node mode' })
      }
    })
  }

  // Routes
  await fastify.register(systemRoutes, { prefix: '/system' })
  await fastify.register(dockerRoutes, { prefix: '/docker' })
  await fastify.register(servicesRoutes, { prefix: '/services' })
  await fastify.register(metricsRoutes, { prefix: '/metrics' })

  fastify.get('/node/info', async () => {
    const os = require('os')
    return {
      mode: config.nodeMode ? 'node' : 'master',
      version: '0.1.0',
      hostname: os.hostname(),
      uptime: os.uptime(),
    }
  })

  if (!config.nodeMode) {
    await fastify.register(githubRoutes, { prefix: '/github' })
    await fastify.register(sshRoutes, { prefix: '/ssh' })
    await fastify.register(todoRoutes, { prefix: '/todo' })
    await fastify.register(cronRoutes, { prefix: '/cron' })
    await fastify.register(hooksRoutes, { prefix: '/hooks' })
    await fastify.register(logsRoutes, { prefix: '/logs' })
    await fastify.register(emailRoutes, { prefix: '/email' })
    await fastify.register(alertsRoutes, { prefix: '/alerts' })
    await fastify.register(secretsRoutes, { prefix: '/secrets' })
    await fastify.register(ansibleRoutes, { prefix: '/ansible' })
    await fastify.register(wsRoutes, { prefix: '/ws' })
  }
  
  await fastify.register(dashboardsRoutes, { prefix: '/dashboards' })

  return fastify
}

describe('Application Startup', () => {
  let app: FastifyInstance

  it('should build the application without errors', async () => {
    // This test catches duplicate route registration and other startup issues
    app = await buildApp()
    expect(app).toBeDefined()
  })

  it('should have registered the /node/info route', async () => {
    if (!app) {
      app = await buildApp()
    }
    
    const response = await app.inject({
      method: 'GET',
      url: '/node/info',
    })

    expect(response.statusCode).toBe(200)
    const body = JSON.parse(response.body)
    expect(body).toHaveProperty('mode')
    expect(body).toHaveProperty('version')
    expect(body).toHaveProperty('hostname')
    expect(body).toHaveProperty('uptime')
  })

  afterAll(async () => {
    if (app) {
      await app.close()
    }
  })
})
