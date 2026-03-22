import type { FastifyInstance } from 'fastify'
import { db, AlertRule } from '../db'
import { getDiskUsage, getMemoryDetail } from './system.service'
import * as alertsService from './alerts.service'

let interval: ReturnType<typeof setInterval> | null = null

export function startAlertChecker(fastify: FastifyInstance): void {
  if (interval) return
  interval = setInterval(() => runChecks(fastify), 60_000)
  fastify.log.info('Alert checker started (60s interval)')
}

export function stopAlertChecker(): void {
  if (interval) {
    clearInterval(interval)
    interval = null
  }
}

async function runChecks(fastify: FastifyInstance): Promise<void> {
  const rules = alertsService.listEnabledRules()
  if (rules.length === 0) return

  for (const rule of rules) {
    try {
      switch (rule.type) {
        case 'disk_usage':
          await checkDiskUsage(rule)
          break
        case 'memory_usage':
          await checkMemoryUsage(rule)
          break
        case 'cron_failure':
          await checkCronFailures(rule)
          break
        // TODO: container_stopped alerts will be triggered from the Docker events stream
        // once the WebSocket layer (Phase 2) is merged. For now, this is a no-op.
        case 'container_stopped':
          break
        case 'github_ci_failure':
          break
      }
    } catch (err) {
      fastify.log.error({ err, ruleId: rule.id }, 'Alert check failed')
    }
  }
}

async function checkDiskUsage(rule: AlertRule): Promise<void> {
  if (rule.threshold == null) return
  const mounts = getDiskUsage()
  for (const mount of mounts) {
    const usePct = parseFloat(mount.usePercent.replace('%', ''))
    if (isNaN(usePct)) continue
    if (rule.target && mount.mountpoint !== rule.target) continue
    if (usePct > rule.threshold) {
      const payload = alertsService.buildPayload(rule, usePct)
      payload.target = mount.mountpoint
      await alertsService.fireWebhook(rule, payload)
    }
  }
}

async function checkMemoryUsage(rule: AlertRule): Promise<void> {
  if (rule.threshold == null) return
  const mem = getMemoryDetail()
  if (mem.usedPercent > rule.threshold) {
    const payload = alertsService.buildPayload(rule, mem.usedPercent)
    await alertsService.fireWebhook(rule, payload)
  }
}

async function checkCronFailures(rule: AlertRule): Promise<void> {
  const failedJobs = db
    .prepare(
      `SELECT * FROM cron_jobs
       WHERE last_run_status = 'error'
         AND updated_at >= datetime('now', '-1 hour')
         AND enabled = 1`
    )
    .all() as Array<{ id: number; name: string }>

  for (const job of failedJobs) {
    if (rule.target && job.name !== rule.target) continue
    const payload = alertsService.buildPayload(rule, null)
    payload.target = job.name
    await alertsService.fireWebhook(rule, payload)
  }
}
