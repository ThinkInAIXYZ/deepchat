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

type EnvelopeReadResult =
  | { state: 'missing' }
  | { state: 'ok'; tokens: OpenAICodexTokenSet }
  | { state: 'corrupt'; reason: string }

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export class OpenAICodexCredentialStore {
  private readonly filePath: string
  private lastLoadError: string | null = null

  constructor(filePath?: string) {
    this.filePath =
      filePath || path.join(app.getPath('userData'), 'openai-codex-auth', 'credentials.json')
  }

  getStorageState(): OpenAICodexCredentialStorage {
    try {
      return safeStorage.isEncryptionAvailable() ? 'safeStorage' : 'file'
    } catch (error) {
      console.warn(
        '[OpenAICodexCredentialStore] Encryption availability check failed, using file storage:',
        error
      )
      return 'file'
    }
  }

  getLoadError(): string | null {
    return this.lastLoadError
  }

  load(): OpenAICodexTokenSet | null {
    const result = this.readEnvelope()
    if (result.state === 'corrupt') {
      this.lastLoadError = result.reason
      console.warn(
        `[OpenAICodexCredentialStore] Ignoring corrupted credential file: ${result.reason}`
      )
      return null
    }

    this.lastLoadError = null
    return result.state === 'ok' ? result.tokens : null
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

    if (this.readEnvelope().state === 'corrupt') {
      try {
        fs.copyFileSync(this.filePath, `${this.filePath}.corrupt`)
      } catch (error) {
        console.warn(
          '[OpenAICodexCredentialStore] Failed to back up corrupted credential file:',
          error
        )
      }
    }

    const temporaryPath = `${this.filePath}.tmp`
    fs.writeFileSync(temporaryPath, JSON.stringify(envelope, null, 2), {
      encoding: 'utf-8',
      mode: 0o600
    })
    fs.renameSync(temporaryPath, this.filePath)
    this.lastLoadError = null
  }

  clear(): void {
    try {
      fs.rmSync(this.filePath, { force: true })
      fs.rmSync(`${this.filePath}.corrupt`, { force: true })
      fs.rmSync(`${this.filePath}.tmp`, { force: true })
      this.lastLoadError = null
    } catch (error) {
      console.warn('[OpenAICodexCredentialStore] Failed to remove credential files:', error)
    }
  }

  private readEnvelope(): EnvelopeReadResult {
    let raw: string
    try {
      raw = fs.readFileSync(this.filePath, 'utf-8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return { state: 'missing' }
      }
      return { state: 'corrupt', reason: `credential file is unreadable: ${toErrorMessage(error)}` }
    }

    let envelope: StoredCredentialEnvelope | undefined
    try {
      envelope = JSON.parse(raw) as StoredCredentialEnvelope | undefined
    } catch {
      return { state: 'corrupt', reason: 'credential file is not valid JSON' }
    }

    if (!envelope || envelope.version !== 1) {
      return { state: 'corrupt', reason: 'credential envelope has an unsupported version' }
    }

    if (envelope.storage === 'file') {
      const tokens = this.normalizeTokens(envelope.tokens)
      return tokens
        ? { state: 'ok', tokens }
        : { state: 'corrupt', reason: 'credential file holds an invalid token payload' }
    }

    try {
      const decrypted = safeStorage.decryptString(Buffer.from(envelope.wrapped, 'base64'))
      const tokens = this.normalizeTokens(JSON.parse(decrypted) as OpenAICodexTokenSet)
      return tokens
        ? { state: 'ok', tokens }
        : { state: 'corrupt', reason: 'credential file holds an invalid token payload' }
    } catch (error) {
      return { state: 'corrupt', reason: `credential decryption failed: ${toErrorMessage(error)}` }
    }
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
