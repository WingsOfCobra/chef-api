import { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { config } from '../config'
import * as ansibleService from '../services/ansible.service'

const errorResponse = {
  type: 'object',
  properties: {
    error: { type: 'string' },
    hint: { type: 'string' },
  },
} as const

const ansibleJobResponseSchema = {
  type: 'object',
  properties: {
    id: { type: 'number' },
    playbook: { type: 'string' },
    status: { type: 'string' },
    output: { type: ['string', 'null'] },
    exit_code: { type: ['number', 'null'] },
    started_at: { type: ['string', 'null'] },
    finished_at: { type: ['string', 'null'] },
    created_at: { type: 'string' },
  },
} as const

const limitQuerySchema = z.object({
  limit: z.coerce.number().min(1).max(100).default(20),
})

const ansibleRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /ansible/playbooks
  fastify.get('/playbooks', {
    schema: {
      tags: ['Ansible'],
      summary: 'List available playbooks',
      description: 'Lists .yml/.yaml files in the configured playbook directory. Returns 503 if not configured.',
      response: {
        200: {
          type: 'object',
          properties: {
            playbooks: { type: 'array', items: { type: 'string' } },
          },
        },
        503: errorResponse,
      },
    },
  }, async (_request, reply) => {
    if (!config.ansiblePlaybookDir) {
      reply.code(503)
      return { error: 'Ansible not configured', hint: 'Set ANSIBLE_PLAYBOOK_DIR in .env' }
    }

    const cacheKey = 'ansible:playbooks'
    const cached = fastify.cache.get(cacheKey)
    if (cached) return cached

    const playbooks = ansibleService.listPlaybooks()
    const result = { playbooks }
    fastify.cache.set(cacheKey, result, 30)
    return result
  })

  // POST /ansible/playbooks/:name/run
  fastify.post('/playbooks/:name/run', {
    schema: {
      tags: ['Ansible'],
      summary: 'Run a playbook',
      description: 'Starts an ansible-playbook execution asynchronously. Returns the job immediately with a pending/running status.',
      params: {
        type: 'object',
        properties: {
          name: { type: 'string' },
        },
        required: ['name'],
      },
      response: {
        202: ansibleJobResponseSchema,
        404: errorResponse,
        503: errorResponse,
      },
    },
  }, async (request, reply) => {
    if (!config.ansiblePlaybookDir) {
      reply.code(503)
      return { error: 'Ansible not configured', hint: 'Set ANSIBLE_PLAYBOOK_DIR in .env' }
    }

    const { name } = request.params as { name: string }

    if (!ansibleService.playbookExists(name)) {
      reply.code(404)
      return { error: `Playbook '${name}' not found` }
    }

    const job = ansibleService.runPlaybook(name)
    fastify.cache.delPattern('ansible:%')
    reply.code(202)
    return job
  })

  // GET /ansible/jobs/:id
  fastify.get('/jobs/:id', {
    schema: {
      tags: ['Ansible'],
      summary: 'Get job status',
      description: 'Returns the status and output of a specific ansible job.',
      params: {
        type: 'object',
        properties: {
          id: { type: 'string' },
        },
        required: ['id'],
      },
      response: {
        200: ansibleJobResponseSchema,
        404: errorResponse,
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const job = ansibleService.getJob(Number(id))
    if (!job) {
      reply.code(404)
      return { error: 'Job not found' }
    }
    return job
  })

  // GET /ansible/jobs
  fastify.get('/jobs', {
    schema: {
      tags: ['Ansible'],
      summary: 'List recent jobs',
      description: 'Returns a list of recent ansible jobs, ordered by creation date.',
      querystring: {
        type: 'object',
        properties: {
          limit: { type: 'string' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            jobs: { type: 'array', items: ansibleJobResponseSchema },
          },
        },
      },
    },
  }, async (request) => {
    const query = request.query as { limit?: string }
    const parsed = limitQuerySchema.parse({ limit: query.limit ?? 20 })
    const jobs = ansibleService.listJobs(parsed.limit)
    return { jobs }
  })

  // GET /ansible/inventory
  fastify.get('/inventory', {
    schema: {
      tags: ['Ansible'],
      summary: 'Show current inventory',
      description: 'Returns the contents of the configured Ansible inventory file. Returns 503 if not configured.',
      response: {
        200: {
          type: 'object',
          properties: {
            inventory: { type: 'string' },
          },
        },
        503: errorResponse,
      },
    },
  }, async (_request, reply) => {
    if (!config.ansibleInventory) {
      reply.code(503)
      return { error: 'Ansible inventory not configured', hint: 'Set ANSIBLE_INVENTORY in .env' }
    }

    const cacheKey = 'ansible:inventory'
    const cached = fastify.cache.get(cacheKey)
    if (cached) return cached

    const inventory = ansibleService.getInventory()
    const result = { inventory }
    fastify.cache.set(cacheKey, result, 60)
    return result
  })
}

export default ansibleRoutes
