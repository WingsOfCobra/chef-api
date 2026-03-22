import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('child_process', () => ({
  execSync: vi.fn(),
}))

import { execSync } from 'child_process'
import { isConfigured, listSecrets, getSecret, injectSecrets } from './secrets.service'

// We need to mock config to control bwSession
vi.mock('../config', () => ({
  config: {
    bwSession: '',
    bwCliPath: 'bw',
  },
}))

import { config } from '../config'

describe('secrets.service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('isConfigured', () => {
    it('returns false when BW_SESSION is empty', () => {
      (config as any).bwSession = ''
      expect(isConfigured()).toBe(false)
    })

    it('returns true when BW_SESSION is set', () => {
      (config as any).bwSession = 'some-session-token'
      expect(isConfigured()).toBe(true)
    })
  })

  describe('listSecrets', () => {
    it('throws when not configured', () => {
      (config as any).bwSession = ''
      expect(() => listSecrets()).toThrow('Bitwarden not configured')
    })

    it('parses bw list items output and returns names only', () => {
      (config as any).bwSession = 'test-session'
      const mockItems = [
        { id: 'id-1', name: 'api-key', login: { password: 'secret' }, notes: null },
        { id: 'id-2', name: 'db-pass', login: { password: 'pass123' }, notes: 'some note' },
      ]
      vi.mocked(execSync).mockReturnValue(JSON.stringify(mockItems))

      const result = listSecrets()

      expect(result).toEqual([
        { id: 'id-1', name: 'api-key' },
        { id: 'id-2', name: 'db-pass' },
      ])
      expect(execSync).toHaveBeenCalledWith(
        'bw list items --session test-session',
        expect.objectContaining({ encoding: 'utf-8' }),
      )
    })

    it('throws when bw CLI not found', () => {
      (config as any).bwSession = 'test-session'
      vi.mocked(execSync).mockImplementation(() => {
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      })

      expect(() => listSecrets()).toThrow("Bitwarden CLI not found at 'bw'")
    })

    it('throws when session expired', () => {
      (config as any).bwSession = 'expired-session'
      vi.mocked(execSync).mockImplementation(() => {
        const err = new Error('Command failed') as any
        err.stderr = 'Session key is invalid'
        throw err
      })

      expect(() => listSecrets()).toThrow('session expired')
    })
  })

  describe('getSecret', () => {
    it('throws when not configured', () => {
      (config as any).bwSession = ''
      expect(() => getSecret('foo')).toThrow('Bitwarden not configured')
    })

    it('returns login password when available', () => {
      (config as any).bwSession = 'test-session'
      vi.mocked(execSync).mockReturnValue(
        JSON.stringify({ id: 'id-1', name: 'api-key', login: { password: 'my-password' }, notes: null }),
      )

      const value = getSecret('api-key')
      expect(value).toBe('my-password')
    })

    it('returns notes when no login password', () => {
      (config as any).bwSession = 'test-session'
      vi.mocked(execSync).mockReturnValue(
        JSON.stringify({ id: 'id-2', name: 'secure-note', login: null, notes: 'my-note-value' }),
      )

      const value = getSecret('secure-note')
      expect(value).toBe('my-note-value')
    })

    it('throws when secret not found', () => {
      (config as any).bwSession = 'test-session'
      vi.mocked(execSync).mockImplementation(() => {
        const err = new Error('Command failed') as any
        err.stderr = 'Not found.'
        throw err
      })

      expect(() => getSecret('nonexistent')).toThrow("Secret 'nonexistent' not found")
    })

    it('throws when secret has no password or notes', () => {
      (config as any).bwSession = 'test-session'
      vi.mocked(execSync).mockReturnValue(
        JSON.stringify({ id: 'id-3', name: 'empty', login: { password: null }, notes: null }),
      )

      expect(() => getSecret('empty')).toThrow("Secret 'empty' has no password or notes field")
    })

    it('throws when session expired', () => {
      (config as any).bwSession = 'expired-session'
      vi.mocked(execSync).mockImplementation(() => {
        const err = new Error('Command failed') as any
        err.stderr = 'Session key is invalid'
        throw err
      })

      expect(() => getSecret('foo')).toThrow('session expired')
    })
  })

  describe('injectSecrets', () => {
    it('throws when not configured', () => {
      (config as any).bwSession = ''
      expect(() => injectSecrets({ DB_PASS: 'db-password' })).toThrow('Bitwarden not configured')
    })

    it('resolves all mappings', () => {
      (config as any).bwSession = 'test-session'

      // First call for DB_PASS, second for API_KEY
      vi.mocked(execSync)
        .mockReturnValueOnce(
          JSON.stringify({ id: 'id-1', name: 'db-password', login: { password: 'pass123' }, notes: null }),
        )
        .mockReturnValueOnce(
          JSON.stringify({ id: 'id-2', name: 'my-api-key', login: { password: 'key456' }, notes: null }),
        )

      const result = injectSecrets({
        DB_PASS: 'db-password',
        API_KEY: 'my-api-key',
      })

      expect(result).toEqual({
        DB_PASS: 'pass123',
        API_KEY: 'key456',
      })
      expect(execSync).toHaveBeenCalledTimes(2)
    })
  })
})
