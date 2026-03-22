import axios from 'axios'
import { db, AlertRule, AlertEvent } from '../db'

export interface WebhookPayload {
  rule: string
  type: string
  target: string | null
  value: number | null
  threshold: number | null
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
}): AlertRule {
  const stmt = db.prepare(
    'INSERT INTO alert_rules (name, type, target, threshold, webhook_url) VALUES (?, ?, ?, ?, ?)'
  )
  const result = stmt.run(data.name, data.type, data.target ?? null, data.threshold ?? null, data.webhook_url)
  return getRuleById(Number(result.lastInsertRowid))!
}

export function updateRule(
  id: number,
  data: { name?: string; target?: string; threshold?: number; webhook_url?: string; enabled?: boolean }
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
    timestamp: new Date().toISOString(),
  }
}
