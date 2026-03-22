import { execSync } from 'child_process'
import { config } from '../config'

export interface SecretSummary {
  id: string
  name: string
}

/**
 * Returns true if BW_SESSION is configured (non-empty).
 */
export function isConfigured(): boolean {
  return !!config.bwSession
}

/**
 * List all secrets from Bitwarden. Returns only names and IDs — NEVER values.
 */
export function listSecrets(): SecretSummary[] {
  if (!isConfigured()) {
    throw new Error('Bitwarden not configured')
  }

  try {
    const output = execSync(
      `${config.bwCliPath} list items --session ${config.bwSession}`,
      { encoding: 'utf-8', timeout: 30_000, stdio: ['pipe', 'pipe', 'pipe'] },
    )

    const items: Array<{ id: string; name: string }> = JSON.parse(output)
    return items.map((item) => ({ id: item.id, name: item.name }))
  } catch (err: any) {
    if (err.message?.includes('ENOENT') || err.message?.includes('not found')) {
      throw new Error(`Bitwarden CLI not found at '${config.bwCliPath}'`)
    }
    if (err.message?.includes('Session key') || err.stderr?.includes('Session key')) {
      throw new Error('Bitwarden session expired — please unlock your vault and update BW_SESSION')
    }
    throw new Error(`Failed to list secrets: ${err.message}`)
  }
}

/**
 * Retrieve a single secret value by name.
 * This is the ONLY function that returns secret values.
 */
export function getSecret(name: string): string {
  if (!isConfigured()) {
    throw new Error('Bitwarden not configured')
  }

  try {
    const output = execSync(
      `${config.bwCliPath} get item "${name}" --session ${config.bwSession}`,
      { encoding: 'utf-8', timeout: 30_000, stdio: ['pipe', 'pipe', 'pipe'] },
    )

    const item = JSON.parse(output)

    // Return password if available, otherwise notes
    if (item.login?.password) {
      return item.login.password
    }
    if (item.notes) {
      return item.notes
    }
    throw new Error(`Secret '${name}' has no password or notes field`)
  } catch (err: any) {
    if (err.message?.includes('ENOENT') || err.message?.includes('not found at')) {
      throw err
    }
    if (err.message?.includes('Session key') || err.stderr?.includes('Session key')) {
      throw new Error('Bitwarden session expired — please unlock your vault and update BW_SESSION')
    }
    if (err.message?.includes('Not found') || err.stderr?.includes('Not found')) {
      throw new Error(`Secret '${name}' not found`)
    }
    if (err.message?.startsWith('Secret \'')) {
      throw err
    }
    throw new Error(`Failed to get secret '${name}': ${err.message}`)
  }
}

/**
 * Inject secrets into a service config. Takes a map of { ENV_VAR: "secret-name" }
 * and returns { ENV_VAR: "secret-value" }.
 * NEVER logs the resolved values — only logs secret names and operations.
 */
export function injectSecrets(
  mappings: Record<string, string>,
): Record<string, string> {
  if (!isConfigured()) {
    throw new Error('Bitwarden not configured')
  }

  const result: Record<string, string> = {}

  for (const [envVar, secretName] of Object.entries(mappings)) {
    result[envVar] = getSecret(secretName)
  }

  return result
}
