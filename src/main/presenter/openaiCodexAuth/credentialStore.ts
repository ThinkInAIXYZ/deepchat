import * as fs from 'fs'
import * as path from 'path'
import { app, safeStorage } from 'electron'

export type OpenAICodexCredentialStorage = 'safeStorage' | 'file' | 'none'

export interface OpenAICodexTokenSet {
  accessToken: string
  refreshToken?: string
  idToken?: string
  tokenType: string
  expiresAt: number
  accountId?: string
  accountLabel?: string
  planType?: string
  updatedAt: number
}

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
      tokens: OpenAICodexTokenSet
      updatedAt: number
    }

export class OpenAICodexCredentialStore {
  private readonly filePath: string

  constructor(filePath?: string) {
    this.filePath =
      filePath || path.join(app.getPath('userData'), 'openai-codex-auth', 'credentials.json')
  }

  getStorageState(): OpenAICodexCredentialStorage {
    try {
      return safeStorage.isEncryptionAvailable() ? 'safeStorage' : 'file'
    } catch {
      return 'file'
    }
  }

  load(): OpenAICodexTokenSet | null {
    try {
      if (!fs.existsSync(this.filePath)) {
        return null
      }

      const envelope = JSON.parse(fs.readFileSync(this.filePath, 'utf-8')) as
        | StoredCredentialEnvelope
        | undefined

      if (!envelope || envelope.version !== 1) {
        return null
      }

      if (envelope.storage === 'file') {
        return this.normalizeTokens(envelope.tokens)
      }

      const raw = safeStorage.decryptString(Buffer.from(envelope.wrapped, 'base64'))
      return this.normalizeTokens(JSON.parse(raw) as OpenAICodexTokenSet)
    } catch {
      return null
    }
  }

  save(tokens: OpenAICodexTokenSet): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true, mode: 0o700 })
    const normalized = this.normalizeTokens(tokens)
    if (!normalized) {
      throw new Error('Invalid OpenAI Codex token payload')
    }

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
            tokens: normalized,
            updatedAt: now
          }

    fs.writeFileSync(this.filePath, JSON.stringify(envelope, null, 2), {
      encoding: 'utf-8',
      mode: 0o600
    })
  }

  clear(): void {
    try {
      fs.rmSync(this.filePath, { force: true })
    } catch {}
  }

  private normalizeTokens(tokens: OpenAICodexTokenSet | undefined): OpenAICodexTokenSet | null {
    if (!tokens?.accessToken || typeof tokens.accessToken !== 'string') {
      return null
    }

    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      idToken: tokens.idToken,
      tokenType: tokens.tokenType || 'Bearer',
      expiresAt: Number.isFinite(tokens.expiresAt) ? tokens.expiresAt : 0,
      accountId: tokens.accountId,
      accountLabel: tokens.accountLabel,
      planType: tokens.planType,
      updatedAt: Number.isFinite(tokens.updatedAt) ? tokens.updatedAt : Date.now()
    }
  }
}
