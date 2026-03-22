import Fastify from 'fastify'
import swagger from '@fastify/swagger'
import swaggerUi from '@fastify/swagger-ui'
import websocket from '@fastify/websocket'
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
import servicesRoutes from './routes/services'
import alertsRoutes from './routes/alerts'
import metricsRoutes from './routes/metrics'
import { initScheduler } from './services/cron-scheduler'
import { cleanupOldEvents } from './services/hooks.service'
import { startAlertChecker } from './services/alert-checker'
import { initLogSources, runIndexCycle } from './services/logs.service'
import wsRoutes from './routes/ws'

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
      tags: [
        { name: 'GitHub', description: 'GitHub repositories, PRs, issues, workflows, notifications' },
        { name: 'Docker', description: 'Docker containers, logs, stats' },
        { name: 'SSH', description: 'SSH hosts and remote command execution' },
        { name: 'System', description: 'System health, disk, and process information' },
        { name: 'Todos', description: 'Todo item management' },
        { name: 'Cron', description: 'Cron job scheduling and management' },
        { name: 'Hooks', description: 'Webhook events and notifications' },
        { name: 'Logs', description: 'Log file search and aggregation' },
        { name: 'Email', description: 'Email monitoring and retrieval' },
        { name: 'Services', description: 'Systemd service monitoring' },
        { name: 'Alerts', description: 'Alert rules and webhook notifications' },
        { name: 'Metrics', description: 'Prometheus and JSON system metrics' },
      ],
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
  await fastify.register(websocket)
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
  await fastify.register(servicesRoutes, { prefix: '/services' })
  await fastify.register(alertsRoutes, { prefix: '/alerts' })
  await fastify.register(metricsRoutes, { prefix: '/metrics' })
  await fastify.register(wsRoutes, { prefix: '/ws' })

  return fastify
}

async function main() {
  const fastify = await build()

  try {
    await fastify.listen({ port: config.port, host: config.host })
    
    // Initialize cron scheduler with logger
    initScheduler(fastify.log)
    const scheduledCount = require('./services/cron-scheduler').getScheduledCount()
    fastify.log.info({ scheduledJobs: scheduledCount }, '✓ Cron scheduler initialized')
    
    // Initialize log sources
    initLogSources()
    if (config.logSources.length > 0) {
      fastify.log.info({ sources: config.logSources.length, intervalSeconds: config.logIndexIntervalSeconds }, 'Log indexing enabled')
      setInterval(() => runIndexCycle(), config.logIndexIntervalSeconds * 1000)
    }
    
    // Start alert checker (every 60s)
    startAlertChecker(fastify)

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
