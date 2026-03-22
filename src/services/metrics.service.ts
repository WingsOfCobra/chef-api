import os from 'os'
import { getHealth, getDiskUsage, getMemoryDetail } from './system.service'
import { listContainers } from './docker.service'
import { db } from '../db'

export interface MetricsSnapshot {
  cpu: {
    usage_percent: number
    cores: number
    load_avg: number[]
  }
  memory: {
    total_bytes: number
    used_percent: number
  }
  disk: Array<{ mountpoint: string; use_percent: number }>
  containers: {
    running: number
    stopped: number
    paused: number
  }
  ssh_jobs: {
    total: number
    success: number
    error: number
  }
  timestamp: string
}

function getSSHJobCounts(): { total: number; success: number; error: number } {
  try {
    const row = db
      .prepare(
        `SELECT
           COUNT(*) as total,
           SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as success,
           SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) as error
         FROM job_history
         WHERE type = 'ssh'`
      )
      .get() as { total: number; success: number; error: number } | undefined

    return {
      total: row?.total ?? 0,
      success: row?.success ?? 0,
      error: row?.error ?? 0,
    }
  } catch {
    return { total: 0, success: 0, error: 0 }
  }
}

async function getContainerCounts(): Promise<{ running: number; stopped: number; paused: number }> {
  try {
    const containers = await listContainers()
    let running = 0
    let stopped = 0
    let paused = 0
    for (const c of containers) {
      if (c.state === 'running') running++
      else if (c.state === 'paused') paused++
      else stopped++
    }
    return { running, stopped, paused }
  } catch {
    return { running: 0, stopped: 0, paused: 0 }
  }
}

export async function getMetricsSnapshot(): Promise<MetricsSnapshot> {
  const [health, memDetail, disks, containers, sshJobs] = await Promise.all([
    getHealth(),
    Promise.resolve(getMemoryDetail()),
    Promise.resolve(getDiskUsage()),
    getContainerCounts(),
    Promise.resolve(getSSHJobCounts()),
  ])

  const diskMetrics = disks.map((d) => ({
    mountpoint: d.mountpoint,
    use_percent: parseInt(d.usePercent.replace('%', ''), 10) || 0,
  }))

  return {
    cpu: {
      usage_percent: health.cpu.usage_percent,
      cores: health.cpu.cores,
      load_avg: health.loadAvg,
    },
    memory: {
      total_bytes: memDetail.total,
      used_percent: memDetail.usedPercent,
    },
    disk: diskMetrics,
    containers,
    ssh_jobs: sshJobs,
    timestamp: new Date().toISOString(),
  }
}

function prometheusLine(name: string, help: string, type: string, value: number, labels?: Record<string, string>): string {
  const lines: string[] = []
  lines.push(`# HELP ${name} ${help}`)
  lines.push(`# TYPE ${name} ${type}`)
  if (labels && Object.keys(labels).length > 0) {
    const labelStr = Object.entries(labels)
      .map(([k, v]) => `${k}="${v}"`)
      .join(',')
    lines.push(`${name}{${labelStr}} ${value}`)
  } else {
    lines.push(`${name} ${value}`)
  }
  return lines.join('\n')
}

export async function getPrometheusText(): Promise<string> {
  const snapshot = await getMetricsSnapshot()
  const blocks: string[] = []

  // CPU usage
  blocks.push(prometheusLine('chef_cpu_usage_percent', 'Current CPU usage percentage', 'gauge', snapshot.cpu.usage_percent))

  // Memory usage
  blocks.push(prometheusLine('chef_memory_usage_percent', 'Current memory usage percentage', 'gauge', snapshot.memory.used_percent))

  // Disk usage
  {
    const lines: string[] = []
    lines.push('# HELP chef_disk_usage_percent Disk usage percentage by mountpoint')
    lines.push('# TYPE chef_disk_usage_percent gauge')
    for (const d of snapshot.disk) {
      lines.push(`chef_disk_usage_percent{mountpoint="${d.mountpoint}"} ${d.use_percent}`)
    }
    blocks.push(lines.join('\n'))
  }

  // Containers
  {
    const lines: string[] = []
    lines.push('# HELP chef_containers_total Number of Docker containers by state')
    lines.push('# TYPE chef_containers_total gauge')
    lines.push(`chef_containers_total{state="running"} ${snapshot.containers.running}`)
    lines.push(`chef_containers_total{state="stopped"} ${snapshot.containers.stopped}`)
    lines.push(`chef_containers_total{state="paused"} ${snapshot.containers.paused}`)
    blocks.push(lines.join('\n'))
  }

  // Load average
  {
    const lines: string[] = []
    lines.push('# HELP chef_load_average System load average')
    lines.push('# TYPE chef_load_average gauge')
    lines.push(`chef_load_average{period="1m"} ${snapshot.cpu.load_avg[0] ?? 0}`)
    lines.push(`chef_load_average{period="5m"} ${snapshot.cpu.load_avg[1] ?? 0}`)
    lines.push(`chef_load_average{period="15m"} ${snapshot.cpu.load_avg[2] ?? 0}`)
    blocks.push(lines.join('\n'))
  }

  // SSH jobs
  {
    const lines: string[] = []
    lines.push('# HELP chef_ssh_jobs_total SSH jobs by status')
    lines.push('# TYPE chef_ssh_jobs_total counter')
    lines.push(`chef_ssh_jobs_total{status="success"} ${snapshot.ssh_jobs.success}`)
    lines.push(`chef_ssh_jobs_total{status="error"} ${snapshot.ssh_jobs.error}`)
    blocks.push(lines.join('\n'))
  }

  return blocks.join('\n\n') + '\n'
}
