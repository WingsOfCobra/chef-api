import axios from 'axios'
import { db, AlertRule, AlertEvent, AlertHistory } from '../db'
import { config } from '../config'

export interface WebhookPayload {
  rule: string
  type: string
  target: string | null
  value: number | null
  threshold: number | null
  severity: string
  timestamp: string
}

export function listRules(): AlertRule[] {
  return db.prepare('SELECT * FROM alert_rules ORDER BY created_at DESC').all() as AlertRule[]
}

export function listEnabledRules(): AlertRule[] {
  return db.prepare('SELECT * FROM alert_rules WHERE enabled = 1').all() as AlertRule[]
}

export function getRuleById(id: number): AlertRule | undefined {
  return db.prepare('SELECT * FROM alert_rules WHERE id = ?').get(id) as AlertRule | undefined
}

export function createRule(data: {
  name: string
  type: AlertRule['type']
  target?: string
  threshold?: number
  webhook_url: string
  severity?: 'info' | 'warning' | 'critical'
}): AlertRule {
  const stmt = db.prepare(
    'INSERT INTO alert_rules (name, type, target, threshold, webhook_url, severity) VALUES (?, ?, ?, ?, ?, ?)'
  )
  const result = stmt.run(
    data.name,
    data.type,
    data.target ?? null,
    data.threshold ?? null,
    data.webhook_url,
    data.severity ?? 'warning'
  )
  return getRuleById(Number(result.lastInsertRowid))!
}

export function updateRule(
  id: number,
  data: { name?: string; target?: string; threshold?: number; webhook_url?: string; enabled?: boolean; severity?: 'info' | 'warning' | 'critical' }
): AlertRule | undefined {
  const rule = getRuleById(id)
  if (!rule) return undefined

  const fields: string[] = []
  const values: unknown[] = []

  if (data.name !== undefined) { fields.push('name = ?'); values.push(data.name) }
  if (data.target !== undefined) { fields.push('target = ?'); values.push(data.target) }
  if (data.threshold !== undefined) { fields.push('threshold = ?'); values.push(data.threshold) }
  if (data.webhook_url !== undefined) { fields.push('webhook_url = ?'); values.push(data.webhook_url) }
  if (data.enabled !== undefined) { fields.push('enabled = ?'); values.push(data.enabled ? 1 : 0) }
  if (data.severity !== undefined) { fields.push('severity = ?'); values.push(data.severity) }

  if (fields.length === 0) return rule

  fields.push("updated_at = datetime('now')")
  values.push(id)

  db.prepare(`UPDATE alert_rules SET ${fields.join(', ')} WHERE id = ?`).run(...values)
  return getRuleById(id)
}

export function deleteRule(id: number): boolean {
  const result = db.prepare('DELETE FROM alert_rules WHERE id = ?').run(id)
  return result.changes > 0
}

export function listEvents(opts: { limit?: number; offset?: number } = {}): {
  events: AlertEvent[]
  total: number
} {
  const limit = opts.limit ?? 50
  const offset = opts.offset ?? 0
  const events = db
    .prepare('SELECT * FROM alert_events ORDER BY triggered_at DESC LIMIT ? OFFSET ?')
    .all(limit, offset) as AlertEvent[]
  const total = (db.prepare('SELECT COUNT(*) as count FROM alert_events').get() as { count: number }).count
  return { events, total }
}

function recordEvent(ruleId: number, payload: WebhookPayload, delivered: boolean, attempts: number, lastError: string | null): AlertEvent {
  const stmt = db.prepare(
    'INSERT INTO alert_events (rule_id, payload, delivered, attempts, last_error) VALUES (?, ?, ?, ?, ?)'
  )
  const result = stmt.run(ruleId, JSON.stringify(payload), delivered ? 1 : 0, attempts, lastError)
  return db.prepare('SELECT * FROM alert_events WHERE id = ?').get(Number(result.lastInsertRowid)) as AlertEvent
}

const RETRY_DELAYS = [0, 5000, 30000]

export async function fireWebhook(rule: AlertRule, payload: WebhookPayload): Promise<AlertEvent> {
  // Store in alert history
  storeAlertHistory(rule.id, payload.type, payload.target, payload.value, payload.severity)
  
  // Send notifications (fire and forget, don't block webhook)
  sendTelegramNotification(payload).catch(() => {})
  sendDiscordNotification(payload).catch(() => {})
  
  let lastError: string | null = null
  let attempts = 0

  for (const delay of RETRY_DELAYS) {
    if (delay > 0) await new Promise((r) => setTimeout(r, delay))
    attempts++
    try {
      await axios.post(rule.webhook_url, payload, { timeout: 10000 })
      return recordEvent(rule.id, payload, true, attempts, null)
    } catch (err: unknown) {
      lastError = err instanceof Error ? err.message : String(err)
    }
  }

  return recordEvent(rule.id, payload, false, attempts, lastError)
}

export function buildPayload(
  rule: AlertRule,
  value: number | null
): WebhookPayload {
  return {
    rule: rule.name,
    type: rule.type,
    target: rule.target,
    value,
    threshold: rule.threshold,
    severity: rule.severity,
    timestamp: new Date().toISOString(),
  }
}

export function storeAlertHistory(
  ruleId: number | null,
  type: string,
  target: string | null,
  value: number | null,
  severity: string
): AlertHistory {
  const stmt = db.prepare(
    'INSERT INTO alert_history (rule_id, type, target, value, severity) VALUES (?, ?, ?, ?, ?)'
  )
  const result = stmt.run(ruleId, type, target, value, severity)
  return db.prepare('SELECT * FROM alert_history WHERE id = ?').get(Number(result.lastInsertRowid)) as AlertHistory
}

export function getAlertHistory(limit = 100): AlertHistory[] {
  return db
    .prepare('SELECT * FROM alert_history ORDER BY triggered_at DESC LIMIT ?')
    .all(limit) as AlertHistory[]
}

async function sendTelegramNotification(payload: WebhookPayload): Promise<void> {
  const token = process.env.NOTIFY_TELEGRAM_BOT_TOKEN
  const chatId = process.env.NOTIFY_TELEGRAM_CHAT_ID
  
  if (!token || !chatId) return

  const emoji = payload.severity === 'critical' ? '🔴' : payload.severity === 'warning' ? '⚠️' : 'ℹ️'
  const text = `${emoji} *Alert: ${payload.rule}*\n\nType: ${payload.type}\nTarget: ${payload.target ?? 'N/A'}\nValue: ${payload.value ?? 'N/A'}\nThreshold: ${payload.threshold ?? 'N/A'}\nSeverity: ${payload.severity}\nTime: ${payload.timestamp}`

  try {
    await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
      chat_id: chatId,
      text,
      parse_mode: 'Markdown',
    }, { timeout: 10000 })
  } catch (err) {
    console.error('Telegram notification failed:', err instanceof Error ? err.message : String(err))
  }
}

async function sendDiscordNotification(payload: WebhookPayload): Promise<void> {
  const webhookUrl = process.env.NOTIFY_DISCORD_WEBHOOK_URL
  
  if (!webhookUrl) return

  const color = payload.severity === 'critical' ? 0xFF0000 : payload.severity === 'warning' ? 0xFFA500 : 0x0099FF

  try {
    await axios.post(webhookUrl, {
      embeds: [{
        title: `Alert: ${payload.rule}`,
        color,
        fields: [
          { name: 'Type', value: payload.type, inline: true },
          { name: 'Target', value: payload.target ?? 'N/A', inline: true },
          { name: 'Value', value: String(payload.value ?? 'N/A'), inline: true },
          { name: 'Threshold', value: String(payload.threshold ?? 'N/A'), inline: true },
          { name: 'Severity', value: payload.severity, inline: true },
        ],
        timestamp: payload.timestamp,
      }],
    }, { timeout: 10000 })
  } catch (err) {
    console.error('Discord notification failed:', err instanceof Error ? err.message : String(err))
  }
}
