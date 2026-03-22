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
    // Format: name:user@host:keypath
    const firstColon = entry.indexOf(':')
    const name = entry.substring(0, firstColon)
    const remainder = entry.substring(firstColon + 1) // user@host:keypath
    const atIdx = remainder.lastIndexOf('@')
    const user = remainder.substring(0, atIdx)
    const afterAt = remainder.substring(atIdx + 1) // host:keypath
    const colonIdx = afterAt.indexOf(':')
    const host = colonIdx >= 0 ? afterAt.substring(0, colonIdx) : afterAt
    const privateKeyPath = colonIdx >= 0 ? afterAt.substring(colonIdx + 1) : '~/.ssh/id_rsa'
    return { name, user, host, privateKeyPath }
  })
}

export interface LogSourceConfig {
  name: string
  type: 'file' | 'journald' | 'docker'
  path: string
}

function parseLogSources(raw: string): LogSourceConfig[] {
  if (!raw) return []
  return raw.split(',').map((entry) => {
    const parts = entry.trim().split(':')
    const name = parts[0]
    const typePart = parts[1] as 'file' | 'journald' | 'docker' | undefined
    const pathPart = parts.slice(2).join(':') || parts[1] || ''
    // Format: name:type:path  OR  name:path (defaults to 'file')
    if (typePart === 'file' || typePart === 'journald' || typePart === 'docker') {
      return { name, type: typePart, path: pathPart }
    }
    // Default: treat second part as path, type as 'file'
    return { name, type: 'file' as const, path: parts.slice(1).join(':') }
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
  CRON_TIMEZONE: z.string().default('UTC'),
  WEBHOOK_SECRET: z.string().default(''),
  NOTIFY_TELEGRAM_BOT_TOKEN: z.string().default(''),
  NOTIFY_TELEGRAM_CHAT_ID: z.string().default(''),
  NOTIFY_DISCORD_WEBHOOK_URL: z.string().default(''),
  HOOK_EVENT_TTL_DAYS: z.coerce.number().default(30),
  LOG_SOURCES: z.string().default(''),
  LOG_INDEX_INTERVAL_SECONDS: z.coerce.number().default(300),
  LOG_TAIL_DEFAULT_LINES: z.coerce.number().default(100),
  MONITORED_SERVICES: z.string().default(''),
  SERVICES_SSH_HOST: z.string().default(''),
  IMAP_HOST: z.string().default(''),
  IMAP_PORT: z.coerce.number().default(993),
  IMAP_USER: z.string().default(''),
  IMAP_PASS: z.string().default(''),
  IMAP_TLS: z.string().default('true').transform((v) => v === 'true'),
  EMAIL_CACHE_TTL_SECONDS: z.coerce.number().default(300),
  BW_SESSION: z.string().default(''),
  BW_CLI_PATH: z.string().default('bw'),
  ANSIBLE_PLAYBOOK_DIR: z.string().default(''),
  ANSIBLE_INVENTORY: z.string().default(''),
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
  cronTimezone: env.CRON_TIMEZONE,
  webhookSecret: env.WEBHOOK_SECRET,
  notifyTelegramBotToken: env.NOTIFY_TELEGRAM_BOT_TOKEN,
  notifyTelegramChatId: env.NOTIFY_TELEGRAM_CHAT_ID,
  notifyDiscordWebhookUrl: env.NOTIFY_DISCORD_WEBHOOK_URL,
  hookEventTtlDays: env.HOOK_EVENT_TTL_DAYS,
  logSources: parseLogSources(env.LOG_SOURCES),
  logIndexIntervalSeconds: env.LOG_INDEX_INTERVAL_SECONDS,
  logTailDefaultLines: env.LOG_TAIL_DEFAULT_LINES,
  monitoredServices: env.MONITORED_SERVICES ? env.MONITORED_SERVICES.split(',').map((s) => s.trim()).filter(Boolean) : [] as string[],
  servicesSSHHost: env.SERVICES_SSH_HOST,
  imapHost: env.IMAP_HOST,
  imapPort: env.IMAP_PORT,
  imapUser: env.IMAP_USER,
  imapPass: env.IMAP_PASS,
  imapTls: env.IMAP_TLS,
  emailCacheTtlSeconds: env.EMAIL_CACHE_TTL_SECONDS,
  bwSession: env.BW_SESSION,
  bwCliPath: env.BW_CLI_PATH,
  ansiblePlaybookDir: env.ANSIBLE_PLAYBOOK_DIR,
  ansibleInventory: env.ANSIBLE_INVENTORY,
}

export type Config = typeof config
