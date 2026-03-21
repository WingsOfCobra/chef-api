import { ImapFlow, FetchMessageObject } from 'imapflow'
import { config } from '../config'

export interface EmailSummary {
  uid: number
  subject: string
  from: string
  date: string
  messageId: string
}

export interface UnreadSummary {
  count: number
  messages: EmailSummary[]
}

export interface EmailThread {
  messageId: string
  messages: Array<{
    uid: number
    subject: string
    from: string
    date: string
    text: string
  }>
}

function isConfigured(): boolean {
  return !!(config.imapHost && config.imapUser && config.imapPass)
}

function createClient(): ImapFlow {
  return new ImapFlow({
    host: config.imapHost,
    port: config.imapPort,
    secure: config.imapTls,
    auth: {
      user: config.imapUser,
      pass: config.imapPass,
    },
    logger: false,
  })
}

function extractAddress(addr: any): string {
  if (!addr || !addr[0]) return 'unknown'
  const a = addr[0]
  if (a.name) return `${a.name} <${a.address}>`
  return a.address ?? 'unknown'
}

export async function getUnread(): Promise<UnreadSummary> {
  if (!isConfigured()) {
    throw new Error('IMAP not configured: set IMAP_HOST, IMAP_USER, IMAP_PASS')
  }

  const client = createClient()
  try {
    await client.connect()
    const lock = await client.getMailboxLock('INBOX')

    try {
      const messages: EmailSummary[] = []
      const searchResult = await client.search({ seen: false })
      const uids = searchResult || []

      if (uids.length > 0) {
        // Fetch last 50 max
        const fetchUids = uids.slice(-50)
        for await (const msg of client.fetch(fetchUids, { envelope: true, uid: true })) {
          messages.push({
            uid: msg.uid,
            subject: msg.envelope?.subject ?? '(no subject)',
            from: extractAddress(msg.envelope?.from),
            date: msg.envelope?.date?.toISOString() ?? '',
            messageId: msg.envelope?.messageId ?? '',
          })
        }
      }

      return {
        count: uids.length,
        messages: messages.reverse(), // newest first
      }
    } finally {
      lock.release()
    }
  } finally {
    await client.logout()
  }
}

export async function searchEmails(opts: {
  from?: string
  subject?: string
  since?: string
  before?: string
}): Promise<EmailSummary[]> {
  if (!isConfigured()) {
    throw new Error('IMAP not configured: set IMAP_HOST, IMAP_USER, IMAP_PASS')
  }

  const client = createClient()
  try {
    await client.connect()
    const lock = await client.getMailboxLock('INBOX')

    try {
      const criteria: Record<string, unknown> = {}
      if (opts.from) criteria.from = opts.from
      if (opts.subject) criteria.subject = opts.subject
      if (opts.since) criteria.since = new Date(opts.since)
      if (opts.before) criteria.before = new Date(opts.before)

      const searchResult = await client.search(criteria)
      const uids = searchResult || []
      const messages: EmailSummary[] = []

      if (uids.length > 0) {
        const fetchUids = uids.slice(-100)
        for await (const msg of client.fetch(fetchUids, { envelope: true, uid: true })) {
          messages.push({
            uid: msg.uid,
            subject: msg.envelope?.subject ?? '(no subject)',
            from: extractAddress(msg.envelope?.from),
            date: msg.envelope?.date?.toISOString() ?? '',
            messageId: msg.envelope?.messageId ?? '',
          })
        }
      }

      return messages.reverse()
    } finally {
      lock.release()
    }
  } finally {
    await client.logout()
  }
}

export async function getThread(uid: number): Promise<EmailThread> {
  if (!isConfigured()) {
    throw new Error('IMAP not configured: set IMAP_HOST, IMAP_USER, IMAP_PASS')
  }

  const client = createClient()
  try {
    await client.connect()
    const lock = await client.getMailboxLock('INBOX')

    try {
      const messages: EmailThread['messages'] = []

      for await (const msg of client.fetch([uid], {
        envelope: true,
        source: true,
        uid: true,
      })) {
        const text = msg.source?.toString() ?? ''
        messages.push({
          uid: msg.uid,
          subject: msg.envelope?.subject ?? '(no subject)',
          from: extractAddress(msg.envelope?.from),
          date: msg.envelope?.date?.toISOString() ?? '',
          text: text.substring(0, 10000), // Limit size
        })
      }

      return {
        messageId: messages[0]?.uid?.toString() ?? uid.toString(),
        messages,
      }
    } finally {
      lock.release()
    }
  } finally {
    await client.logout()
  }
}
