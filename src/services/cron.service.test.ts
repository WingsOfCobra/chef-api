import { vi, describe, it, expect, beforeEach } from 'vitest'
import { db } from '../db'
import * as cronService from './cron.service'

// Mock ssh.service to avoid real SSH connections
vi.mock('./ssh.service', () => ({
  runCommand: vi.fn().mockResolvedValue({ stdout: 'ok', stderr: '', code: 0 }),
}))

// Mock axios for HTTP jobs
vi.mock('axios', () => ({
  default: vi.fn().mockResolvedValue({ status: 200, data: { ok: true } }),
}))

describe('cron.service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Clean up cron tables between tests
    db.prepare('DELETE FROM cron_history').run()
    db.prepare('DELETE FROM cron_jobs').run()
  })

  describe('getPresets', () => {
    it('returns available presets', () => {
      const presets = cronService.getPresets()
      expect(presets).toHaveProperty('disk-check')
      expect(presets).toHaveProperty('git-pull')
      expect(presets).toHaveProperty('container-health-ping')
      expect(presets['disk-check'].type).toBe('ssh')
      expect(presets['container-health-ping'].type).toBe('http')
    })
  })

  describe('createJob', () => {
    it('creates a job with explicit schedule/type/config', () => {
      const job = cronService.createJob({
        name: 'test-job',
        schedule: '*/5 * * * *',
        type: 'ssh',
        config: { host: 'dev', command: 'uptime' },
      })

      expect(job.id).toBeTypeOf('number')
      expect(job.name).toBe('test-job')
      expect(job.schedule).toBe('*/5 * * * *')
      expect(job.type).toBe('ssh')
      expect(JSON.parse(job.config)).toEqual({ host: 'dev', command: 'uptime' })
      expect(job.enabled).toBe(1)
      expect(job.preset).toBeNull()
    })

    it('creates a job from a preset', () => {
      const job = cronService.createJob({
        name: 'my-disk-check',
        preset: 'disk-check',
      })

      expect(job.schedule).toBe('0 */6 * * *')
      expect(job.type).toBe('ssh')
      expect(job.preset).toBe('disk-check')
    })

    it('allows overriding preset defaults', () => {
      const job = cronService.createJob({
        name: 'custom-disk-check',
        preset: 'disk-check',
        schedule: '0 * * * *',
      })

      expect(job.schedule).toBe('0 * * * *')
      expect(job.type).toBe('ssh')
    })

    it('throws on unknown preset', () => {
      expect(() => cronService.createJob({
        name: 'bad',
        preset: 'nonexistent',
      })).toThrow('Unknown preset')
    })

    it('throws when neither preset nor full config provided', () => {
      expect(() => cronService.createJob({
        name: 'incomplete',
        schedule: '* * * * *',
      })).toThrow('Either preset or schedule+type+config must be provided')
    })

    it('enforces unique name', () => {
      cronService.createJob({ name: 'unique', preset: 'disk-check' })
      expect(() => cronService.createJob({ name: 'unique', preset: 'disk-check' })).toThrow()
    })
  })

  describe('listJobs', () => {
    it('returns all jobs', () => {
      cronService.createJob({ name: 'job-1', preset: 'disk-check' })
      cronService.createJob({ name: 'job-2', preset: 'git-pull' })

      const jobs = cronService.listJobs()
      expect(jobs).toHaveLength(2)
    })
  })

  describe('getJob', () => {
    it('returns a job by id', () => {
      const created = cronService.createJob({ name: 'find-me', preset: 'disk-check' })
      const found = cronService.getJob(created.id)

      expect(found).toBeDefined()
      expect(found!.name).toBe('find-me')
    })

    it('returns undefined for nonexistent id', () => {
      expect(cronService.getJob(999)).toBeUndefined()
    })
  })

  describe('deleteJob', () => {
    it('deletes an existing job', () => {
      const job = cronService.createJob({ name: 'to-delete', preset: 'disk-check' })
      const deleted = cronService.deleteJob(job.id)

      expect(deleted).toBe(true)
      expect(cronService.getJob(job.id)).toBeUndefined()
    })

    it('returns false for nonexistent job', () => {
      expect(cronService.deleteJob(999)).toBe(false)
    })

    it('cascades to cron_history', () => {
      const job = cronService.createJob({ name: 'cascade-test', preset: 'disk-check' })
      // Insert a fake history entry
      db.prepare(
        'INSERT INTO cron_history (job_id, status) VALUES (?, ?)'
      ).run(job.id, 'success')

      cronService.deleteJob(job.id)

      const history = db.prepare('SELECT * FROM cron_history WHERE job_id = ?').all(job.id)
      expect(history).toHaveLength(0)
    })
  })

  describe('executeJob', () => {
    it('executes an SSH job and records history', async () => {
      const job = cronService.createJob({
        name: 'exec-ssh',
        schedule: '* * * * *',
        type: 'ssh',
        config: { host: 'dev', command: 'uptime' },
      })

      const history = await cronService.executeJob(job)

      expect(history.job_id).toBe(job.id)
      expect(history.status).toBe('success')
      expect(history.stdout).toBe('ok')
      expect(history.duration_ms).toBeTypeOf('number')
    })

    it('executes an HTTP job and records history', async () => {
      const job = cronService.createJob({
        name: 'exec-http',
        schedule: '* * * * *',
        type: 'http',
        config: { url: 'http://localhost/test', method: 'GET' },
      })

      const history = await cronService.executeJob(job)

      expect(history.job_id).toBe(job.id)
      expect(history.status).toBe('success')
      expect(history.exit_code).toBe(0)
    })

    it('updates last_run_at on the job', async () => {
      const job = cronService.createJob({ name: 'track-run', preset: 'disk-check' })
      expect(job.last_run_at).toBeNull()

      await cronService.executeJob(job)

      const updated = cronService.getJob(job.id)
      expect(updated!.last_run_at).not.toBeNull()
      expect(updated!.last_run_status).toBe('success')
    })
  })

  describe('getJobHistory', () => {
    it('returns history for a job', async () => {
      const job = cronService.createJob({ name: 'history-test', preset: 'disk-check' })
      await cronService.executeJob(job)
      await cronService.executeJob(job)

      const history = cronService.getJobHistory(job.id)
      expect(history).toHaveLength(2)
      expect(history[0].created_at >= history[1].created_at).toBe(true)
    })

    it('respects limit', async () => {
      const job = cronService.createJob({ name: 'limit-test', preset: 'disk-check' })
      await cronService.executeJob(job)
      await cronService.executeJob(job)
      await cronService.executeJob(job)

      const history = cronService.getJobHistory(job.id, 2)
      expect(history).toHaveLength(2)
    })
  })
})
