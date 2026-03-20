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
