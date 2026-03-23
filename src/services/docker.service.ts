import axios from 'axios'
import { config } from '../config'

function dockerClient() {
  return axios.create({
    baseURL: 'http://localhost',
    socketPath: config.dockerSocket,
    timeout: 10000,
  })
}

export interface ContainerSummary {
  id: string
  name: string
  image: string
  status: string
  state: string
  health: string | null
  uptime: string
  ports: string[]
}

export interface DockerStats {
  containers: {
    total: number
    running: number
    stopped: number
    paused: number
  }
  images: number
  volumes: number
  diskUsage: {
    images: string
    containers: string
    volumes: string
    buildCache: string
  }
}

export interface ContainerInspect {
  id: string
  name: string
  image: string
  created: string
  state: {
    status: string
    running: boolean
    startedAt: string
    finishedAt: string
  }
  restartPolicy: string
  mounts: Array<{ type: string; source: string; destination: string; mode: string }>
  networks: Array<{ name: string; ipAddress: string; gateway: string }>
  ports: Array<{ containerPort: number; hostPort: number | null; protocol: string }>
  env: string[]
}

export interface ImageSummary {
  id: string
  tags: string[]
  size: string
  created: string
}

export interface NetworkSummary {
  id: string
  name: string
  driver: string
  scope: string
  containers: number
}

const SENSITIVE_ENV_PATTERN = /_(KEY|SECRET|TOKEN|PASSWORD|PASS)=/i

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`
}

export async function listContainers(): Promise<ContainerSummary[]> {
  const client = dockerClient()
  const { data } = await client.get('/containers/json?all=true')

  return data.map((c: Record<string, unknown>) => {
    const names = (c.Names as string[]) ?? []
    const name = names[0]?.replace(/^\//, '') ?? c.Id as string

    const ports = ((c.Ports as Array<{ IP?: string; PrivatePort: number; PublicPort?: number; Type: string }>) ?? [])
      .filter((p) => p.PublicPort)
      .map((p) => `${p.PublicPort}:${p.PrivatePort}/${p.Type}`)

    const health = (c.Status as string)?.includes('healthy')
      ? 'healthy'
      : (c.Status as string)?.includes('unhealthy')
      ? 'unhealthy'
      : null

    return {
      id: (c.Id as string).substring(0, 12),
      name,
      image: c.Image as string,
      status: c.Status as string,
      state: c.State as string,
      health,
      uptime: c.Status as string,
      ports,
    }
  })
}

export async function restartContainer(id: string): Promise<void> {
  const client = dockerClient()
  await client.post(`/containers/${id}/restart`)
}

export async function stopContainer(id: string): Promise<void> {
  const client = dockerClient()
  await client.post(`/containers/${id}/stop`)
}

export async function removeContainer(id: string): Promise<void> {
  const client = dockerClient()
  
  // Check container state
  try {
    const { data: inspect } = await client.get(`/containers/${id}/json`)
    const state = inspect?.State?.Status ?? ''
    
    if (state === 'running') {
      const error = new Error('Container must be stopped first')
      ;(error as any).statusCode = 409
      throw error
    }
  } catch (err: any) {
    // If container doesn't exist, Docker returns 404
    if (err.response?.status === 404) {
      const notFound = new Error('Container not found')
      ;(notFound as any).statusCode = 404
      throw notFound
    }
    // Re-throw our own 409 error or other errors
    throw err
  }
  
  // Remove the container
  await client.delete(`/containers/${id}`)
}

export async function getContainerLogs(id: string, lines = 100): Promise<string> {
  const client = dockerClient()
  const { data } = await client.get(
    `/containers/${id}/logs?stdout=true&stderr=true&tail=${lines}`
  )
  // Docker logs response is a multiplexed stream; return as-is for plain text
  if (typeof data === 'string') {
    // Strip Docker stream header bytes (8-byte header per frame)
    return data.replace(/[\x00-\x07][\x00-\x00][\x00-\x00][\x00-\x00][\x00-\xff][\x00-\xff][\x00-\xff][\x00-\xff]/g, '')
  }
  return String(data)
}

export interface ContainerStats {
  id: string
  name: string
  cpu_percent: number
  memory_usage: number
  memory_limit: number
  memory_percent: number
  network_rx: number
  network_tx: number
  block_read: number
  block_write: number
  timestamp: string
}

export async function getContainerStats(id: string): Promise<ContainerStats> {
  const client = dockerClient()
  const { data: stats } = await client.get(`/containers/${id}/stats?stream=false`)
  const { data: inspect } = await client.get(`/containers/${id}/json`)

  const name = (inspect.Name as string)?.replace(/^\//, '') ?? id

  // CPU %
  const cpuDelta =
    (stats.cpu_stats?.cpu_usage?.total_usage ?? 0) -
    (stats.precpu_stats?.cpu_usage?.total_usage ?? 0)
  const systemDelta =
    (stats.cpu_stats?.system_cpu_usage ?? 0) -
    (stats.precpu_stats?.system_cpu_usage ?? 0)
  const numCpus =
    stats.cpu_stats?.online_cpus ??
    stats.cpu_stats?.cpu_usage?.percpu_usage?.length ??
    1
  const cpuPercent =
    systemDelta > 0
      ? Math.round((cpuDelta / systemDelta) * numCpus * 100 * 100) / 100
      : 0

  // Memory
  const memoryUsage = stats.memory_stats?.usage ?? 0
  const memoryLimit = stats.memory_stats?.limit ?? 1
  const memoryPercent =
    Math.round((memoryUsage / memoryLimit) * 100 * 100) / 100

  // Network: sum across all interfaces
  let networkRx = 0
  let networkTx = 0
  if (stats.networks) {
    for (const iface of Object.values(stats.networks)) {
      const net = iface as { rx_bytes?: number; tx_bytes?: number }
      networkRx += net.rx_bytes ?? 0
      networkTx += net.tx_bytes ?? 0
    }
  }

  // Block I/O
  let blockRead = 0
  let blockWrite = 0
  const ioEntries = stats.blkio_stats?.io_service_bytes_recursive as
    | Array<{ op: string; value: number }>
    | null
  if (ioEntries) {
    for (const entry of ioEntries) {
      if (entry.op.toLowerCase() === 'read') blockRead += entry.value
      if (entry.op.toLowerCase() === 'write') blockWrite += entry.value
    }
  }

  return {
    id,
    name,
    cpu_percent: cpuPercent,
    memory_usage: memoryUsage,
    memory_limit: memoryLimit,
    memory_percent: memoryPercent,
    network_rx: networkRx,
    network_tx: networkTx,
    block_read: blockRead,
    block_write: blockWrite,
    timestamp: new Date().toISOString(),
  }
}

export async function getDockerStats(): Promise<DockerStats> {
  const client = dockerClient()
  const [containersRes, dfRes] = await Promise.all([
    client.get('/containers/json?all=true'),
    client.get('/system/df'),
  ])

  const containers = containersRes.data as Array<{ State: string }>
  const running = containers.filter((c) => c.State === 'running').length
  const stopped = containers.filter((c) => c.State === 'exited').length
  const paused = containers.filter((c) => c.State === 'paused').length

  const df = dfRes.data as {
    Images: Array<{ Size: number }>
    Containers: Array<{ SizeRw?: number }>
    Volumes: Array<{ UsageData?: { Size: number } }>
    BuildCache: Array<{ Size: number }>
  }

  const imageBytes = df.Images?.reduce((s, i) => s + (i.Size || 0), 0) ?? 0
  const containerBytes = df.Containers?.reduce((s, c) => s + (c.SizeRw || 0), 0) ?? 0
  const volumeBytes = df.Volumes?.reduce((s, v) => s + (v.UsageData?.Size || 0), 0) ?? 0
  const cacheBytes = df.BuildCache?.reduce((s, b) => s + (b.Size || 0), 0) ?? 0

  return {
    containers: {
      total: containers.length,
      running,
      stopped,
      paused,
    },
    images: df.Images?.length ?? 0,
    volumes: df.Volumes?.length ?? 0,
    diskUsage: {
      images: formatBytes(imageBytes),
      containers: formatBytes(containerBytes),
      volumes: formatBytes(volumeBytes),
      buildCache: formatBytes(cacheBytes),
    },
  }
}

export async function inspectContainer(id: string): Promise<ContainerInspect> {
  const client = dockerClient()
  const { data } = await client.get(`/containers/${id}/json`)

  const name = (data.Name as string)?.replace(/^\//, '') ?? id

  // Parse mounts
  const mounts = ((data.Mounts as Array<{ Type: string; Source: string; Destination: string; Mode: string }>) ?? []).map((m) => ({
    type: m.Type ?? '',
    source: m.Source ?? '',
    destination: m.Destination ?? '',
    mode: m.Mode ?? '',
  }))

  // Parse networks
  const networksObj = (data.NetworkSettings?.Networks as Record<string, { IPAddress: string; Gateway: string }>) ?? {}
  const networks = Object.entries(networksObj).map(([netName, net]) => ({
    name: netName,
    ipAddress: net.IPAddress ?? '',
    gateway: net.Gateway ?? '',
  }))

  // Parse ports from NetworkSettings.Ports
  const portsObj = (data.NetworkSettings?.Ports as Record<string, Array<{ HostPort: string }> | null>) ?? {}
  const ports: ContainerInspect['ports'] = []
  for (const [key, bindings] of Object.entries(portsObj)) {
    const match = key.match(/^(\d+)\/(\w+)$/)
    if (!match) continue
    const containerPort = parseInt(match[1], 10)
    const protocol = match[2]
    if (bindings && bindings.length > 0) {
      for (const b of bindings) {
        ports.push({ containerPort, hostPort: parseInt(b.HostPort, 10), protocol })
      }
    } else {
      ports.push({ containerPort, hostPort: null, protocol })
    }
  }

  // Filter sensitive env vars
  const rawEnv = (data.Config?.Env as string[]) ?? []
  const env = rawEnv.filter((e) => !SENSITIVE_ENV_PATTERN.test(e))

  return {
    id: (data.Id as string).substring(0, 12),
    name,
    image: data.Config?.Image ?? data.Image ?? '',
    created: data.Created ?? '',
    state: {
      status: data.State?.Status ?? '',
      running: data.State?.Running ?? false,
      startedAt: data.State?.StartedAt ?? '',
      finishedAt: data.State?.FinishedAt ?? '',
    },
    restartPolicy: data.HostConfig?.RestartPolicy?.Name ?? '',
    mounts,
    networks,
    ports,
    env,
  }
}

export async function listImages(): Promise<ImageSummary[]> {
  const client = dockerClient()
  const { data } = await client.get('/images/json')

  return (data as Array<{ Id: string; RepoTags: string[] | null; Size: number; Created: number }>).map((img) => ({
    id: (img.Id ?? '').replace(/^sha256:/, '').substring(0, 12),
    tags: img.RepoTags ?? [],
    size: formatBytes(img.Size ?? 0),
    created: new Date((img.Created ?? 0) * 1000).toISOString(),
  }))
}

export async function listNetworks(): Promise<NetworkSummary[]> {
  const client = dockerClient()
  const { data } = await client.get('/networks')

  return (data as Array<{ Id: string; Name: string; Driver: string; Scope: string; Containers: Record<string, unknown> | null }>).map((net) => ({
    id: (net.Id ?? '').substring(0, 12),
    name: net.Name ?? '',
    driver: net.Driver ?? '',
    scope: net.Scope ?? '',
    containers: Object.keys(net.Containers ?? {}).length,
  }))
}
