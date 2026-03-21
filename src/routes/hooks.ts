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

const hooksRoutes: FastifyPluginAsync = async (fastify) => {
  // POST /hooks/agent-event — receive events from OpenClaw agents (webhook secret auth, not API key)
  fastify.post('/agent-event', async (request, reply) => {
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
  fastify.get('/events', async (request) => {
    const query = request.query as { page?: string; limit?: string; eventType?: string }

    return hooksService.listEvents({
      page: query.page ? parseInt(query.page, 10) : undefined,
      limit: query.limit ? parseInt(query.limit, 10) : undefined,
      eventType: query.eventType,
    })
  })

  // POST /hooks/notify — send notification to Telegram/Discord
  fastify.post('/notify', async (request, reply) => {
    const body = notifySchema.parse(request.body)

    await hooksService.sendNotification(body.channel, body.message)

    return { sent: true, channel: body.channel }
  })
}

export default hooksRoutes
