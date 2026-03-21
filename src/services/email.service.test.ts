import { vi, describe, it, expect } from 'vitest'

// Mock imapflow before importing service
vi.mock('imapflow', () => {
  const mockFetch = vi.fn()
  const mockSearch = vi.fn()
  const mockGetMailboxLock = vi.fn()
  const mockConnect = vi.fn()
  const mockLogout = vi.fn()

  return {
    ImapFlow: vi.fn().mockImplementation(() => ({
      connect: mockConnect.mockResolvedValue(undefined),
      logout: mockLogout.mockResolvedValue(undefined),
      getMailboxLock: mockGetMailboxLock.mockResolvedValue({ release: vi.fn() }),
      search: mockSearch,
      fetch: mockFetch,
    })),
    __mockSearch: mockSearch,
    __mockFetch: mockFetch,
  }
})

import * as emailService from './email.service'

describe('email.service', () => {
  describe('when IMAP is not configured', () => {
    it('getUnread throws when IMAP not configured', async () => {
      // config.imapHost is '' in test setup
      await expect(emailService.getUnread()).rejects.toThrow('IMAP not configured')
    })

    it('searchEmails throws when IMAP not configured', async () => {
      await expect(emailService.searchEmails({ from: 'test' })).rejects.toThrow('IMAP not configured')
    })

    it('getThread throws when IMAP not configured', async () => {
      await expect(emailService.getThread(1)).rejects.toThrow('IMAP not configured')
    })
  })
})
