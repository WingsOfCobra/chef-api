import { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import * as hooksService from '../services/hooks.service'
import { config } from '../config'

const agentEventSchema = z.object({
  eventType: z.string().min(1),
  source: z.string().optional(),
  payload: z.unknown(),
})

const notifySchema = z.object({
  channel: z.enum(['telegram', 'discord']),
  message: z.string().min(1),
})

const alertmanagerAlertSchema = z.object({
  status: z.string(),
  labels: z.record(z.string()),
  annotations: z.record(z.string()),
  startsAt: z.string(),
  endsAt: z.string(),
})

const alertmanagerWebhookSchema = z.object({
  version: z.string(),
  status: z.string(),
  groupKey: z.string(),
  receiver: z.string(),
  groupLabels: z.record(z.string()),
  commonLabels: z.record(z.string()),
  commonAnnotations: z.record(z.string()),
  alerts: z.array(alertmanagerAlertSchema),
})

const hookEventSchema = {
  type: 'object',
  properties: {
    id: { type: 'number' },
    event_type: { type: 'string' },
    source: { type: ['string', 'null'] },
    payload: { type: ['object', 'array', 'string', 'number', 'boolean', 'null'] },
    created_at: { type: 'string' },
  },
  additionalProperties: true,
} as const

const errorResponse = {
  type: 'object',
  properties: {
    error: { type: 'string' },
    hint: { type: 'string' },
  },
} as const

const hooksRoutes: FastifyPluginAsync = async (fastify) => {
  // POST /hooks/agent-event — receive events from OpenClaw agents (webhook secret auth, not API key)
  fastify.post('/agent-event', {
    schema: {
      tags: ['Hooks'],
      summary: 'Receive agent webhook event',
      description: 'Receives events from OpenClaw agents. Authenticated via HMAC-SHA256 signature in X-Webhook-Signature header, not API key.',
      response: {
        201: hookEventSchema,
        401: errorResponse,
        503: errorResponse,
      },
    },
  }, async (request, reply) => {
    // Require webhook secret to be configured — endpoint is exempt from API key auth
    if (!config.webhookSecret) {
      reply.code(503)
      return { error: 'Webhook endpoint not configured', hint: 'Set WEBHOOK_SECRET in .env' }
    }

    const signature = request.headers['x-webhook-signature'] as string | undefined
    if (!signature) {
      reply.code(401)
      return { error: 'Missing X-Webhook-Signature header' }
    }

    const rawBody = JSON.stringify(request.body)
    if (!hooksService.verifySignature(rawBody, signature, config.webhookSecret)) {
      reply.code(401)
      return { error: 'Invalid webhook signature' }
    }

    const body = agentEventSchema.parse(request.body)
    const event = hooksService.storeEvent({
      eventType: body.eventType,
      source: body.source,
      payload: body.payload ?? null,
    })

    reply.code(201)
    return { ...event, payload: JSON.parse(event.payload) }
  })

  // GET /hooks/events — list recent events (paginated)
  fastify.get('/events', {
    schema: {
      tags: ['Hooks'],
      summary: 'List recent webhook events',
      description: 'Returns a paginated list of recent webhook events. Supports filtering by eventType and pagination via page/limit query parameters.',
      querystring: {
        type: 'object',
        properties: {
          page: { type: 'string' },
          limit: { type: 'string' },
          eventType: { type: 'string' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            events: { type: 'array', items: hookEventSchema },
            total: { type: 'number' },
            page: { type: 'number' },
            limit: { type: 'number' },
          },
        },
      },
    },
  }, async (request) => {
    const query = request.query as { page?: string; limit?: string; eventType?: string }

    return hooksService.listEvents({
      page: query.page ? parseInt(query.page, 10) : undefined,
      limit: query.limit ? parseInt(query.limit, 10) : undefined,
      eventType: query.eventType,
    })
  })

  // POST /hooks/notify — send notification to Telegram/Discord
  fastify.post('/notify', {
    schema: {
      tags: ['Hooks'],
      summary: 'Send a notification',
      description: 'Sends a notification message to the specified channel (telegram or discord).',
      response: {
        200: {
          type: 'object',
          properties: {
            sent: { type: 'boolean' },
            channel: { type: 'string' },
          },
        },
      },
    },
  }, async (request, reply) => {
    const body = notifySchema.parse(request.body)

    await hooksService.sendNotification(body.channel, body.message)

    return { sent: true, channel: body.channel }
  })

  // POST /hooks/alertmanager — receive Alertmanager webhook and forward to Nextcloud Talk
  fastify.post('/alertmanager', {
    schema: {
      tags: ['Hooks'],
      summary: 'Receive Alertmanager webhook',
      description: 'Receives Alertmanager webhook payload and forwards formatted message to Nextcloud Talk. Optional HMAC-SHA256 signature verification via X-Webhook-Signature header if WEBHOOK_SECRET is configured.',
      body: {
        type: 'object',
        properties: {
          version: { type: 'string' },
          status: { type: 'string' },
          groupKey: { type: 'string' },
          receiver: { type: 'string' },
          groupLabels: { type: 'object', additionalProperties: { type: 'string' } },
          commonLabels: { type: 'object', additionalProperties: { type: 'string' } },
          commonAnnotations: { type: 'object', additionalProperties: { type: 'string' } },
          alerts: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                status: { type: 'string' },
                labels: { type: 'object', additionalProperties: { type: 'string' } },
                annotations: { type: 'object', additionalProperties: { type: 'string' } },
                startsAt: { type: 'string' },
                endsAt: { type: 'string' },
              },
            },
          },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            ok: { type: 'boolean' },
          },
        },
        401: errorResponse,
      },
    },
  }, async (request, reply) => {
    // Optional HMAC signature verification (if webhook secret is set)
    if (config.webhookSecret) {
      const signature = request.headers['x-webhook-signature'] as string | undefined
      if (!signature) {
        reply.code(401)
        return { error: 'Missing X-Webhook-Signature header' }
      }

      const rawBody = JSON.stringify(request.body)
      if (!hooksService.verifySignature(rawBody, signature, config.webhookSecret)) {
        reply.code(401)
        return { error: 'Invalid webhook signature' }
      }
    }

    try {
      const body = alertmanagerWebhookSchema.parse(request.body)
      const message = hooksService.formatAlertmanagerMessage(body)
      await hooksService.sendToNextcloudTalk(message)

      return { ok: true }
    } catch (error) {
      // Log errors but always return success (alertmanager will retry otherwise)
      fastify.log.error({ error }, 'Alertmanager webhook error')
      return { ok: true }
    }
  })
}

export default hooksRoutes
