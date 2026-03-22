import { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import * as ssh from '../services/ssh.service'
import { db } from '../db'

const sshRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /ssh/hosts
  fastify.get('/hosts', {
    schema: {
      tags: ['SSH'],
      summary: 'List configured SSH hosts',
      description: 'Returns the list of SSH hosts configured via the SSH_HOSTS environment variable.',
      response: {
        200: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              user: { type: 'string' },
              host: { type: 'string' },
            },
          },
        },
      },
    },
  }, async () => {
    return ssh.listHosts()
  })

  // POST /ssh/run
  const runSchema = z.object({
    host: z.string().min(1),
    command: z.string().min(1),
  })

  fastify.post('/run', {
    schema: {
      tags: ['SSH'],
      summary: 'Run a command on a remote host',
      description: 'Executes a shell command on the specified SSH host and returns stdout, stderr, and exit code. The execution is logged to job_history.',
      response: {
        200: {
          type: 'object',
          properties: {
            stdout: { type: 'string' },
            stderr: { type: 'string' },
            code: { type: ['number', 'null'] },
          },
        },
      },
    },
  }, async (request, reply) => {
    const body = runSchema.parse(request.body)

    const result = await ssh.runCommand(body.host, body.command)

    // Log to job history
    db.prepare(
      `INSERT INTO job_history (type, target, command, status, output)
       VALUES ('ssh', ?, ?, ?, ?)`
    ).run(
      body.host,
      body.command,
      result.code === 0 ? 'success' : 'failed',
      JSON.stringify({ stdout: result.stdout, stderr: result.stderr })
    )

    return result
  })
}

export default sshRoutes
