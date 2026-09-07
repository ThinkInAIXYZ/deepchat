import * as fs from 'node:fs'
import * as path from 'node:path'
import { randomBytes } from 'node:crypto'
import { app, safeStorage } from 'electron'
import type {
  OAuthDiscoveryState,
  StoredOAuthClientInformation,
  StoredOAuthTokens
} from '@modelcontextprotocol/client'
import type { McpCredentialBinding, McpCredentialKind } from '@shared/types/mcp'

export type McpOAuthCredentialStorage = 'safeStorage' | 'memory' | 'none'

export type McpOAuthCredentialEntry = {
  tokens?: StoredOAuthTokens
  clientInformation?: StoredOAuthClientInformation
  codeVerifier?: string
  discoveryState?: OAuthDiscoveryState
  binding?: McpCredentialBinding
  updatedAt: number
}

export type McpPrivateKeyCredential = {
  privateKey: string
  algorithm: 'RS256' | 'ES256'
  fingerprint: string
  binding: McpCredentialBinding
  updatedAt: number
}

export type McpSecretCredential = {
  secret: string
  binding: McpCredentialBinding
  updatedAt: number
}

export type McpEnterpriseIdentityCredential = {
  profileId: string
  issuer: string
  clientId: string
  subject: string
  subjectLabel?: string
  idToken: string
  accessToken?: string
  refreshToken?: string
  expiresAt: number
  scope?: string
  updatedAt: number
}

type InteractiveCredentialRecord = {
  credentialClass: 'interactive_oauth'
  value: McpOAuthCredentialEntry
}

type ClientSecretCredentialRecord = {
  credentialClass: 'client_secret'
  value: McpSecretCredential
}

type PrivateKeyCredentialRecord = {
  credentialClass: 'private_key'
  value: McpPrivateKeyCredential
}

type EnterpriseResourceSecretCredentialRecord = {
  credentialClass: 'enterprise_resource_secret'
  value: McpSecretCredential
}

type EnterpriseIdentityCredentialRecord = {
  credentialClass: 'enterprise_identity'
  value: McpEnterpriseIdentityCredential
}

type EnterpriseIdentityClientSecretRecord = {
  credentialClass: 'enterprise_identity_client_secret'
  value: {
    profileId: string
    issuer: string
    clientId: string
    secret: string
    updatedAt: number
  }
}

type StoredCredentialRecord =
  | InteractiveCredentialRecord
  | ClientSecretCredentialRecord
  | PrivateKeyCredentialRecord
  | EnterpriseResourceSecretCredentialRecord
  | EnterpriseIdentityCredentialRecord
  | EnterpriseIdentityClientSecretRecord

type McpCredentialData = Record<string, StoredCredentialRecord>
type LegacyCredentialData = Record<string, McpOAuthCredentialEntry>

type StoredCredentialEnvelopeV2 = {
  version: 2
  storage: 'safeStorage'
  wrapped: string
  updatedAt: number
}

type StoredCredentialEnvelopeV1 =
  | {
      version: 1
      storage: 'safeStorage'
      wrapped: string
      updatedAt: number
    }
  | {
      version: 1
      storage: 'file'
      entries: LegacyCredentialData
      updatedAt: number
    }

const MAX_CREDENTIAL_FILE_BYTES = 16 * 1024 * 1024
const MAX_CREDENTIAL_PAYLOAD_BYTES = 8 * 1024 * 1024
const MAX_CREDENTIAL_RECORDS = 512
const MAX_CREDENTIAL_KEY_BYTES = 512
const MAX_SECRET_BYTES = 256 * 1024
const MAX_PRIVATE_KEY_BYTES = 1024 * 1024

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const isBoundedString = (value: unknown, maxBytes: number): value is string =>
  typeof value === 'string' && Boolean(value) && Buffer.byteLength(value, 'utf8') <= maxBytes

const isTimestamp = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0

const isCredentialBinding = (value: unknown): value is McpCredentialBinding => {
  if (!isRecord(value)) {
    return false
  }
  return (
    isBoundedString(value.serverId, 128) &&
    typeof value.configGeneration === 'number' &&
    Number.isSafeInteger(value.configGeneration) &&
    value.configGeneration > 0 &&
    isBoundedString(value.bindingHash, 256) &&
    isBoundedString(value.endpoint, 8192) &&
    (value.protectedResourceUrl === undefined ||
      isBoundedString(value.protectedResourceUrl, 8192)) &&
    (value.authorizationServerIssuer === undefined ||
      isBoundedString(value.authorizationServerIssuer, 8192)) &&
    (value.clientId === undefined || isBoundedString(value.clientId, 8192))
  )
}

const isLinuxBasicTextBackend = (): boolean => {
  if (process.platform !== 'linux') {
    return false
  }

  try {
    return safeStorage.getSelectedStorageBackend() === 'basic_text'
  } catch {
    return true
  }
}

export class McpOAuthCredentialStore {
  private readonly filePath: string
  private loaded = false
  private loadFailed = false
  private records: McpCredentialData = {}

  constructor(filePath?: string) {
    this.filePath = filePath || path.join(app.getPath('userData'), 'mcp-oauth', 'credentials.json')
  }

  getStorageState(): McpOAuthCredentialStorage {
    try {
      if (!safeStorage.isEncryptionAvailable() || isLinuxBasicTextBackend()) {
        return 'memory'
      }
      return 'safeStorage'
    } catch {
      return 'memory'
    }
  }

  isPersistent(): boolean {
    return this.getStorageState() === 'safeStorage'
  }

  load(key: string): McpOAuthCredentialEntry | null {
    const record = this.loadRecord(key)
    return record?.credentialClass === 'interactive_oauth' ? record.value : null
  }

  saveEntry(key: string, entry: Partial<McpOAuthCredentialEntry>): McpOAuthCredentialEntry {
    const current = this.load(key)
    const next: McpOAuthCredentialEntry = {
      ...(current || { updatedAt: Date.now() }),
      ...entry,
      updatedAt: Date.now()
    }
    this.saveRecord(key, {
      credentialClass: 'interactive_oauth',
      value: next
    })
    return next
  }

  findInteractiveCredential(
    binding: McpCredentialBinding
  ): { key: string; entry: McpOAuthCredentialEntry } | null {
    this.ensureLoaded()
    const matches = Object.entries(this.records).filter(([, record]) => {
      if (record.credentialClass !== 'interactive_oauth' || !record.value.binding) {
        return false
      }
      const stored = record.value.binding
      return (
        stored.serverId === binding.serverId &&
        stored.configGeneration === binding.configGeneration &&
        stored.bindingHash === binding.bindingHash &&
        stored.endpoint === binding.endpoint &&
        (binding.protectedResourceUrl === undefined ||
          stored.protectedResourceUrl === binding.protectedResourceUrl) &&
        (binding.authorizationServerIssuer === undefined ||
          stored.authorizationServerIssuer === binding.authorizationServerIssuer) &&
        (binding.clientId === undefined || stored.clientId === binding.clientId)
      )
    })
    if (matches.length !== 1) {
      return null
    }
    const [key, record] = matches[0]
    return {
      key,
      entry: (record as InteractiveCredentialRecord).value
    }
  }

  saveClientSecret(
    key: string,
    secret: string,
    binding: McpCredentialBinding
  ): McpSecretCredential {
    const value = { secret, binding, updatedAt: Date.now() }
    this.saveRecord(key, { credentialClass: 'client_secret', value })
    return value
  }

  loadClientSecret(key: string): McpSecretCredential | null {
    const record = this.loadRecord(key)
    return record?.credentialClass === 'client_secret' ? record.value : null
  }

  savePrivateKey(
    key: string,
    input: {
      privateKey: string
      algorithm: 'RS256' | 'ES256'
      fingerprint: string
      binding: McpCredentialBinding
    }
  ): McpPrivateKeyCredential {
    const value = { ...input, updatedAt: Date.now() }
    this.saveRecord(key, { credentialClass: 'private_key', value })
    return value
  }

  loadPrivateKey(key: string): McpPrivateKeyCredential | null {
    const record = this.loadRecord(key)
    return record?.credentialClass === 'private_key' ? record.value : null
  }

  saveEnterpriseResourceSecret(
    key: string,
    secret: string,
    binding: McpCredentialBinding
  ): McpSecretCredential {
    const value = { secret, binding, updatedAt: Date.now() }
    this.saveRecord(key, {
      credentialClass: 'enterprise_resource_secret',
      value
    })
    return value
  }

  loadEnterpriseResourceSecret(key: string): McpSecretCredential | null {
    const record = this.loadRecord(key)
    return record?.credentialClass === 'enterprise_resource_secret' ? record.value : null
  }

  saveEnterpriseIdentity(
    key: string,
    value: Omit<McpEnterpriseIdentityCredential, 'updatedAt'>
  ): McpEnterpriseIdentityCredential {
    const next = { ...value, updatedAt: Date.now() }
    this.saveRecord(key, {
      credentialClass: 'enterprise_identity',
      value: next
    })
    return next
  }

  loadEnterpriseIdentity(key: string): McpEnterpriseIdentityCredential | null {
    const record = this.loadRecord(key)
    return record?.credentialClass === 'enterprise_identity' ? record.value : null
  }

  saveEnterpriseIdentityClientSecret(
    key: string,
    value: {
      profileId: string
      issuer: string
      clientId: string
      secret: string
    }
  ): void {
    this.saveRecord(key, {
      credentialClass: 'enterprise_identity_client_secret',
      value: { ...value, updatedAt: Date.now() }
    })
  }

  loadEnterpriseIdentityClientSecret(key: string): string | null {
    const record = this.loadRecord(key)
    return record?.credentialClass === 'enterprise_identity_client_secret'
      ? record.value.secret
      : null
  }

  getCredentialRecordStatus(
    key: string,
    kind: McpCredentialKind
  ): { configured: boolean; updatedAt?: number; fingerprint?: string } {
    const record = this.loadRecord(key)
    if (!record || record.credentialClass !== kind) {
      return { configured: false }
    }

    return {
      configured: true,
      updatedAt: record.value.updatedAt,
      ...(record.credentialClass === 'private_key' ? { fingerprint: record.value.fingerprint } : {})
    }
  }

  clearEntry(key: string): void {
    this.ensureLoaded()
    this.assertWritable()
    if (!this.records[key]) {
      return
    }
    delete this.records[key]
    this.persist()
  }

  clearEntryScope(
    key: string,
    scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery'
  ): void {
    if (scope === 'all') {
      this.clearEntry(key)
      return
    }

    const current = this.load(key)
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

    this.saveRecord(key, {
      credentialClass: 'interactive_oauth',
      value: next
    })
  }

  clearServerCredentials(serverId: string): void {
    this.ensureLoaded()
    this.assertWritable()
    let changed = false
    for (const [key, record] of Object.entries(this.records)) {
      if (
        (record.credentialClass === 'interactive_oauth' &&
          record.value.binding?.serverId === serverId) ||
        (record.credentialClass === 'client_secret' &&
          record.value.binding.serverId === serverId) ||
        (record.credentialClass === 'private_key' && record.value.binding.serverId === serverId) ||
        (record.credentialClass === 'enterprise_resource_secret' &&
          record.value.binding.serverId === serverId)
      ) {
        delete this.records[key]
        changed = true
      }
    }
    if (changed) {
      this.persist()
    }
  }

  clearEnterpriseProfileCredentials(profileId: string): void {
    this.ensureLoaded()
    this.assertWritable()
    let changed = false
    for (const [key, record] of Object.entries(this.records)) {
      if (
        (record.credentialClass === 'enterprise_identity' ||
          record.credentialClass === 'enterprise_identity_client_secret') &&
        record.value.profileId === profileId
      ) {
        delete this.records[key]
        changed = true
      }
    }
    if (changed) {
      this.persist()
    }
  }

  private loadRecord(key: string): StoredCredentialRecord | null {
    this.ensureLoaded()
    return this.records[key] || null
  }

  private saveRecord(key: string, record: StoredCredentialRecord): void {
    this.ensureLoaded()
    this.assertWritable()
    if (!isBoundedString(key, MAX_CREDENTIAL_KEY_BYTES)) {
      throw new Error('MCP credential key is invalid')
    }
    const normalized = this.normalizeRecord(record)
    if (!normalized) {
      throw new Error('MCP credential record is invalid')
    }
    const next = { ...this.records, [key]: normalized }
    if (
      Object.keys(next).length > MAX_CREDENTIAL_RECORDS ||
      Buffer.byteLength(JSON.stringify(next), 'utf8') > MAX_CREDENTIAL_PAYLOAD_BYTES
    ) {
      throw new Error('MCP credential store limit exceeded')
    }
    this.records = next
    this.persist()
  }

  private ensureLoaded(): void {
    if (this.loaded) {
      return
    }
    this.loaded = true

    try {
      if (!fs.existsSync(this.filePath)) {
        return
      }

      if (fs.statSync(this.filePath).size > MAX_CREDENTIAL_FILE_BYTES) {
        throw new Error('MCP credential file is oversized')
      }
      const serializedEnvelope = fs.readFileSync(this.filePath, 'utf-8')
      if (Buffer.byteLength(serializedEnvelope, 'utf8') > MAX_CREDENTIAL_FILE_BYTES) {
        throw new Error('MCP credential file is oversized')
      }
      const envelope = JSON.parse(serializedEnvelope) as
        | StoredCredentialEnvelopeV1
        | StoredCredentialEnvelopeV2
        | undefined
      if (!envelope) {
        return
      }

      if (envelope.version === 2 && envelope.storage === 'safeStorage') {
        if (
          !isBoundedString(envelope.wrapped, MAX_CREDENTIAL_FILE_BYTES) ||
          !isTimestamp(envelope.updatedAt)
        ) {
          throw new Error('MCP credential envelope is invalid')
        }
        if (!this.isPersistent()) {
          fs.unlinkSync(this.filePath)
          return
        }
        const raw = safeStorage.decryptString(Buffer.from(envelope.wrapped, 'base64'))
        if (Buffer.byteLength(raw, 'utf8') > MAX_CREDENTIAL_PAYLOAD_BYTES) {
          throw new Error('MCP credential payload is oversized')
        }
        this.records = this.normalizeRecords(JSON.parse(raw) as McpCredentialData)
        return
      }

      if (envelope.version !== 1) {
        return
      }

      if (envelope.storage === 'safeStorage' && !this.isPersistent()) {
        fs.unlinkSync(this.filePath)
        return
      }

      const legacyEntries =
        envelope.storage === 'safeStorage'
          ? (() => {
              if (!isBoundedString(envelope.wrapped, MAX_CREDENTIAL_FILE_BYTES)) {
                throw new Error('Legacy MCP credential envelope is invalid')
              }
              const raw = safeStorage.decryptString(Buffer.from(envelope.wrapped, 'base64'))
              if (Buffer.byteLength(raw, 'utf8') > MAX_CREDENTIAL_PAYLOAD_BYTES) {
                throw new Error('Legacy MCP credential payload is oversized')
              }
              return JSON.parse(raw) as LegacyCredentialData
            })()
          : envelope.entries
      this.records = Object.fromEntries(
        Object.entries(legacyEntries)
          .slice(0, MAX_CREDENTIAL_RECORDS)
          .flatMap(([key, value]) => {
            const normalized = this.normalizeInteractiveEntry(value)
            return isBoundedString(key, MAX_CREDENTIAL_KEY_BYTES) && normalized
              ? [
                  [
                    key,
                    {
                      credentialClass: 'interactive_oauth',
                      value: normalized
                    } satisfies InteractiveCredentialRecord
                  ] as const
                ]
              : []
          })
      )

      if (this.isPersistent()) {
        this.persist()
      } else if (envelope.storage === 'file') {
        fs.unlinkSync(this.filePath)
      }
    } catch {
      this.records = {}
      this.loadFailed = true
    }
  }

  private assertWritable(): void {
    if (this.loadFailed) {
      throw new Error('MCP credential store is unavailable')
    }
  }

  private persist(): void {
    if (!this.isPersistent()) {
      try {
        if (fs.existsSync(this.filePath)) {
          fs.unlinkSync(this.filePath)
        }
      } catch {
        // Credentials remain memory-only when secure persistence is unavailable.
      }
      return
    }

    fs.mkdirSync(path.dirname(this.filePath), { recursive: true, mode: 0o700 })
    const envelope: StoredCredentialEnvelopeV2 = {
      version: 2,
      storage: 'safeStorage',
      wrapped: safeStorage
        .encryptString(JSON.stringify(this.normalizeRecords(this.records)))
        .toString('base64'),
      updatedAt: Date.now()
    }
    const temporaryPath = `${this.filePath}.tmp-${process.pid}-${randomBytes(6).toString('hex')}`
    fs.writeFileSync(temporaryPath, JSON.stringify(envelope), {
      encoding: 'utf-8',
      mode: 0o600
    })
    fs.renameSync(temporaryPath, this.filePath)
  }

  private normalizeRecords(records: unknown): McpCredentialData {
    if (!isRecord(records)) {
      return {}
    }

    return Object.fromEntries(
      Object.entries(records)
        .slice(0, MAX_CREDENTIAL_RECORDS)
        .flatMap(([key, record]) => {
          const normalized = this.normalizeRecord(record)
          return isBoundedString(key, MAX_CREDENTIAL_KEY_BYTES) && normalized
            ? [[key, normalized] as const]
            : []
        })
    )
  }

  private normalizeInteractiveEntry(entry: unknown): McpOAuthCredentialEntry | null {
    if (!isRecord(entry)) {
      return null
    }
    if (
      (entry.tokens !== undefined && !isRecord(entry.tokens)) ||
      (entry.clientInformation !== undefined && !isRecord(entry.clientInformation)) ||
      (entry.discoveryState !== undefined && !isRecord(entry.discoveryState)) ||
      (entry.codeVerifier !== undefined && !isBoundedString(entry.codeVerifier, 8192)) ||
      (entry.binding !== undefined && !isCredentialBinding(entry.binding))
    ) {
      return null
    }
    return {
      tokens: entry.tokens as StoredOAuthTokens | undefined,
      clientInformation: entry.clientInformation as StoredOAuthClientInformation | undefined,
      codeVerifier: entry.codeVerifier as string | undefined,
      discoveryState: entry.discoveryState as OAuthDiscoveryState | undefined,
      binding: entry.binding as McpCredentialBinding | undefined,
      updatedAt: isTimestamp(entry.updatedAt) ? entry.updatedAt : Date.now()
    }
  }

  private normalizeRecord(record: unknown): StoredCredentialRecord | null {
    if (
      !isRecord(record) ||
      typeof record.credentialClass !== 'string' ||
      !isRecord(record.value)
    ) {
      return null
    }
    const value = record.value
    if (record.credentialClass === 'interactive_oauth') {
      const interactive = this.normalizeInteractiveEntry(value)
      return interactive ? { credentialClass: 'interactive_oauth', value: interactive } : null
    }
    if (
      record.credentialClass === 'client_secret' ||
      record.credentialClass === 'enterprise_resource_secret'
    ) {
      if (
        !isBoundedString(value.secret, MAX_SECRET_BYTES) ||
        !isCredentialBinding(value.binding) ||
        !isTimestamp(value.updatedAt)
      ) {
        return null
      }
      return {
        credentialClass: record.credentialClass,
        value: value as McpSecretCredential
      }
    }
    if (record.credentialClass === 'private_key') {
      if (
        !isBoundedString(value.privateKey, MAX_PRIVATE_KEY_BYTES) ||
        !['RS256', 'ES256'].includes(String(value.algorithm)) ||
        !isBoundedString(value.fingerprint, 512) ||
        !isCredentialBinding(value.binding) ||
        !isTimestamp(value.updatedAt)
      ) {
        return null
      }
      return {
        credentialClass: 'private_key',
        value: value as McpPrivateKeyCredential
      }
    }
    if (record.credentialClass === 'enterprise_identity') {
      if (
        !isBoundedString(value.profileId, 512) ||
        !isBoundedString(value.issuer, 8192) ||
        !isBoundedString(value.clientId, 8192) ||
        !isBoundedString(value.subject, 8192) ||
        !isBoundedString(value.idToken, MAX_SECRET_BYTES) ||
        (value.subjectLabel !== undefined && !isBoundedString(value.subjectLabel, 8192)) ||
        (value.accessToken !== undefined &&
          !isBoundedString(value.accessToken, MAX_SECRET_BYTES)) ||
        (value.refreshToken !== undefined &&
          !isBoundedString(value.refreshToken, MAX_SECRET_BYTES)) ||
        (value.scope !== undefined && !isBoundedString(value.scope, 8192)) ||
        !isTimestamp(value.expiresAt) ||
        !isTimestamp(value.updatedAt)
      ) {
        return null
      }
      return {
        credentialClass: 'enterprise_identity',
        value: value as McpEnterpriseIdentityCredential
      }
    }
    if (record.credentialClass === 'enterprise_identity_client_secret') {
      if (
        !isBoundedString(value.profileId, 512) ||
        !isBoundedString(value.issuer, 8192) ||
        !isBoundedString(value.clientId, 8192) ||
        !isBoundedString(value.secret, MAX_SECRET_BYTES) ||
        !isTimestamp(value.updatedAt)
      ) {
        return null
      }
      return {
        credentialClass: 'enterprise_identity_client_secret',
        value: value as EnterpriseIdentityClientSecretRecord['value']
      }
    }
    return null
  }
}
