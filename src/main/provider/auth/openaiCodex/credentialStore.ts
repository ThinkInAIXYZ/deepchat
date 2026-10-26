import * as fs from 'fs'
import * as path from 'path'
import { randomBytes } from 'node:crypto'
import type { CredentialCryptoPort } from '@/config/secretStore'

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
  | { state: 'undecryptable'; reason: string }
  | { state: 'corrupt'; reason: string }

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

const MAX_CREDENTIAL_FILE_BYTES = 16 * 1024 * 1024
const MAX_CREDENTIAL_PAYLOAD_BYTES = 8 * 1024 * 1024

export class OpenAICodexCredentialStore {
  private readonly filePath: string
  private readonly crypto: CredentialCryptoPort
  private lastLoadError: string | null = null
  private stopped = false
  private generation = 0
  private revision = 0
  private operations: Promise<void> = Promise.resolve()
  private pending = 0
  private pendingNormal = 0
  private loading: { revision: number; promise: Promise<EnvelopeReadResult> } | null = null

  constructor(options: { filePath: string; crypto: CredentialCryptoPort }) {
    this.filePath = options.filePath
    this.crypto = options.crypto
  }

  stop(): void {
    this.stopped = true
    this.generation++
    this.loading = null
  }

  private captureOperation(): () => void {
    const generation = this.generation
    const check = () => {
      if (this.stopped || generation !== this.generation)
        throw new Error('OpenAI Codex credential operation interrupted')
    }
    check()
    return check
  }

  async getStorageState(): Promise<OpenAICodexCredentialStorage> {
    const check = this.captureOperation()
    try {
      const available = await this.crypto.isAvailable()
      check()
      return available ? 'safeStorage' : 'file'
    } catch (error) {
      check()
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

  async load(): Promise<OpenAICodexTokenSet | null> {
    const check = this.captureOperation()
    const revision = this.revision
    await this.operations
    check()
    const assertReadCurrent = () => {
      check()
      if (revision !== this.revision) throw new Error('OpenAI Codex credential read superseded')
    }
    assertReadCurrent()
    let loading = this.loading
    if (!loading || loading.revision !== revision) {
      loading = { revision, promise: this.readEnvelope(assertReadCurrent) }
      this.loading = loading
      void loading.promise
        .finally(() => {
          if (this.loading === loading) this.loading = null
        })
        .catch(() => undefined)
    }
    const result = await loading.promise
    assertReadCurrent()
    if (result.state === 'corrupt' || result.state === 'undecryptable') {
      this.lastLoadError = result.reason
      console.warn(
        `[OpenAICodexCredentialStore] Ignoring unreadable credential file: ${result.reason}`
      )
      return null
    }
    this.lastLoadError = null
    return result.state === 'ok' ? result.tokens : null
  }

  save(tokens: OpenAICodexTokenSet): Promise<void> {
    return this.write(async (check) => {
      const normalized = this.normalizeTokens(tokens)
      if (!normalized) throw new Error('Invalid OpenAI Codex token payload')
      const payload = JSON.stringify(normalized)
      if (Buffer.byteLength(payload, 'utf8') > MAX_CREDENTIAL_PAYLOAD_BYTES)
        throw new Error('OpenAI Codex token payload is oversized')
      const storage = await this.getStorageState()
      check()
      const now = Date.now()
      const envelope: StoredCredentialEnvelope =
        storage === 'safeStorage'
          ? { version: 1, storage, wrapped: await this.crypto.encrypt(payload), updatedAt: now }
          : { version: 1, storage: 'file', tokens: normalized, updatedAt: now }
      check()
      if (
        envelope.storage === 'safeStorage' &&
        (typeof envelope.wrapped !== 'string' || !envelope.wrapped)
      )
        throw new Error('Credential encryption returned an invalid envelope')
      const serialized = JSON.stringify(envelope, null, 2)
      if (Buffer.byteLength(serialized, 'utf8') > MAX_CREDENTIAL_FILE_BYTES)
        throw new Error('OpenAI Codex credential envelope is oversized')
      const previous = await this.readEnvelope(check)
      check()
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true, mode: 0o700 })
      if (previous.state === 'corrupt') {
        try {
          fs.copyFileSync(this.filePath, `${this.filePath}.corrupt`)
        } catch (error) {
          console.warn(
            '[OpenAICodexCredentialStore] Failed to back up corrupted credential file:',
            error
          )
        }
      }
      const temporaryPath = `${this.filePath}.tmp-${process.pid}-${randomBytes(6).toString('hex')}`
      try {
        const fd = fs.openSync(temporaryPath, 'w', 0o600)
        try {
          fs.writeFileSync(fd, serialized, 'utf-8')
          fs.fsyncSync(fd)
        } finally {
          fs.closeSync(fd)
        }
        fs.renameSync(temporaryPath, this.filePath)
      } finally {
        try {
          fs.rmSync(temporaryPath, { force: true })
        } catch (error) {
          console.warn(
            '[OpenAICodexCredentialStore] Failed to remove temporary credential file:',
            error
          )
        }
      }
      this.lastLoadError = null
    })
  }

  clear(): Promise<void> {
    return this.write(async (check) => {
      check()
      const directory = path.dirname(this.filePath)
      const artifacts = [this.filePath, `${this.filePath}.corrupt`, `${this.filePath}.tmp`]
      const errors: unknown[] = []
      try {
        const prefix = `${path.basename(this.filePath)}.tmp-`
        for (const entry of fs.readdirSync(directory)) {
          if (entry.startsWith(prefix)) artifacts.push(path.join(directory, entry))
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') errors.push(error)
      }
      for (const artifact of artifacts) {
        try {
          fs.rmSync(artifact, { force: true })
        } catch (error) {
          errors.push(error)
        }
      }
      if (errors.length) throw new AggregateError(errors, 'OpenAI Codex credential cleanup failed')
      this.lastLoadError = null
    }, true)
  }

  private async write(
    operation: (check: () => void) => Promise<void>,
    control = false
  ): Promise<void> {
    const check = this.captureOperation()
    if (this.pending >= 32 || (!control && this.pendingNormal >= 24))
      throw new Error('OpenAI Codex credential mutation queue is full')
    this.pending++
    if (!control) this.pendingNormal++
    this.revision++
    const result = this.operations.then(async () => {
      check()
      await operation(check)
      check()
    })
    this.operations = result.catch(() => undefined)
    return result.finally(() => {
      this.pending--
      if (!control) this.pendingNormal--
      check()
    })
  }

  private async readEnvelope(check: () => void): Promise<EnvelopeReadResult> {
    let raw: string
    try {
      check()
      if (fs.statSync(this.filePath).size > MAX_CREDENTIAL_FILE_BYTES)
        return { state: 'corrupt', reason: 'credential file is oversized' }
      raw = fs.readFileSync(this.filePath, 'utf-8')
      if (Buffer.byteLength(raw, 'utf8') > MAX_CREDENTIAL_FILE_BYTES)
        return { state: 'corrupt', reason: 'credential file is oversized' }
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
      if (
        tokens &&
        Buffer.byteLength(JSON.stringify(tokens), 'utf8') > MAX_CREDENTIAL_PAYLOAD_BYTES
      )
        return { state: 'corrupt', reason: 'credential payload is oversized' }
      return tokens
        ? { state: 'ok', tokens }
        : { state: 'corrupt', reason: 'credential file holds an invalid token payload' }
    }

    let decrypted: string
    try {
      if (typeof envelope.wrapped !== 'string' || !envelope.wrapped)
        return { state: 'corrupt', reason: 'credential envelope is invalid' }
      decrypted = await this.crypto.decrypt(envelope.wrapped)
      check()
      if (Buffer.byteLength(decrypted, 'utf8') > MAX_CREDENTIAL_PAYLOAD_BYTES)
        return { state: 'corrupt', reason: 'credential payload is oversized' }
    } catch (error) {
      check()
      return {
        state: 'undecryptable',
        reason: `credential decryption failed: ${toErrorMessage(error)}`
      }
    }

    try {
      const tokens = this.normalizeTokens(JSON.parse(decrypted) as OpenAICodexTokenSet)
      return tokens
        ? { state: 'ok', tokens }
        : { state: 'corrupt', reason: 'credential file holds an invalid token payload' }
    } catch {
      return { state: 'corrupt', reason: 'credential payload is not valid JSON' }
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
