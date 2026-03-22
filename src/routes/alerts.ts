import { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import * as alertsService from '../services/alerts.service'

const alertTypeEnum = z.enum([
  'container_stopped',
  'disk_usage',
  'memory_usage',
  'cron_failure',
  'github_ci_failure',
])

const createRuleSchema = z.object({
  name: z.string().min(1),
  type: alertTypeEnum,
  target: z.string().optional(),
  threshold: z.number().optional(),
  webhook_url: z.string().url(),
})

const updateRuleSchema = z.object({
  name: z.string().min(1).optional(),
  target: z.string().optional(),
  threshold: z.number().optional(),
  webhook_url: z.string().url().optional(),
  enabled: z.boolean().optional(),
})

const alertRuleResponseSchema = {
  type: 'object',
  properties: {
    id: { type: 'number' },
    name: { type: 'string' },
    type: { type: 'string' },
    target: { type: ['string', 'null'] },
    threshold: { type: ['number', 'null'] },
    webhook_url: { type: 'string' },
    enabled: { type: 'number' },
    created_at: { type: 'string' },
    updated_at: { type: 'string' },
  },
} as const

const alertEventResponseSchema = {
  type: 'object',
  properties: {
    id: { type: 'number' },
    rule_id: { type: 'number' },
    triggered_at: { type: 'string' },
    payload: { type: ['string', 'null'] },
    delivered: { type: 'number' },
    attempts: { type: 'number' },
    last_error: { type: ['string', 'null'] },
  },
} as const

const alertsRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /alerts/rules
  fastify.get('/rules', {
    schema: {
      tags: ['Alerts'],
      summary: 'List all alert rules',
      response: {
        200: {
          type: 'array',
          items: alertRuleResponseSchema,
        },
      },
    },
  }, async (_request, reply) => {
    const cached = fastify.cache.get('alert_rules')
    if (cached) return cached

    const rules = alertsService.listRules()
    fastify.cache.set('alert_rules', rules, 5)
    return rules
  })

  // POST /alerts/rules
  fastify.post('/rules', {
    schema: {
      tags: ['Alerts'],
      summary: 'Create an alert rule',
      response: {
        201: alertRuleResponseSchema,
      },
    },
  }, async (request, reply) => {
    const body = createRuleSchema.parse(request.body)
    const rule = alertsService.createRule(body)
    fastify.cache.delPattern('alert_rules%')
    reply.code(201)
    return rule
  })

  // PATCH /alerts/rules/:id
  fastify.patch('/rules/:id', {
    schema: {
      tags: ['Alerts'],
      summary: 'Update or enable/disable an alert rule',
      response: {
        200: alertRuleResponseSchema,
        404: { type: 'object', properties: { error: { type: 'string' } } },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const body = updateRuleSchema.parse(request.body)
    const rule = alertsService.updateRule(Number(id), body)
    if (!rule) {
      reply.code(404)
      return { error: 'Rule not found' }
    }
    fastify.cache.delPattern('alert_rules%')
    return rule
  })

  // DELETE /alerts/rules/:id
  fastify.delete('/rules/:id', {
    schema: {
      tags: ['Alerts'],
      summary: 'Delete an alert rule',
      response: {
        204: { type: 'null', description: 'Rule deleted' },
        404: { type: 'object', properties: { error: { type: 'string' } } },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const deleted = alertsService.deleteRule(Number(id))
    if (!deleted) {
      reply.code(404)
      return { error: 'Rule not found' }
    }
    fastify.cache.delPattern('alert_rules%')
    reply.code(204)
    return null
  })

  // GET /alerts/events
  fastify.get('/events', {
    schema: {
      tags: ['Alerts'],
      summary: 'List recent alert events',
      querystring: {
        type: 'object',
        properties: {
          limit: { type: 'string' },
          offset: { type: 'string' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            events: { type: 'array', items: alertEventResponseSchema },
            total: { type: 'number' },
          },
        },
      },
    },
  }, async (request) => {
    const query = request.query as { limit?: string; offset?: string }
    return alertsService.listEvents({
      limit: query.limit ? parseInt(query.limit, 10) : undefined,
      offset: query.offset ? parseInt(query.offset, 10) : undefined,
    })
  })

  // POST /alerts/rules/:id/test
  fastify.post('/rules/:id/test', {
    schema: {
      tags: ['Alerts'],
      summary: 'Fire a test webhook for this rule',
      response: {
        200: alertEventResponseSchema,
        404: { type: 'object', properties: { error: { type: 'string' } } },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const rule = alertsService.getRuleById(Number(id))
    if (!rule) {
      reply.code(404)
      return { error: 'Rule not found' }
    }
    const payload = alertsService.buildPayload(rule, rule.threshold ?? 0)
    const event = await alertsService.fireWebhook(rule, payload)
    return event
  })
}

export default alertsRoutes
