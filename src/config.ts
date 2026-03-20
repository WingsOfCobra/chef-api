import { z } from 'zod'
import dotenv from 'dotenv'

dotenv.config()

const sshHostSchema = z.object({
  name: z.string(),
  user: z.string(),
  host: z.string(),
  privateKeyPath: z.string(),
})

export type SSHHost = z.infer<typeof sshHostSchema>

function parseSSHHosts(raw: string): SSHHost[] {
  if (!raw) return []
  return raw.split(',').map((entry) => {
    const [name, rest] = entry.split(':')
    const atIdx = rest.lastIndexOf('@')
    const user = rest.substring(0, atIdx)
    const afterAt = rest.substring(atIdx + 1)
    const colonIdx = afterAt.indexOf(':')
    const host = colonIdx >= 0 ? afterAt.substring(0, colonIdx) : afterAt
    const privateKeyPath = colonIdx >= 0 ? afterAt.substring(colonIdx + 1) : '~/.ssh/id_rsa'
    return { name, user, host, privateKeyPath }
  })
}

const envSchema = z.object({
  CHEF_API_KEY: z.string().min(1),
  GITHUB_TOKEN: z.string().optional().default(''),
  PORT: z.coerce.number().default(4242),
  HOST: z.string().default('127.0.0.1'),
  DOCKER_SOCKET: z.string().default('/var/run/docker.sock'),
  SSH_HOSTS: z.string().optional().default(''),
  TODO_PATH: z.string().default('/path/to/TODO.md'),
})

const parsed = envSchema.safeParse(process.env)

if (!parsed.success) {
  console.error('❌ Invalid environment configuration:')
  console.error(parsed.error.format())
  process.exit(1)
}

const env = parsed.data

export const config = {
  apiKey: env.CHEF_API_KEY,
  githubToken: env.GITHUB_TOKEN,
  port: env.PORT,
  host: env.HOST,
  dockerSocket: env.DOCKER_SOCKET,
  sshHosts: parseSSHHosts(env.SSH_HOSTS),
  todoPath: env.TODO_PATH,
}

export type Config = typeof config
