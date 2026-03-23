import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import fastifyPlugin from 'fastify-plugin'
import { errorRing } from '../lib/error-ring'

/**
 * Error logging middleware
 * Logs all 4xx/5xx responses with structured context
 * Tracks errors in ring buffer for /system/health
 */
async function errorHandlerPlugin(fastify: FastifyInstance) {
  // Track request start time
  fastify.addHook('onRequest', async (request: FastifyRequest) => {
    ;(request as any).startTime = Date.now()
  })

  // Log errors on response
  fastify.addHook('onResponse', async (request: FastifyRequest, reply: FastifyReply) => {
    const statusCode = reply.statusCode
    const startTime = (request as any).startTime || Date.now()
    const durationMs = Date.now() - startTime

    // Only log 4xx and 5xx responses
    if (statusCode < 400) return

    const logContext = {
      method: request.method,
      url: request.url,
      statusCode,
      durationMs,
      ip: request.ip,
    }

    // Determine log level based on status code
    const logLevel = statusCode >= 500 ? 'error' : 'warn'

    // Log the error
    if (logLevel === 'error') {
      fastify.log.error(logContext, `HTTP ${statusCode} - ${request.method} ${request.url}`)
    } else {
      fastify.log.warn(logContext, `HTTP ${statusCode} - ${request.method} ${request.url}`)
    }

    // Add to error ring buffer for health endpoint
    if (statusCode >= 500) {
      errorRing.add({
        timestamp: new Date().toISOString(),
        service: 'http',
        message: `${request.method} ${request.url} → ${statusCode}`,
        statusCode,
        method: request.method,
        url: request.url,
      })
    }
  })
}

export default fastifyPlugin(errorHandlerPlugin)
