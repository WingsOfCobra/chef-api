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

  return fastify
}

async function main() {
  const fastify = await build()

  try {
    await fastify.listen({ port: config.port, host: config.host })
    fastify.log.info(`🍳 Chef API running at http://${config.host}:${config.port}`)
    fastify.log.info(`📚 Swagger docs at http://${config.host}:${config.port}/docs`)
  } catch (err) {
    fastify.log.error(err)
    process.exit(1)
  }
}

main()
