import { Cron } from 'croner'
import { config } from '../config'
import { CronJob } from '../db'
import * as cronService from './cron.service'

const scheduledJobs = new Map<number, Cron>()

// Logger will be injected by initScheduler
let logger: any = console

export function addToScheduler(job: CronJob): void {
  // Remove existing if any
  removeFromScheduler(job.id)

  if (!job.enabled) {
    logger.debug({ jobId: job.id, jobName: job.name }, 'Skipping disabled cron job')
    return
  }

  const cronInstance = new Cron(job.schedule, {
    timezone: config.cronTimezone,
  }, async () => {
    const startTime = Date.now()
    logger.info({ jobId: job.id, jobName: job.name }, '[CRON] Executing job')
    
    try {
      // Re-fetch to get latest state
      const current = cronService.getJob(job.id)
      if (!current || !current.enabled) {
        logger.warn({ jobId: job.id }, '[CRON] Job disabled or deleted, removing from scheduler')
        removeFromScheduler(job.id)
        return
      }
      
      const result = await cronService.executeJob(current)
      const duration = Date.now() - startTime
      
      if (result.stdout) {
        logger.info({
          jobId: job.id,
          jobName: job.name,
          output: result.stdout.substring(0, 10000) // Limit to 10KB
        }, '[CRON] Job stdout')
      }
      
      if (result.stderr) {
        logger.warn({
          jobId: job.id,
          jobName: job.name,
          error: result.stderr.substring(0, 10000) // Limit to 10KB
        }, '[CRON] Job stderr')
      }
      
      logger.info({
        jobId: job.id,
        jobName: job.name,
        status: result.status,
        exitCode: result.exit_code,
        durationMs: duration
      }, `[CRON] Job completed: ${result.status}`)
    } catch (err) {
      const duration = Date.now() - startTime
      logger.error({
        jobId: job.id,
        jobName: job.name,
        durationMs: duration,
        error: err
      }, '[CRON] Job execution failed')
    }
  })

  scheduledJobs.set(job.id, cronInstance)
  const nextRun = cronInstance.nextRun()
  logger.info({
    jobId: job.id,
    jobName: job.name,
    schedule: job.schedule,
    nextRun: nextRun?.toISOString() ?? null
  }, '[CRON] Job scheduled')
}

export function removeFromScheduler(jobId: number): void {
  const existing = scheduledJobs.get(jobId)
  if (existing) {
    existing.stop()
    scheduledJobs.delete(jobId)
    logger.debug({ jobId }, '[CRON] Job removed from scheduler')
  }
}

export function getNextRun(jobId: number): Date | null {
  const cronInstance = scheduledJobs.get(jobId)
  if (!cronInstance) return null
  return cronInstance.nextRun() ?? null
}

export function initScheduler(fastifyLogger?: any): void {
  // Use Fastify logger if provided, otherwise console
  if (fastifyLogger) {
    logger = fastifyLogger
  }
  
  logger.info('[CRON] Initializing cron scheduler...')
  
  // Stop all existing jobs
  for (const [id] of scheduledJobs) {
    removeFromScheduler(id)
  }

  const jobs = cronService.listJobs()
  logger.info({ totalJobs: jobs.length, enabledJobs: jobs.filter(j => j.enabled).length }, '[CRON] Loading jobs from database')
  
  for (const job of jobs) {
    if (job.enabled) {
      addToScheduler(job)
    } else {
      logger.debug({ jobId: job.id, jobName: job.name }, '[CRON] Skipping disabled job')
    }
  }
  
  logger.info({ scheduledCount: scheduledJobs.size }, '[CRON] ✓ Scheduler initialized')
}

export function getScheduledCount(): number {
  return scheduledJobs.size
}
