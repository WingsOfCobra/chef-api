import { FastifyPluginAsync } from 'fastify'
import * as metricsService from '../services/metrics.service'

const metricsRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /metrics — Prometheus text format
  fastify.get('/', {
    schema: {
      tags: ['Metrics'],
      summary: 'Prometheus-compatible metrics endpoint',
      response: {
        200: {
          type: 'string',
          description: 'Prometheus exposition format text',
        },
      },
    },
  }, async (_request, reply) => {
    const cached = fastify.cache.get('metrics:prometheus')
    if (cached) {
      reply.type('text/plain; version=0.0.4; charset=utf-8')
      return cached
    }
    const text = await metricsService.getPrometheusText()
    fastify.cache.set('metrics:prometheus', text, 10)
    reply.type('text/plain; version=0.0.4; charset=utf-8')
    return text
  })

  // GET /metrics/snapshot — JSON snapshot
  fastify.get('/snapshot', {
    schema: {
      tags: ['Metrics'],
      summary: 'JSON snapshot of current system and container metrics',
      response: {
        200: {
          type: 'object',
          properties: {
            cpu: {
              type: 'object',
              properties: {
                usage_percent: { type: 'number' },
                cores: { type: 'number' },
                load_avg: { type: 'array', items: { type: 'number' } },
              },
            },
            memory: {
              type: 'object',
              properties: {
                total_bytes: { type: 'number' },
                used_percent: { type: 'number' },
              },
            },
            disk: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  mountpoint: { type: 'string' },
                  use_percent: { type: 'number' },
                },
              },
            },
            containers: {
              type: 'object',
              properties: {
                running: { type: 'number' },
                stopped: { type: 'number' },
                paused: { type: 'number' },
              },
            },
            ssh_jobs: {
              type: 'object',
              properties: {
                total: { type: 'number' },
                success: { type: 'number' },
                error: { type: 'number' },
              },
            },
            timestamp: { type: 'string' },
          },
        },
      },
    },
  }, async (_request, reply) => {
    const cached = fastify.cache.get('metrics:snapshot')
    if (cached) return cached
    const snapshot = await metricsService.getMetricsSnapshot()
    fastify.cache.set('metrics:snapshot', snapshot, 10)
    return snapshot
  })
}

export default metricsRoutes
