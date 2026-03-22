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

const cronRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /cron/jobs — list all scheduled jobs with next run time
  fastify.get('/jobs', { schema: { tags: ['Cron'] } }, async () => {
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
  fastify.post('/jobs', { schema: { tags: ['Cron'] } }, async (request, reply) => {
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

  // DELETE /cron/jobs/:id — remove a job
  fastify.delete<{ Params: { id: string } }>('/jobs/:id', { schema: { tags: ['Cron'] } }, async (request, reply) => {
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
  fastify.post<{ Params: { id: string } }>('/jobs/:id/run', { schema: { tags: ['Cron'] } }, async (request, reply) => {
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
  fastify.get<{ Params: { id: string } }>('/jobs/:id/history', { schema: { tags: ['Cron'] } }, async (request) => {
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
  fastify.get('/presets', { schema: { tags: ['Cron'] } }, async () => {
    return cronService.getPresets()
  })

  // GET /cron/health — scheduler health check
  fastify.get('/health', { schema: { tags: ['Cron'] } }, async () => {
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
