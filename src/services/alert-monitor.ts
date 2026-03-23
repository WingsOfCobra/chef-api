import { db, CronJob } from '../db'
import * as docker from './docker.service'
import * as alerts from './alerts.service'

export async function checkCronFailures(): Promise<void> {
  // Get all cron jobs with failed status
  const failedJobs = db
    .prepare("SELECT * FROM cron_jobs WHERE last_run_status = 'failed' AND enabled = 1")
    .all() as CronJob[]

  if (failedJobs.length === 0) return

  // Get all cron_job_failure alert rules
  const rules = alerts.listEnabledRules().filter((r) => r.type === 'cron_job_failure')

  for (const rule of rules) {
    for (const job of failedJobs) {
      // If rule has a target, only fire for matching job name
      if (rule.target && rule.target !== job.name) continue

      const payload = alerts.buildPayload(rule, null)
      payload.target = job.name

      try {
        await alerts.fireWebhook(rule, payload)
      } catch (err) {
        console.error(`Failed to fire cron_job_failure alert for ${job.name}:`, err)
      }
    }
  }
}

export async function checkContainerExits(): Promise<void> {
  try {
    // List all containers
    const containers = await docker.listContainers()

    // Find containers in exited or dead state
    const exitedContainers = containers.filter(
      (c) => c.state === 'exited' || c.state === 'dead'
    )

    if (exitedContainers.length === 0) return

    // Get all container_exit alert rules
    const rules = alerts.listEnabledRules().filter((r) => r.type === 'container_exit')

    for (const rule of rules) {
      for (const container of exitedContainers) {
        // If rule has a target, only fire for matching container name
        if (rule.target && rule.target !== container.name) continue

        const payload = alerts.buildPayload(rule, null)
        payload.target = container.name

        try {
          await alerts.fireWebhook(rule, payload)
        } catch (err) {
          console.error(`Failed to fire container_exit alert for ${container.name}:`, err)
        }
      }
    }
  } catch (err) {
    console.error('Failed to check container exits:', err)
  }
}
