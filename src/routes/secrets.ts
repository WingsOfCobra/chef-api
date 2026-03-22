import { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import * as secretsService from '../services/secrets.service'

const injectBodySchema = z.object({
  mappings: z.record(z.string(), z.string()).refine((m) => Object.keys(m).length > 0, {
    message: 'At least one mapping is required',
  }),
})

const secretSummaryResponseSchema = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      name: { type: 'string' },
    },
  },
  description: 'List of secret names and IDs only — values are never returned by this endpoint',
} as const

const secretValueResponseSchema = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    value: { type: 'string' },
  },
} as const

const injectResponseSchema = {
  type: 'object',
  additionalProperties: { type: 'string' },
  description: 'Resolved env var to secret value mappings',
} as const

const errorResponseSchema = {
  type: 'object',
  properties: {
    error: { type: 'string' },
  },
} as const

const secretsRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /secrets — list secret names (NEVER values)
  fastify.get('/', {
    schema: {
      tags: ['Secrets'],
      summary: 'List secret names from Bitwarden vault (never returns values)',
      response: {
        200: secretSummaryResponseSchema,
        503: errorResponseSchema,
      },
    },
  }, async (_request, reply) => {
    if (!secretsService.isConfigured()) {
      reply.code(503)
      return { error: 'Bitwarden not configured' }
    }

    try {
      return secretsService.listSecrets()
    } catch (err: any) {
      reply.code(500)
      return { error: err.message }
    }
  })

  // GET /secrets/:name — retrieve a secret value by name
  fastify.get('/:name', {
    schema: {
      tags: ['Secrets'],
      summary: 'Retrieve a secret value by name',
      params: {
        type: 'object',
        properties: {
          name: { type: 'string' },
        },
        required: ['name'],
      },
      response: {
        200: secretValueResponseSchema,
        404: errorResponseSchema,
        503: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    if (!secretsService.isConfigured()) {
      reply.code(503)
      return { error: 'Bitwarden not configured' }
    }

    const { name } = request.params as { name: string }

    try {
      const value = secretsService.getSecret(name)
      return { name, value }
    } catch (err: any) {
      if (err.message.includes('not found')) {
        reply.code(404)
        return { error: err.message }
      }
      reply.code(500)
      return { error: err.message }
    }
  })

  // POST /secrets/inject — inject secrets into env mappings
  fastify.post('/inject', {
    schema: {
      tags: ['Secrets'],
      summary: 'Inject secrets into env var mappings',
      response: {
        200: injectResponseSchema,
        503: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    if (!secretsService.isConfigured()) {
      reply.code(503)
      return { error: 'Bitwarden not configured' }
    }

    const body = injectBodySchema.parse(request.body)

    try {
      return secretsService.injectSecrets(body.mappings)
    } catch (err: any) {
      reply.code(500)
      return { error: err.message }
    }
  })
}

export default secretsRoutes
