import { Cron } from 'croner'
import { config } from '../config'
import { CronJob } from '../db'
import * as cronService from './cron.service'

const scheduledJobs = new Map<number, Cron>()

export function addToScheduler(job: CronJob): void {
  // Remove existing if any
  removeFromScheduler(job.id)

  if (!job.enabled) return

  const cronInstance = new Cron(job.schedule, {
    timezone: config.cronTimezone,
  }, async () => {
    try {
      // Re-fetch to get latest state
      const current = cronService.getJob(job.id)
      if (!current || !current.enabled) {
        removeFromScheduler(job.id)
        return
      }
      await cronService.executeJob(current)
    } catch (err) {
      // Execution errors are already handled in executeJob
      console.error(`Cron job ${job.id} (${job.name}) scheduler error:`, err)
    }
  })

  scheduledJobs.set(job.id, cronInstance)
}

export function removeFromScheduler(jobId: number): void {
  const existing = scheduledJobs.get(jobId)
  if (existing) {
    existing.stop()
    scheduledJobs.delete(jobId)
  }
}

export function getNextRun(jobId: number): Date | null {
  const cronInstance = scheduledJobs.get(jobId)
  if (!cronInstance) return null
  return cronInstance.nextRun() ?? null
}

export function initScheduler(): void {
  // Stop all existing jobs
  for (const [id] of scheduledJobs) {
    removeFromScheduler(id)
  }

  const jobs = cronService.listJobs()
  for (const job of jobs) {
    if (job.enabled) {
      addToScheduler(job)
    }
  }
}

export function getScheduledCount(): number {
  return scheduledJobs.size
}
