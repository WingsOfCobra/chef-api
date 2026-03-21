import { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import * as ssh from '../services/ssh.service'
import { db } from '../db'

const sshRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /ssh/hosts
  fastify.get('/hosts', { schema: { tags: ['SSH'] } }, async () => {
    return ssh.listHosts()
  })

  // POST /ssh/run
  const runSchema = z.object({
    host: z.string().min(1),
    command: z.string().min(1),
  })

  fastify.post('/run', { schema: { tags: ['SSH'] } }, async (request, reply) => {
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
