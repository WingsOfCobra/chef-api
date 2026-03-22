import { spawn, ChildProcess } from 'child_process'
import fs from 'fs'
import path from 'path'
import { db, AnsibleJob } from '../db'
import { config } from '../config'

// Track running processes
const runningProcesses = new Map<number, ChildProcess>()

export function listPlaybooks(): string[] {
  const dir = config.ansiblePlaybookDir
  if (!dir) return []
  if (!fs.existsSync(dir)) return []

  const files = fs.readdirSync(dir)
  return files
    .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
    .sort()
}

export function playbookExists(name: string): boolean {
  const dir = config.ansiblePlaybookDir
  if (!dir) return false
  const fullPath = path.join(dir, name)
  // Prevent directory traversal
  if (!fullPath.startsWith(path.resolve(dir))) return false
  return fs.existsSync(fullPath)
}

export function createJob(playbook: string): AnsibleJob {
  const stmt = db.prepare(
    'INSERT INTO ansible_jobs (playbook, status) VALUES (?, ?)'
  )
  const result = stmt.run(playbook, 'pending')
  return getJob(Number(result.lastInsertRowid))!
}

export function getJob(id: number): AnsibleJob | undefined {
  return db.prepare('SELECT * FROM ansible_jobs WHERE id = ?').get(id) as AnsibleJob | undefined
}

export function listJobs(limit: number = 20): AnsibleJob[] {
  return db
    .prepare('SELECT * FROM ansible_jobs ORDER BY created_at DESC LIMIT ?')
    .all(limit) as AnsibleJob[]
}

function updateJob(id: number, data: Partial<Pick<AnsibleJob, 'status' | 'output' | 'exit_code' | 'started_at' | 'finished_at'>>): void {
  const fields: string[] = []
  const values: unknown[] = []

  if (data.status !== undefined) { fields.push('status = ?'); values.push(data.status) }
  if (data.output !== undefined) { fields.push('output = ?'); values.push(data.output) }
  if (data.exit_code !== undefined) { fields.push('exit_code = ?'); values.push(data.exit_code) }
  if (data.started_at !== undefined) { fields.push('started_at = ?'); values.push(data.started_at) }
  if (data.finished_at !== undefined) { fields.push('finished_at = ?'); values.push(data.finished_at) }

  if (fields.length === 0) return

  values.push(id)
  db.prepare(`UPDATE ansible_jobs SET ${fields.join(', ')} WHERE id = ?`).run(...values)
}

export function runPlaybook(name: string): AnsibleJob {
  const job = createJob(name)
  const playbookPath = path.join(config.ansiblePlaybookDir, name)

  const args = [playbookPath]
  if (config.ansibleInventory) {
    args.push('-i', config.ansibleInventory)
  }

  updateJob(job.id, {
    status: 'running',
    started_at: new Date().toISOString(),
  })

  const child = spawn('ansible-playbook', args, {
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  runningProcesses.set(job.id, child)

  let output = ''

  child.stdout?.on('data', (data: Buffer) => {
    output += data.toString()
  })

  child.stderr?.on('data', (data: Buffer) => {
    output += data.toString()
  })

  child.on('close', (code) => {
    runningProcesses.delete(job.id)
    updateJob(job.id, {
      status: code === 0 ? 'success' : 'failed',
      output,
      exit_code: code ?? 1,
      finished_at: new Date().toISOString(),
    })
  })

  child.on('error', (err) => {
    runningProcesses.delete(job.id)
    updateJob(job.id, {
      status: 'failed',
      output: output + '\n' + err.message,
      exit_code: 1,
      finished_at: new Date().toISOString(),
    })
  })

  return getJob(job.id)!
}

export function getInventory(): string {
  if (config.ansibleInventory && fs.existsSync(config.ansibleInventory)) {
    return fs.readFileSync(config.ansibleInventory, 'utf-8')
  }
  return ''
}

export function isRunning(jobId: number): boolean {
  return runningProcesses.has(jobId)
}

export function getRunningProcesses(): Map<number, ChildProcess> {
  return runningProcesses
}
