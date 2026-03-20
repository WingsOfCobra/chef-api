import { NodeSSH } from 'node-ssh'
import { config, SSHHost } from '../config'
import path from 'path'
import os from 'os'

export interface SSHResult {
  stdout: string
  stderr: string
  code: number | null
}

function resolveKeyPath(keyPath: string): string {
  if (keyPath.startsWith('~/')) {
    return path.join(os.homedir(), keyPath.slice(2))
  }
  return keyPath
}

export function getHost(name: string): SSHHost | undefined {
  return config.sshHosts.find((h) => h.name === name)
}

export async function runCommand(hostName: string, command: string): Promise<SSHResult> {
  const host = getHost(hostName)
  if (!host) {
    throw new Error(`Unknown SSH host: ${hostName}`)
  }

  const ssh = new NodeSSH()

  try {
    await ssh.connect({
      host: host.host,
      username: host.user,
      privateKeyPath: resolveKeyPath(host.privateKeyPath),
      readyTimeout: 10000,
    })

    const result = await ssh.execCommand(command, {
      execOptions: { pty: false },
    })

    return {
      stdout: result.stdout,
      stderr: result.stderr,
      code: result.code,
    }
  } finally {
    ssh.dispose()
  }
}

export function listHosts(): Array<{ name: string; user: string; host: string }> {
  return config.sshHosts.map((h) => ({
    name: h.name,
    user: h.user,
    host: h.host,
  }))
}
