import { db, CronJob, CronHistory } from '../db'
import { config } from '../config'
import * as ssh from './ssh.service'
import axios from 'axios'
import { exec as execCb } from 'child_process'
import { promisify } from 'util'
const execAsync = promisify(execCb)

export interface CronJobConfig {
  // SSH type
  host?: string
  command?: string
  // HTTP type
  url?: string
  method?: string
  headers?: Record<string, string>
  body?: string
}

export interface CreateJobInput {
  name: string
  schedule?: string
  type?: 'ssh' | 'http'
  config?: CronJobConfig
  preset?: string
  enabled?: boolean
}

export interface CronJobWithNextRun extends Omit<CronJob, 'config'> {
  config: CronJobConfig
  nextRun: string | null
}

const PRESETS: Record<string, { schedule: string; type: 'ssh' | 'http'; config: CronJobConfig }> = {
  'disk-check': {
    schedule: '0 */6 * * *',
    type: 'ssh',
    config: { host: 'localhost', command: 'df -h' },
  },
  'git-pull': {
    schedule: '*/30 * * * *',
    type: 'ssh',
    config: { host: 'localhost', command: 'cd /workspace && git pull' },
  },
  'container-health-ping': {
    schedule: '*/5 * * * *',
    type: 'http',
    config: { url: 'http://localhost:4242/system/health', method: 'GET' },
  },
}

export function getPresets(): Record<string, { schedule: string; type: string; config: CronJobConfig }> {
  return PRESETS
}

export function listJobs(): CronJob[] {
  return db.prepare('SELECT * FROM cron_jobs ORDER BY created_at DESC').all() as CronJob[]
}

export function getJob(id: number): CronJob | undefined {
  return db.prepare('SELECT * FROM cron_jobs WHERE id = ?').get(id) as CronJob | undefined
}

export function createJob(input: CreateJobInput): CronJob {
  let schedule: string
  let type: 'ssh' | 'http'
  let jobConfig: CronJobConfig

  if (input.preset) {
    const preset = PRESETS[input.preset]
    if (!preset) {
      throw new Error(`Unknown preset: ${input.preset}. Available: ${Object.keys(PRESETS).join(', ')}`)
    }
    schedule = input.schedule ?? preset.schedule
    type = input.type ?? preset.type
    jobConfig = input.config ?? preset.config
  } else {
    if (!input.schedule || !input.type || !input.config) {
      throw new Error('Either preset or schedule+type+config must be provided')
    }
    schedule = input.schedule
    type = input.type
    jobConfig = input.config
  }

  const result = db.prepare(
    `INSERT INTO cron_jobs (name, schedule, type, config, enabled, preset)
     VALUES (?, ?, ?, ?, ?, ?) RETURNING *`
  ).get(
    input.name,
    schedule,
    type,
    JSON.stringify(jobConfig),
    input.enabled !== false ? 1 : 0,
    input.preset ?? null,
  ) as CronJob

  return result
}

export function deleteJob(id: number): boolean {
  const result = db.prepare('DELETE FROM cron_jobs WHERE id = ?').run(id)
  return result.changes > 0
}

export function updateLastRun(id: number, status: string): void {
  db.prepare(
    `UPDATE cron_jobs SET last_run_at = datetime('now'), last_run_status = ?, updated_at = datetime('now')
     WHERE id = ?`
  ).run(status, id)
}

export async function executeJob(job: CronJob): Promise<CronHistory> {
  const jobConfig: CronJobConfig = JSON.parse(job.config)
  const startTime = Date.now()

  let status = 'success'
  let exitCode: number | null = null
  let stdout: string | null = null
  let stderr: string | null = null

  try {
    if (job.type === 'ssh') {
      if (!jobConfig.command) {
        throw new Error('SSH job requires command in config')
      }
      const isLocal = !jobConfig.host || jobConfig.host === 'localhost' || jobConfig.host === '127.0.0.1'
      if (isLocal) {
        // Remap workspace path and replace `bash` with `sh` (Alpine container has no bash)
        let cmd = (jobConfig.command ?? '')
          .replace(/\/home\/anian\/.openclaw\/workspace\//g, '/workspace/')
          .replace(/^bash /, 'sh ')
          .replace(/ && bash /g, ' && sh ')
          .replace(/; bash /g, '; sh ')
        // If command is a bare script path (starts with /), prefix with sh
        if (/^\/\S+\.sh/.test(cmd)) {
          cmd = `sh ${cmd}`
        }
        try {
          const result = await execAsync(cmd, { timeout: 60000, shell: '/bin/sh' })
          stdout = result.stdout
          stderr = result.stderr
          exitCode = 0
          status = 'success'
        } catch (err: any) {
          stdout = err.stdout ?? null
          stderr = err.stderr ?? err.message ?? String(err)
          exitCode = err.code ?? 1
          status = 'failed'
        }
      } else {
        const result = await ssh.runCommand(jobConfig.host!, jobConfig.command!)
        stdout = result.stdout
        stderr = result.stderr
        exitCode = result.code
        status = (exitCode === 0) ? 'success' : 'failed'
      }
    } else if (job.type === 'http') {
      if (!jobConfig.url) {
        throw new Error('HTTP job requires url in config')
      }
      const response = await axios({
        url: jobConfig.url,
        method: (jobConfig.method ?? 'GET') as any,
        headers: jobConfig.headers,
        data: jobConfig.body,
        timeout: 30000,
        validateStatus: () => true,
      })
      stdout = JSON.stringify({ status: response.status, data: response.data })
      exitCode = response.status >= 200 && response.status < 400 ? 0 : 1
      status = exitCode === 0 ? 'success' : 'failed'
    }
  } catch (err: any) {
    status = 'error'
    stderr = err.message ?? String(err)
  }

  const durationMs = Date.now() - startTime

  const history = db.prepare(
    `INSERT INTO cron_history (job_id, status, exit_code, stdout, stderr, duration_ms)
     VALUES (?, ?, ?, ?, ?, ?) RETURNING *`
  ).get(job.id, status, exitCode, stdout, stderr, durationMs) as CronHistory

  updateLastRun(job.id, status)

  // Also log to job_history for consistency with SSH routes
  db.prepare(
    `INSERT INTO job_history (type, target, command, status, output)
     VALUES ('cron', ?, ?, ?, ?)`
  ).run(
    job.name,
    job.type === 'ssh' ? (JSON.parse(job.config) as CronJobConfig).command ?? null : (JSON.parse(job.config) as CronJobConfig).url ?? null,
    status,
    JSON.stringify({ stdout, stderr, exitCode, durationMs }),
  )

  return history
}

export function getJobHistory(jobId: number, limit = 20): CronHistory[] {
  return db.prepare(
    'SELECT * FROM cron_history WHERE job_id = ? ORDER BY created_at DESC LIMIT ?'
  ).all(jobId, limit) as CronHistory[]
}
