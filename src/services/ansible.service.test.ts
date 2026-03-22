import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { db } from '../db'
import { EventEmitter } from 'events'

// Mock fs
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs')
  return {
    ...actual,
    default: {
      ...actual,
      existsSync: vi.fn().mockReturnValue(true),
      readdirSync: vi.fn().mockReturnValue(['deploy.yml', 'setup.yaml', 'readme.md', 'backup.yml']),
      readFileSync: vi.fn().mockReturnValue('[all]\nlocalhost ansible_connection=local'),
    },
    existsSync: vi.fn().mockReturnValue(true),
    readdirSync: vi.fn().mockReturnValue(['deploy.yml', 'setup.yaml', 'readme.md', 'backup.yml']),
    readFileSync: vi.fn().mockReturnValue('[all]\nlocalhost ansible_connection=local'),
  }
})

// Mock child_process.spawn
const mockStdout = new EventEmitter()
const mockStderr = new EventEmitter()
const mockChild = Object.assign(new EventEmitter(), {
  stdout: mockStdout,
  stderr: mockStderr,
  pid: 12345,
  kill: vi.fn(),
})

vi.mock('child_process', () => ({
  spawn: vi.fn().mockReturnValue(mockChild),
}))

// Mock config
vi.mock('../config', () => ({
  config: {
    ansiblePlaybookDir: '/opt/playbooks',
    ansibleInventory: '/opt/inventory.ini',
  },
}))

describe('ansible.service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    db.prepare('DELETE FROM ansible_jobs').run()
    // Reset the EventEmitter listeners to avoid leaks
    mockStdout.removeAllListeners()
    mockStderr.removeAllListeners()
    mockChild.removeAllListeners()
  })

  describe('listPlaybooks', () => {
    it('returns only .yml and .yaml files', async () => {
      const { listPlaybooks } = await import('./ansible.service')
      const playbooks = listPlaybooks()
      expect(playbooks).toEqual(['backup.yml', 'deploy.yml', 'setup.yaml'])
    })
  })

  describe('playbookExists', () => {
    it('returns true when file exists', async () => {
      const { playbookExists } = await import('./ansible.service')
      expect(playbookExists('deploy.yml')).toBe(true)
    })

    it('rejects directory traversal', async () => {
      const fs = await import('fs')
      // existsSync returns true but path check should fail
      ;(fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true)
      const { playbookExists } = await import('./ansible.service')
      expect(playbookExists('../../etc/passwd')).toBe(false)
    })
  })

  describe('createJob and getJob', () => {
    it('creates a job and retrieves it', async () => {
      const { createJob, getJob } = await import('./ansible.service')
      const job = createJob('deploy.yml')
      expect(job.id).toBeTypeOf('number')
      expect(job.playbook).toBe('deploy.yml')
      expect(job.status).toBe('pending')

      const retrieved = getJob(job.id)
      expect(retrieved).toBeDefined()
      expect(retrieved!.playbook).toBe('deploy.yml')
    })
  })

  describe('listJobs', () => {
    it('returns jobs from database', async () => {
      const { createJob, listJobs } = await import('./ansible.service')
      createJob('deploy.yml')
      createJob('setup.yaml')

      const jobs = listJobs()
      expect(jobs).toHaveLength(2)
      const playbooks = jobs.map((j: { playbook: string }) => j.playbook)
      expect(playbooks).toContain('deploy.yml')
      expect(playbooks).toContain('setup.yaml')
    })

    it('respects limit parameter', async () => {
      const { createJob, listJobs } = await import('./ansible.service')
      createJob('deploy.yml')
      createJob('setup.yaml')
      createJob('backup.yml')

      const jobs = listJobs(2)
      expect(jobs).toHaveLength(2)
    })
  })

  describe('runPlaybook', () => {
    it('spawns ansible-playbook and returns a job', async () => {
      const { spawn } = await import('child_process')
      const { runPlaybook } = await import('./ansible.service')

      const job = runPlaybook('deploy.yml')
      expect(job.id).toBeTypeOf('number')
      expect(spawn).toHaveBeenCalledWith(
        'ansible-playbook',
        ['/opt/playbooks/deploy.yml', '-i', '/opt/inventory.ini'],
        { stdio: ['ignore', 'pipe', 'pipe'] }
      )
    })

    it('updates job status on process completion', async () => {
      const { runPlaybook, getJob } = await import('./ansible.service')

      const job = runPlaybook('deploy.yml')

      // Simulate stdout
      mockStdout.emit('data', Buffer.from('PLAY [all] ***\n'))
      mockStdout.emit('data', Buffer.from('ok: [localhost]\n'))

      // Simulate process exit
      mockChild.emit('close', 0)

      const updated = getJob(job.id)
      expect(updated!.status).toBe('success')
      expect(updated!.exit_code).toBe(0)
      expect(updated!.output).toContain('PLAY [all]')
      expect(updated!.finished_at).toBeDefined()
    })

    it('marks job as failed on non-zero exit', async () => {
      const { runPlaybook, getJob } = await import('./ansible.service')

      const job = runPlaybook('deploy.yml')

      mockStderr.emit('data', Buffer.from('ERROR! the playbook could not be found\n'))
      mockChild.emit('close', 1)

      const updated = getJob(job.id)
      expect(updated!.status).toBe('failed')
      expect(updated!.exit_code).toBe(1)
    })

    it('handles spawn errors', async () => {
      const { runPlaybook, getJob } = await import('./ansible.service')

      const job = runPlaybook('deploy.yml')

      mockChild.emit('error', new Error('spawn ansible-playbook ENOENT'))

      const updated = getJob(job.id)
      expect(updated!.status).toBe('failed')
      expect(updated!.output).toContain('ENOENT')
    })
  })

  describe('getInventory', () => {
    it('reads inventory file', async () => {
      const { getInventory } = await import('./ansible.service')
      const inventory = getInventory()
      expect(inventory).toBe('[all]\nlocalhost ansible_connection=local')
    })
  })
})
