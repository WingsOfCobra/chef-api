import { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import * as cronService from '../services/cron.service'
import * as scheduler from '../services/cron-scheduler'

const createJobSchema = z.object({
  name: z.string().min(1).max(100),
  schedule: z.string().min(1).optional(),
  type: z.enum(['ssh', 'http']).optional(),
  config: z.record(z.unknown()).optional(),
  preset: z.enum(['disk-check', 'git-pull', 'container-health-ping']).optional(),
  enabled: z.boolean().default(true),
}).refine(data => data.preset || (data.schedule && data.type && data.config), {
  message: 'Either preset or schedule+type+config must be provided',
})

const cronJobSchema = {
  type: 'object',
  properties: {
    id: { type: 'number' },
    name: { type: 'string' },
    schedule: { type: 'string' },
    type: { type: 'string' },
    config: { type: 'object', additionalProperties: true },
    enabled: { type: 'number' },
    preset: { type: ['string', 'null'] },
    last_run_at: { type: ['string', 'null'] },
    last_run_status: { type: ['string', 'null'] },
    created_at: { type: 'string' },
    updated_at: { type: 'string' },
    nextRun: { type: ['string', 'null'] },
  },
} as const

const cronHistorySchema = {
  type: 'object',
  properties: {
    id: { type: 'number' },
    job_id: { type: 'number' },
    status: { type: 'string' },
    exit_code: { type: ['number', 'null'] },
    stdout: { type: ['string', 'null'] },
    stderr: { type: ['string', 'null'] },
    duration_ms: { type: ['number', 'null'] },
    created_at: { type: 'string' },
  },
} as const

const errorResponse = {
  type: 'object',
  properties: {
    error: { type: 'string' },
  },
} as const

const cronRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /cron/jobs — list all scheduled jobs with next run time
  fastify.get('/jobs', {
    schema: {
      tags: ['Cron'],
      summary: 'List all cron jobs',
      description: 'Returns all scheduled cron jobs with their parsed config and next run time.',
      response: {
        200: { type: 'array', items: cronJobSchema },
      },
    },
  }, async () => {
    const cacheKey = 'cron:jobs'
    const cached = fastify.cache.get(cacheKey)
    if (cached) return cached

    const jobs = cronService.listJobs()
    const result = jobs.map((job) => ({
      ...job,
      config: JSON.parse(job.config),
      nextRun: job.enabled ? scheduler.getNextRun(job.id)?.toISOString() ?? null : null,
    }))

    fastify.cache.set(cacheKey, result, 10)
    return result
  })

  // POST /cron/jobs — create a cron job
  fastify.post('/jobs', {
    schema: {
      tags: ['Cron'],
      summary: 'Create a cron job',
      description: 'Creates a new cron job from a preset or custom schedule+type+config.',
      response: {
        201: cronJobSchema,
      },
    },
  }, async (request, reply) => {
    const body = createJobSchema.parse(request.body)

    const job = cronService.createJob({
      name: body.name,
      schedule: body.schedule,
      type: body.type,
      config: body.config as cronService.CronJobConfig,
      preset: body.preset,
      enabled: body.enabled,
    })

    // Add to live scheduler
    scheduler.addToScheduler(job)

    // Invalidate cache
    fastify.cache.delPattern('cron:%')

    reply.code(201)
    return {
      ...job,
      config: JSON.parse(job.config),
      nextRun: job.enabled ? scheduler.getNextRun(job.id)?.toISOString() ?? null : null,
    }
  })

  // PATCH /cron/jobs/:id — update a job
  fastify.patch<{ Params: { id: string } }>('/jobs/:id', {
    schema: {
      tags: ['Cron'],
      summary: 'Update a cron job',
      description: 'Updates an existing cron job. Accepts partial updates for name, schedule, enabled, or config fields.',
      params: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
      body: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          schedule: { type: 'string' },
          enabled: { type: 'boolean' },
          config: { type: 'object', additionalProperties: true },
        },
      },
      response: {
        200: cronJobSchema,
        404: errorResponse,
      },
    },
  }, async (request, reply) => {
    const id = parseInt(request.params.id, 10)
    const body = request.body as { name?: string; schedule?: string; enabled?: boolean; config?: Record<string, unknown> }

    const updated = cronService.updateJob(id, body)
    if (!updated) {
      reply.code(404)
      return { error: 'Not found' }
    }

    // Remove from scheduler and re-add with updated config
    scheduler.removeFromScheduler(id)
    scheduler.addToScheduler(updated)

    // Invalidate cache
    fastify.cache.delPattern('cron:%')

    return {
      ...updated,
      config: JSON.parse(updated.config),
      nextRun: updated.enabled ? scheduler.getNextRun(updated.id)?.toISOString() ?? null : null,
    }
  })

  // DELETE /cron/jobs/:id — remove a job
  fastify.delete<{ Params: { id: string } }>('/jobs/:id', {
    schema: {
      tags: ['Cron'],
      summary: 'Delete a cron job',
      description: 'Removes a cron job by ID and stops its scheduler.',
      params: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
      response: {
        204: { type: 'null', description: 'Job deleted successfully' },
        404: errorResponse,
      },
    },
  }, async (request, reply) => {
    const id = parseInt(request.params.id, 10)

    const deleted = cronService.deleteJob(id)
    if (!deleted) {
      reply.code(404)
      return { error: 'Not found' }
    }

    scheduler.removeFromScheduler(id)
    fastify.cache.delPattern('cron:%')

    reply.code(204)
  })

  // POST /cron/jobs/:id/run — trigger job immediately
  fastify.post<{ Params: { id: string } }>('/jobs/:id/run', {
    schema: {
      tags: ['Cron'],
      summary: 'Manually trigger a cron job',
      description: 'Executes a cron job immediately regardless of its schedule and returns the execution result.',
      params: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
      response: {
        200: cronHistorySchema,
        404: errorResponse,
      },
    },
  }, async (request, reply) => {
    const id = parseInt(request.params.id, 10)

    const job = cronService.getJob(id)
    if (!job) {
      reply.code(404)
      return { error: 'Not found' }
    }

    const result = await cronService.executeJob(job)
    fastify.cache.delPattern('cron:%')

    return result
  })

  // GET /cron/jobs/:id/history — last N run results
  fastify.get<{ Params: { id: string } }>('/jobs/:id/history', {
    schema: {
      tags: ['Cron'],
      summary: 'Get job execution history',
      description: 'Returns the last N execution results for a cron job. Accepts optional "limit" query parameter (default 20).',
      params: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
      querystring: {
        type: 'object',
        properties: { limit: { type: 'string' } },
      },
      response: {
        200: { type: 'array', items: cronHistorySchema },
      },
    },
  }, async (request) => {
    const id = parseInt(request.params.id, 10)
    const query = request.query as { limit?: string }
    const limit = query.limit ? parseInt(query.limit, 10) : 20

    const job = cronService.getJob(id)
    if (!job) {
      return { error: 'Not found' }
    }

    return cronService.getJobHistory(id, limit)
  })

  // GET /cron/presets — list available presets
  fastify.get('/presets', {
    schema: {
      tags: ['Cron'],
      summary: 'List available job presets',
      description: 'Returns the available cron job presets with their default schedule, type, and config.',
      response: {
        200: {
          type: 'object',
          additionalProperties: {
            type: 'object',
            properties: {
              schedule: { type: 'string' },
              type: { type: 'string' },
              config: { type: 'object', additionalProperties: true },
            },
          },
        },
      },
    },
  }, async () => {
    return cronService.getPresets()
  })

  // GET /cron/health — scheduler health check
  fastify.get('/health', {
    schema: {
      tags: ['Cron'],
      summary: 'Scheduler health check',
      description: 'Returns scheduler status including counts of scheduled, enabled, and disabled jobs with their next run times.',
      response: {
        200: {
          type: 'object',
          properties: {
            schedulerActive: { type: 'boolean' },
            scheduledJobs: { type: 'number' },
            totalJobs: { type: 'number' },
            enabledJobs: { type: 'number' },
            disabledJobs: { type: 'number' },
            jobs: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'number' },
                  name: { type: 'string' },
                  enabled: { type: 'number' },
                  schedule: { type: 'string' },
                  type: { type: 'string' },
                  nextRun: { type: ['string', 'null'] },
                  lastRun: { type: ['string', 'null'] },
                  lastStatus: { type: ['string', 'null'] },
                },
              },
            },
          },
        },
      },
    },
  }, async () => {
    const jobs = cronService.listJobs()
    return {
      schedulerActive: true,
      scheduledJobs: scheduler.getScheduledCount(),
      totalJobs: jobs.length,
      enabledJobs: jobs.filter(j => j.enabled).length,
      disabledJobs: jobs.filter(j => !j.enabled).length,
      jobs: jobs.map(j => ({
        id: j.id,
        name: j.name,
        enabled: j.enabled,
        schedule: j.schedule,
        type: j.type,
        nextRun: j.enabled ? scheduler.getNextRun(j.id)?.toISOString() ?? null : null,
        lastRun: j.last_run_at,
        lastStatus: j.last_run_status,
      })),
    }
  })
}

export default cronRoutes
