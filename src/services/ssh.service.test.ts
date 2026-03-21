import { vi, describe, it, expect, beforeEach } from 'vitest'

const mockSSH = {
  connect: vi.fn(),
  execCommand: vi.fn(),
  dispose: vi.fn(),
}

vi.mock('node-ssh', () => ({
  NodeSSH: class {
    connect = mockSSH.connect
    execCommand = mockSSH.execCommand
    dispose = mockSSH.dispose
  },
}))

import { getHost, listHosts, runCommand } from './ssh.service'

describe('ssh.service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('getHost', () => {
    it('returns the host config for a known name', () => {
      const host = getHost('dev')
      expect(host).toBeDefined()
      expect(host!.name).toBe('dev')
      expect(host!.user).toBe('deploy')
      expect(host!.host).toBe('10.0.0.1')
    })

    it('returns undefined for unknown host', () => {
      expect(getHost('nonexistent')).toBeUndefined()
    })
  })

  describe('listHosts', () => {
    it('returns hosts without privateKeyPath', () => {
      const hosts = listHosts()

      expect(hosts.length).toBeGreaterThan(0)
      expect(hosts[0]).toEqual({
        name: 'dev',
        user: 'deploy',
        host: '10.0.0.1',
      })
      // Verify no privateKeyPath leaks
      expect((hosts[0] as Record<string, unknown>).privateKeyPath).toBeUndefined()
    })
  })

  describe('runCommand', () => {
    it('connects, executes, and disposes', async () => {
      mockSSH.execCommand.mockResolvedValue({
        stdout: 'hello',
        stderr: '',
        code: 0,
      })

      const result = await runCommand('dev', 'echo hello')

      expect(mockSSH.connect).toHaveBeenCalledWith(
        expect.objectContaining({
          host: '10.0.0.1',
          username: 'deploy',
          readyTimeout: 10000,
        })
      )
      expect(mockSSH.execCommand).toHaveBeenCalledWith('echo hello', {
        execOptions: { pty: false },
      })
      expect(mockSSH.dispose).toHaveBeenCalled()
      expect(result).toEqual({
        stdout: 'hello',
        stderr: '',
        code: 0,
      })
    })

    it('throws for unknown host', async () => {
      await expect(runCommand('unknown', 'ls')).rejects.toThrow('Unknown SSH host: unknown')
    })

    it('calls dispose even when execCommand throws', async () => {
      mockSSH.execCommand.mockRejectedValue(new Error('connection lost'))

      await expect(runCommand('dev', 'ls')).rejects.toThrow('connection lost')
      expect(mockSSH.dispose).toHaveBeenCalled()
    })

    it('resolves tilde in key path', async () => {
      mockSSH.execCommand.mockResolvedValue({ stdout: '', stderr: '', code: 0 })

      await runCommand('dev', 'whoami')

      const connectCall = mockSSH.connect.mock.calls[0][0]
      // The key path should have ~ expanded to homedir
      expect(connectCall.privateKeyPath).not.toContain('~/')
      expect(connectCall.privateKeyPath).toContain('.ssh/id_rsa')
    })
  })
})
