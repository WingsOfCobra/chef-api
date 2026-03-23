import crypto from 'crypto'
import { db, HookEvent } from '../db'
import { config } from '../config'
import axios from 'axios'

export interface StoreEventInput {
  eventType: string
  source?: string
  payload: unknown
}

export interface ListEventsOptions {
  page?: number
  limit?: number
  eventType?: string
}

export interface ListEventsResult {
  events: Array<Omit<HookEvent, 'payload'> & { payload: unknown }>
  total: number
  page: number
  limit: number
}

export function verifySignature(payload: string, signature: string, secret: string): boolean {
  if (!secret) return false

  const expected = 'sha256=' + crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex')

  // Use fixed-length buffers to prevent timing oracle on length
  const sigBuf = Buffer.alloc(128, 0)
  const expBuf = Buffer.alloc(128, 0)
  Buffer.from(signature).copy(sigBuf)
  Buffer.from(expected).copy(expBuf)

  return signature.length === expected.length &&
    crypto.timingSafeEqual(sigBuf, expBuf)
}

export function storeEvent(input: StoreEventInput): HookEvent {
  return db.prepare(
    `INSERT INTO hook_events (event_type, source, payload)
     VALUES (?, ?, ?) RETURNING *`
  ).get(
    input.eventType,
    input.source ?? null,
    JSON.stringify(input.payload),
  ) as HookEvent
}

export function listEvents(opts: ListEventsOptions = {}): ListEventsResult {
  const page = opts.page ?? 1
  const limit = opts.limit ?? 20
  const offset = (page - 1) * limit

  let query = 'SELECT * FROM hook_events'
  let countQuery = 'SELECT COUNT(*) as total FROM hook_events'
  const params: unknown[] = []
  const countParams: unknown[] = []

  if (opts.eventType) {
    query += ' WHERE event_type = ?'
    countQuery += ' WHERE event_type = ?'
    params.push(opts.eventType)
    countParams.push(opts.eventType)
  }

  query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?'
  params.push(limit, offset)

  const events = db.prepare(query).all(...params) as HookEvent[]
  const { total } = db.prepare(countQuery).get(...countParams) as { total: number }

  return {
    events: events.map((e) => ({
      ...e,
      payload: JSON.parse(e.payload),
    })),
    total,
    page,
    limit,
  }
}

export async function sendNotification(channel: 'telegram' | 'discord', message: string): Promise<void> {
  if (channel === 'telegram') {
    if (!config.notifyTelegramBotToken || !config.notifyTelegramChatId) {
      throw new Error('Telegram notification not configured: missing NOTIFY_TELEGRAM_BOT_TOKEN or NOTIFY_TELEGRAM_CHAT_ID')
    }
    await axios.post(
      `https://api.telegram.org/bot${config.notifyTelegramBotToken}/sendMessage`,
      { chat_id: config.notifyTelegramChatId, text: message, parse_mode: 'Markdown' },
      { timeout: 10000 },
    )
  } else if (channel === 'discord') {
    if (!config.notifyDiscordWebhookUrl) {
      throw new Error('Discord notification not configured: missing NOTIFY_DISCORD_WEBHOOK_URL')
    }
    await axios.post(
      config.notifyDiscordWebhookUrl,
      { content: message },
      { timeout: 10000 },
    )
  } else {
    throw new Error(`Unknown notification channel: ${channel}`)
  }
}

export function cleanupOldEvents(ttlDays?: number): number {
  const days = ttlDays ?? config.hookEventTtlDays
  const result = db.prepare(
    "DELETE FROM hook_events WHERE created_at < datetime('now', ?)"
  ).run(`-${days} days`)
  return result.changes
}

export interface AlertmanagerAlert {
  status: string
  labels: Record<string, string>
  annotations: Record<string, string>
  startsAt: string
  endsAt: string
}

export interface AlertmanagerWebhook {
  version: string
  status: string
  groupKey: string
  receiver: string
  groupLabels: Record<string, string>
  commonLabels: Record<string, string>
  commonAnnotations: Record<string, string>
  alerts: AlertmanagerAlert[]
}

export function formatAlertmanagerMessage(webhook: AlertmanagerWebhook): string {
  const isFiring = webhook.status === 'firing'
  const emoji = isFiring ? '🔴' : '✅'
  const statusText = isFiring ? 'FIRING' : 'RESOLVED'
  const alertname = webhook.commonLabels.alertname || 'Unknown Alert'
  const severity = webhook.commonLabels.severity || ''
  const summary = webhook.commonAnnotations.summary || ''
  const description = webhook.commonAnnotations.description || ''
  const alertCount = webhook.alerts.length

  let message = `${emoji} ${statusText}: ${alertname}`
  if (severity) {
    message += ` (${severity})`
  }
  message += '\n'

  if (summary) {
    message += `Summary: ${summary}\n`
  }

  if (description && isFiring) {
    message += `Description: ${description}\n`
  }

  if (isFiring) {
    message += `Alerts: ${alertCount}`
  }

  return message
}

export async function sendToNextcloudTalk(message: string): Promise<void> {
  if (!config.nextcloudAdminPassword) {
    throw new Error('Nextcloud Talk not configured: missing NEXTCLOUD_ADMIN_PASSWORD')
  }

  const url = `${config.nextcloudUrl}/ocs/v2.php/apps/spreed/api/v1/chat/${config.nextcloudTalkRoomToken}`
  const auth = Buffer.from(`${config.nextcloudAdminUser}:${config.nextcloudAdminPassword}`).toString('base64')

  await axios.post(
    url,
    { message },
    {
      headers: {
        'OCS-APIRequest': 'true',
        'Content-Type': 'application/json',
        Authorization: `Basic ${auth}`,
      },
      timeout: 10000,
    },
  )
}
