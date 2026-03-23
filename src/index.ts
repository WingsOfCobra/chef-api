import Fastify from 'fastify'
import swagger from '@fastify/swagger'
import swaggerUi from '@fastify/swagger-ui'
import websocket from '@fastify/websocket'
import { config } from './config'
import authPlugin from './plugins/auth'
import cachePlugin from './plugins/cache'
import errorHandlerPlugin from './middleware/error-handler'
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
import secretsRoutes from './routes/secrets'
import ansibleRoutes from './routes/ansible'
import metricsRoutes from './routes/metrics'
import dashboardsRoutes from './routes/dashboards'
import { initScheduler } from './services/cron-scheduler'
import { cleanupOldEvents } from './services/hooks.service'
import { startAlertChecker } from './services/alert-checker'
import { checkCronFailures, checkContainerExits } from './services/alert-monitor'
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
        { name: 'Secrets', description: 'Bitwarden secrets vault integration' },
        { name: 'Ansible', description: 'Ansible playbook execution and job management' },
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
  await fastify.register(errorHandlerPlugin)

  // Node mode filter: block disallowed routes with 503
  if (config.nodeMode) {
    const allowedPrefixes = ['/system', '/docker', '/services', '/metrics', '/node', '/docs']
    fastify.addHook('onRequest', async (request, reply) => {
      // Skip auth exempted routes (already handled by authPlugin)
      if (request.url.startsWith('/docs') || request.url === '/system/health') {
        return
      }
      // Check if route is allowed in node mode
      const isAllowed = allowedPrefixes.some(prefix => request.url.startsWith(prefix))
      if (!isAllowed) {
        reply.code(503).send({ error: 'Not available in node mode' })
      }
    })
  }

  // Routes — always register system/docker/services/metrics (node mode allows these)
  await fastify.register(systemRoutes, { prefix: '/system' })
  await fastify.register(dockerRoutes, { prefix: '/docker' })
  await fastify.register(servicesRoutes, { prefix: '/services' })
  await fastify.register(metricsRoutes, { prefix: '/metrics' })

  // Node info endpoint — always available
  fastify.get('/node/info', {
    schema: {
      tags: ['System'],
      summary: 'Node information',
      description: 'Returns node mode, version, hostname, and uptime. Always available regardless of node mode.',
      response: {
        200: {
          type: 'object',
          properties: {
            mode: { type: 'string', enum: ['master', 'node'] },
            version: { type: 'string' },
            hostname: { type: 'string' },
            uptime: { type: 'number' },
          },
        },
      },
    },
  }, async () => {
    const os = require('os')
    return {
      mode: config.nodeMode ? 'node' : 'master',
      version: '0.1.0',
      hostname: os.hostname(),
      uptime: os.uptime(),
    }
  })

  // Master-only routes
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

async function main() {
  let fastify
  
  try {
    fastify = await build()
  } catch (err) {
    console.error('❌ Failed to build Fastify app:', err)
    process.exit(1)
  }

  try {
    await fastify.listen({ port: config.port, host: config.host })
  } catch (err) {
    fastify.log.error({ err, port: config.port, host: config.host }, '❌ Failed to start server')
    process.exit(1)
  }

  // Startup banner
  fastify.log.info(`🍳 Chef API running at http://${config.host}:${config.port}`)
  fastify.log.info(`📚 Swagger docs at http://${config.host}:${config.port}/docs`)
  
  if (config.nodeMode) {
    fastify.log.info('[chef-node] Running in NODE mode — only metrics endpoints active')
  } else {
    fastify.log.info('[chef-api] Running in MASTER mode — full API active')
  }

  // Master-only background services
  if (!config.nodeMode) {
    try {
      // Initialize cron scheduler with logger
      initScheduler(fastify.log)
      const scheduledCount = require('./services/cron-scheduler').getScheduledCount()
      fastify.log.info({ scheduledJobs: scheduledCount }, '✓ Cron scheduler initialized')
    } catch (err) {
      fastify.log.error({ err }, '❌ Failed to initialize cron scheduler')
    }

    try {
      // Initialize log sources
      initLogSources()
      if (config.logSources.length > 0) {
        fastify.log.info({ sources: config.logSources.length, intervalSeconds: config.logIndexIntervalSeconds }, 'Log indexing enabled')
        setInterval(() => runIndexCycle(), config.logIndexIntervalSeconds * 1000)
      }
    } catch (err) {
      fastify.log.error({ err }, '❌ Failed to initialize log sources')
    }

    try {
      // Start alert checker (every 60s)
      startAlertChecker(fastify)
    } catch (err) {
      fastify.log.error({ err }, '❌ Failed to start alert checker')
    }

    try {
      // Start alert monitors (every 60s)
      setInterval(() => {
        checkCronFailures().catch((err) => fastify.log.error('Alert monitor - cron failures:', err))
        checkContainerExits().catch((err) => fastify.log.error('Alert monitor - container exits:', err))
      }, 60 * 1000)
    } catch (err) {
      fastify.log.error({ err }, '❌ Failed to start alert monitors')
    }

    try {
      // Clean up expired hook events every 6 hours
      setInterval(() => cleanupOldEvents(), 6 * 60 * 60 * 1000)
    } catch (err) {
      fastify.log.error({ err }, '❌ Failed to start hook cleanup interval')
    }
  } else {
    fastify.log.info('[chef-node] Skipping cron scheduler initialization')
    fastify.log.info('[chef-node] Skipping alert checker')
    fastify.log.info('[chef-node] Skipping log indexing')
  }
}

main()
