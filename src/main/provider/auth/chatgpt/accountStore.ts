import * as fs from 'fs'
import * as path from 'path'
import { randomBytes, randomUUID } from 'node:crypto'
import { app, safeStorage } from 'electron'

export type ChatGPTCredentialStorage = 'safeStorage' | 'file'

export interface ChatGPTTokenSet {
  idToken: string
  accessToken: string
  refreshToken?: string
  tokenType: string
  scopes: string[]
  expiresAt: number
  earliestRefreshAt?: number
  savedAt: number
}

/** One issued client and its verified identity. Tokens are cleared on sign-out; the mapping is not. */
export interface ChatGPTRegistration {
  id: string
  issuer: string
  subject: string
  clientId: string
  email?: string
  tokens?: ChatGPTTokenSet
  reauthRequired?: boolean
}

export interface ChatGPTAccountState {
  version: 1
  /** Stable `ext_agent_host_id` for this installation. */
  hostId: string
  activeRegistrationId?: string
  /** A client issued by a registration whose code exchange did not complete. */
  pendingClientId?: string
  registrations: ChatGPTRegistration[]
}

type Envelope =
  | { version: 1; storage: 'safeStorage'; wrapped: string }
  | { version: 1; storage: 'file'; state: ChatGPTAccountState }

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function normalizeTokens(value: unknown): ChatGPTTokenSet | undefined {
  const tokens = value as Partial<ChatGPTTokenSet> | undefined
  if (!tokens || !isString(tokens.accessToken) || !isString(tokens.idToken)) return undefined
  return {
    idToken: tokens.idToken,
    accessToken: tokens.accessToken,
    ...(isString(tokens.refreshToken) ? { refreshToken: tokens.refreshToken } : {}),
    tokenType: isString(tokens.tokenType) ? tokens.tokenType : 'Bearer',
    scopes: Array.isArray(tokens.scopes) ? tokens.scopes.filter(isString) : [],
    expiresAt: Number.isFinite(tokens.expiresAt) ? Number(tokens.expiresAt) : 0,
    ...(Number.isFinite(tokens.earliestRefreshAt)
      ? { earliestRefreshAt: Number(tokens.earliestRefreshAt) }
      : {}),
    savedAt: Number.isFinite(tokens.savedAt) ? Number(tokens.savedAt) : 0
  }
}

function normalizeState(value: unknown): ChatGPTAccountState | null {
  const state = value as Partial<ChatGPTAccountState> | undefined
  if (!state || state.version !== 1 || !isString(state.hostId)) return null
  const registrations: ChatGPTRegistration[] = []
  for (const entry of Array.isArray(state.registrations) ? state.registrations : []) {
    if (
      !isString(entry?.id) ||
      !isString(entry.issuer) ||
      !isString(entry.subject) ||
      !isString(entry.clientId)
    )
      continue
    const tokens = normalizeTokens(entry.tokens)
    registrations.push({
      id: entry.id,
      issuer: entry.issuer,
      subject: entry.subject,
      clientId: entry.clientId,
      ...(isString(entry.email) ? { email: entry.email } : {}),
      ...(tokens ? { tokens } : {}),
      ...(entry.reauthRequired === true ? { reauthRequired: true } : {})
    })
  }
  return {
    version: 1,
    hostId: state.hostId,
    ...(isString(state.activeRegistrationId) &&
    registrations.some((entry) => entry.id === state.activeRegistrationId)
      ? { activeRegistrationId: state.activeRegistrationId }
      : {}),
    ...(isString(state.pendingClientId) ? { pendingClientId: state.pendingClientId } : {}),
    registrations
  }
}

export function createChatGPTAccountState(): ChatGPTAccountState {
  return {
    version: 1,
    hostId: `urn:uuid:${randomUUID()}`,
    registrations: []
  }
}

/**
 * Owner-only, atomically replaced account file. Wrapped with safeStorage when the OS keychain is
 * available. It is never synced, exported or logged.
 */
export class ChatGPTAccountStore {
  private readonly filePath: string
  private loadError: string | null = null
  /** An encrypted account exists but the keychain cannot open it now; it must not be replaced. */
  private unavailable = false

  constructor(filePath?: string) {
    this.filePath =
      filePath || path.join(app.getPath('userData'), 'chatgpt-auth', 'credentials.json')
  }

  getStorage(): ChatGPTCredentialStorage {
    try {
      return safeStorage.isEncryptionAvailable() ? 'safeStorage' : 'file'
    } catch {
      return 'file'
    }
  }

  getLoadError(): string | null {
    return this.loadError
  }

  isUnavailable(): boolean {
    return this.unavailable
  }

  /** Reads the account; an unreadable file is preserved as `.corrupt` and replaced on next save. */
  load(): ChatGPTAccountState | null {
    this.unavailable = false
    let raw: string
    try {
      raw = fs.readFileSync(this.filePath, 'utf-8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        this.loadError = null
        return null
      }
      return this.reject(`account file is unreadable: ${toErrorMessage(error)}`)
    }
    let envelope: Envelope
    try {
      envelope = JSON.parse(raw) as Envelope
    } catch {
      return this.reject('account file is not valid JSON')
    }
    if (envelope?.version !== 1) return this.reject('account file has an unsupported version')

    let state: ChatGPTAccountState | null
    if (envelope.storage === 'file') {
      state = normalizeState(envelope.state)
    } else if (envelope.storage === 'safeStorage' && isString(envelope.wrapped)) {
      if (this.getStorage() !== 'safeStorage') {
        // Electron refuses to decrypt before the keychain is ready; this is not corruption.
        this.unavailable = true
        this.loadError = 'the system keychain is not available to read ChatGPT credentials'
        return null
      }
      try {
        state = normalizeState(
          JSON.parse(safeStorage.decryptString(Buffer.from(envelope.wrapped, 'base64')))
        )
      } catch (error) {
        return this.reject(`account decryption failed: ${toErrorMessage(error)}`)
      }
    } else {
      state = null
    }
    if (!state) return this.reject('account file holds an invalid payload')
    this.loadError = null
    return state
  }

  save(state: ChatGPTAccountState): void {
    if (this.unavailable) {
      throw new Error('ChatGPT credentials are locked by the system keychain')
    }
    const directory = path.dirname(this.filePath)
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
    if (this.loadError) {
      try {
        fs.copyFileSync(this.filePath, `${this.filePath}.corrupt`)
      } catch {}
    }
    const envelope: Envelope =
      this.getStorage() === 'safeStorage'
        ? {
            version: 1,
            storage: 'safeStorage',
            wrapped: safeStorage.encryptString(JSON.stringify(state)).toString('base64')
          }
        : { version: 1, storage: 'file', state }
    const temporaryPath = `${this.filePath}.tmp-${process.pid}-${randomBytes(6).toString('hex')}`
    try {
      const fd = fs.openSync(temporaryPath, 'w', 0o600)
      try {
        fs.writeFileSync(fd, JSON.stringify(envelope), 'utf-8')
        fs.fsyncSync(fd)
      } finally {
        fs.closeSync(fd)
      }
      fs.renameSync(temporaryPath, this.filePath)
    } finally {
      try {
        fs.rmSync(temporaryPath, { force: true })
      } catch {}
    }
    this.loadError = null
  }

  private reject(reason: string): null {
    this.loadError = reason
    console.warn(`[ChatGPTAccountStore] Ignoring unreadable account file: ${reason}`)
    return null
  }
}
