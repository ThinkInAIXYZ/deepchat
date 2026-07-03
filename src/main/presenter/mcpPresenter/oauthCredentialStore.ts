import * as fs from 'fs'
import * as path from 'path'
import { app, safeStorage } from 'electron'
import type { OAuthDiscoveryState } from '@modelcontextprotocol/sdk/client/auth.js'
import type {
  OAuthClientInformationMixed,
  OAuthTokens
} from '@modelcontextprotocol/sdk/shared/auth.js'

export type McpOAuthCredentialStorage = 'safeStorage' | 'file' | 'none'

export type McpOAuthCredentialEntry = {
  tokens?: OAuthTokens
  clientInformation?: OAuthClientInformationMixed
  codeVerifier?: string
  discoveryState?: OAuthDiscoveryState
  updatedAt: number
}

type McpOAuthCredentialData = Record<string, McpOAuthCredentialEntry>

type StoredCredentialEnvelope =
  | {
      version: 1
      storage: 'safeStorage'
      wrapped: string
      updatedAt: number
    }
  | {
      version: 1
      storage: 'file'
      entries: McpOAuthCredentialData
      updatedAt: number
    }

export class McpOAuthCredentialStore {
  private readonly filePath: string

  constructor(filePath?: string) {
    this.filePath = filePath || path.join(app.getPath('userData'), 'mcp-oauth', 'credentials.json')
  }

  getStorageState(): McpOAuthCredentialStorage {
    try {
      return safeStorage.isEncryptionAvailable() ? 'safeStorage' : 'file'
    } catch {
      return 'file'
    }
  }

  load(key: string): McpOAuthCredentialEntry | null {
    return this.loadAll()[key] || null
  }

  saveEntry(key: string, entry: Partial<McpOAuthCredentialEntry>): McpOAuthCredentialEntry {
    const entries = this.loadAll()
    const next = {
      ...(entries[key] || { updatedAt: Date.now() }),
      ...entry,
      updatedAt: Date.now()
    }
    entries[key] = next
    this.saveAll(entries)
    return next
  }

  clearEntry(key: string): void {
    const entries = this.loadAll()
    if (!entries[key]) {
      return
    }
    delete entries[key]
    this.saveAll(entries)
  }

  clearEntryScope(
    key: string,
    scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery'
  ): void {
    if (scope === 'all') {
      this.clearEntry(key)
      return
    }

    const entries = this.loadAll()
    const current = entries[key]
    if (!current) {
      return
    }

    const next: McpOAuthCredentialEntry = { ...current, updatedAt: Date.now() }
    if (scope === 'client') {
      delete next.clientInformation
    } else if (scope === 'tokens') {
      delete next.tokens
    } else if (scope === 'verifier') {
      delete next.codeVerifier
    } else if (scope === 'discovery') {
      delete next.discoveryState
    }

    entries[key] = next
    this.saveAll(entries)
  }

  private loadAll(): McpOAuthCredentialData {
    try {
      if (!fs.existsSync(this.filePath)) {
        return {}
      }

      const envelope = JSON.parse(fs.readFileSync(this.filePath, 'utf-8')) as
        | StoredCredentialEnvelope
        | undefined
      if (!envelope || envelope.version !== 1) {
        return {}
      }

      if (envelope.storage === 'file') {
        return this.normalizeEntries(envelope.entries)
      }

      const raw = safeStorage.decryptString(Buffer.from(envelope.wrapped, 'base64'))
      return this.normalizeEntries(JSON.parse(raw) as McpOAuthCredentialData)
    } catch {
      return {}
    }
  }

  private saveAll(entries: McpOAuthCredentialData): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true, mode: 0o700 })
    const normalized = this.normalizeEntries(entries)
    const now = Date.now()
    const envelope: StoredCredentialEnvelope =
      this.getStorageState() === 'safeStorage'
        ? {
            version: 1,
            storage: 'safeStorage',
            wrapped: safeStorage.encryptString(JSON.stringify(normalized)).toString('base64'),
            updatedAt: now
          }
        : {
            version: 1,
            storage: 'file',
            entries: normalized,
            updatedAt: now
          }

    fs.writeFileSync(this.filePath, JSON.stringify(envelope, null, 2), {
      encoding: 'utf-8',
      mode: 0o600
    })
  }

  private normalizeEntries(entries: McpOAuthCredentialData | undefined): McpOAuthCredentialData {
    if (!entries || typeof entries !== 'object') {
      return {}
    }

    return Object.fromEntries(
      Object.entries(entries).map(([key, entry]) => [
        key,
        {
          tokens: entry.tokens,
          clientInformation: entry.clientInformation,
          codeVerifier: entry.codeVerifier,
          discoveryState: entry.discoveryState,
          updatedAt: Number.isFinite(entry.updatedAt) ? entry.updatedAt : Date.now()
        }
      ])
    )
  }
}
