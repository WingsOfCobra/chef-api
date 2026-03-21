import Fastify from 'fastify'
import swagger from '@fastify/swagger'
import swaggerUi from '@fastify/swagger-ui'
import { config } from './config'
import authPlugin from './plugins/auth'
import cachePlugin from './plugins/cache'
import githubRoutes from './routes/github'
import dockerRoutes from './routes/docker'
import sshRoutes from './routes/ssh'
import systemRoutes from './routes/system'
import todoRoutes from './routes/todo'
import cronRoutes from './routes/cron'
import hooksRoutes from './routes/hooks'
import logsRoutes from './routes/logs'
import emailRoutes from './routes/email'
import { initScheduler } from './services/cron-scheduler'
import { cleanupOldEvents } from './services/hooks.service'
import { initLogSources, runIndexCycle } from './services/logs.service'

async function build() {
  const fastify = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? 'info',
      transport:
        process.env.NODE_ENV !== 'production'
          ? { target: 'pino-pretty', options: { colorize: true } }
          : undefined,
    },
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
    uiConfig: {
      docExpansion: 'list',
      deepLinking: true,
    },
  })

  // Plugins
  await fastify.register(cachePlugin)
  await fastify.register(authPlugin)

  // Routes
  await fastify.register(githubRoutes, { prefix: '/github' })
  await fastify.register(dockerRoutes, { prefix: '/docker' })
  await fastify.register(sshRoutes, { prefix: '/ssh' })
  await fastify.register(systemRoutes, { prefix: '/system' })
  await fastify.register(todoRoutes, { prefix: '/todo' })
  await fastify.register(cronRoutes, { prefix: '/cron' })
  await fastify.register(hooksRoutes, { prefix: '/hooks' })
  await fastify.register(logsRoutes, { prefix: '/logs' })
  await fastify.register(emailRoutes, { prefix: '/email' })

  return fastify
}

async function main() {
  const fastify = await build()

  try {
    await fastify.listen({ port: config.port, host: config.host })
    initScheduler()
    initLogSources()
    // Index log sources periodically
    if (config.logSources.length > 0) {
      setInterval(() => runIndexCycle(), config.logIndexIntervalSeconds * 1000)
    }
    // Clean up expired hook events every 6 hours
    setInterval(() => cleanupOldEvents(), 6 * 60 * 60 * 1000)
    fastify.log.info(`🍳 Chef API running at http://${config.host}:${config.port}`)
    fastify.log.info(`📚 Swagger docs at http://${config.host}:${config.port}/docs`)
  } catch (err) {
    fastify.log.error(err)
    process.exit(1)
  }
}

main()
