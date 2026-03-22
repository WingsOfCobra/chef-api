import { FastifyPluginAsync } from 'fastify'
import { config } from '../config'
import { getHealth } from '../services/system.service'
import http from 'http'
import { spawn, ChildProcess } from 'child_process'
import { WebSocket } from 'ws'

// Track log stream connections per container
const logStreamCounts = new Map<string, number>()
const MAX_LOG_STREAMS_PER_CONTAINER = 3

function authenticateWs(socket: WebSocket, key: string | undefined): boolean {
  if (!key || key !== config.apiKey) {
    socket.close(4001, 'Unauthorized')
    return false
  }
  return true
}

const wsRoutes: FastifyPluginAsync = async (fastify) => {
  // WS /ws/system — Live system metrics every 2s
  fastify.get('/system', { websocket: true }, (socket, request) => {
    const key = (request.query as Record<string, string>).key
    if (!authenticateWs(socket, key)) return

    let closed = false
    const interval = setInterval(async () => {
      if (closed || socket.readyState !== WebSocket.OPEN) {
        clearInterval(interval)
        return
      }
      try {
        const health = await getHealth()
        socket.send(JSON.stringify({
          type: 'system',
          cpu: health.cpu.usage_percent,
          memUsedPercent: parseFloat(health.memory.usedPercent),
          loadAvg: health.loadAvg,
          timestamp: health.timestamp,
        }))
      } catch (err) {
        fastify.log.error(err, 'ws/system: failed to get health')
      }
    }, 2000)

    socket.on('close', () => {
      closed = true
      clearInterval(interval)
    })
  })

  // WS /ws/containers — Real-time Docker container events
  fastify.get('/containers', { websocket: true }, (socket, request) => {
    const key = (request.query as Record<string, string>).key
    if (!authenticateWs(socket, key)) return

    let destroyed = false

    const reqOptions: http.RequestOptions = {
      socketPath: config.dockerSocket,
      path: '/events?filters=%7B%22type%22%3A%5B%22container%22%5D%7D',
      method: 'GET',
    }

    const dockerReq = http.request(reqOptions, (res) => {
      res.setEncoding('utf-8')
      let buffer = ''

      res.on('data', (chunk: string) => {
        if (destroyed) return
        buffer += chunk
        // Docker streams newline-delimited JSON
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.trim()) continue
          try {
            const event = JSON.parse(line)
            const action = event.Action ?? event.status
            const validActions = ['start', 'stop', 'die', 'restart', 'kill', 'pause', 'unpause', 'health_status']
            if (!validActions.includes(action)) continue

            socket.send(JSON.stringify({
              type: 'container_event',
              action,
              containerId: event.Actor?.ID ?? event.id ?? '',
              containerName: (event.Actor?.Attributes?.name ?? '').replace(/^\//, ''),
              timestamp: new Date((event.time ?? 0) * 1000).toISOString(),
            }))
          } catch {
            // skip malformed JSON
          }
        }
      })

      res.on('error', (err) => {
        if (!destroyed) {
          fastify.log.error(err, 'ws/containers: docker event stream error')
          socket.close(1011, 'Docker event stream error')
        }
      })

      res.on('end', () => {
        if (!destroyed) {
          socket.close(1011, 'Docker event stream ended')
        }
      })
    })

    dockerReq.on('error', (err) => {
      if (!destroyed) {
        fastify.log.error(err, 'ws/containers: docker connection error')
        socket.close(1011, 'Docker connection error')
      }
    })

    dockerReq.end()

    socket.on('close', () => {
      destroyed = true
      dockerReq.destroy()
    })
  })

  // WS /ws/logs/:id — Live log streaming for a container
  fastify.get<{ Params: { id: string } }>('/logs/:id', { websocket: true }, (socket, request) => {
    const key = (request.query as Record<string, string>).key
    if (!authenticateWs(socket, key)) return

    const containerId = request.params.id

    // Check concurrent stream limit
    const currentCount = logStreamCounts.get(containerId) ?? 0
    if (currentCount >= MAX_LOG_STREAMS_PER_CONTAINER) {
      socket.close(4029, 'Too many log streams for this container')
      return
    }
    logStreamCounts.set(containerId, currentCount + 1)

    let proc: ChildProcess | null = null

    proc = spawn('docker', ['logs', '--follow', '--tail', '50', containerId], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    const sendLine = (line: string) => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({
          type: 'log',
          containerId,
          line,
          timestamp: new Date().toISOString(),
        }))
      }
    }

    let stdoutBuf = ''
    proc.stdout?.on('data', (chunk: Buffer) => {
      stdoutBuf += chunk.toString()
      const lines = stdoutBuf.split('\n')
      stdoutBuf = lines.pop() ?? ''
      for (const line of lines) {
        sendLine(line)
      }
    })

    let stderrBuf = ''
    proc.stderr?.on('data', (chunk: Buffer) => {
      stderrBuf += chunk.toString()
      const lines = stderrBuf.split('\n')
      stderrBuf = lines.pop() ?? ''
      for (const line of lines) {
        sendLine(line)
      }
    })

    proc.on('error', (err) => {
      fastify.log.error(err, 'ws/logs: docker logs process error')
      socket.close(1011, 'Docker logs process error')
    })

    proc.on('exit', () => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.close(1000, 'Container log stream ended')
      }
    })

    socket.on('close', () => {
      const count = logStreamCounts.get(containerId) ?? 1
      if (count <= 1) {
        logStreamCounts.delete(containerId)
      } else {
        logStreamCounts.set(containerId, count - 1)
      }
      if (proc && !proc.killed) {
        proc.kill()
      }
    })
  })
}

export default wsRoutes
