import * as fs from 'node:fs'
import * as path from 'node:path'
import { randomBytes } from 'node:crypto'
import type { CredentialCryptoPort } from '@/config/secretStore'
import type {
  OAuthDiscoveryState,
  StoredOAuthClientInformation,
  StoredOAuthTokens
} from '@modelcontextprotocol/client'
import type { McpCredentialBinding, McpCredentialKind } from '@shared/types/mcp'

export const normalizeMcpOAuthIssuer = (value: string): string => URL.parse(value)?.href ?? value

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

const MAX_PENDING_MUTATIONS = 32
const MAX_NORMAL_MUTATIONS = 24

export class McpOAuthCredentialStore {
  private readonly filePath: string
  private readonly crypto: CredentialCryptoPort
  private loaded = false
  private loadFailed = false
  private loading: Promise<void> | null = null
  private mutations: Promise<void> = Promise.resolve()
  private pendingMutations = 0
  private pendingNormalMutations = 0
  private generation = 0
  private stopped = false
  private records: McpCredentialData = {}

  constructor(options: { filePath: string; crypto: CredentialCryptoPort }) {
    this.filePath = options.filePath
    this.crypto = options.crypto
  }

  stop(): void {
    this.stopped = true
    this.generation++
    this.records = {}
  }

  private captureOperation(): () => void {
    const generation = this.generation
    const check = () => {
      if (this.stopped || generation !== this.generation)
        throw new Error('MCP credential operation interrupted')
    }
    check()
    return check
  }

  async getStorageState(): Promise<McpOAuthCredentialStorage> {
    const check = this.captureOperation()
    try {
      const available = await this.crypto.isAvailable()
      check()
      return available ? 'safeStorage' : 'memory'
    } catch {
      check()
      return 'memory'
    }
  }

  async isPersistent(): Promise<boolean> {
    return (await this.getStorageState()) === 'safeStorage'
  }

  load(key: string): Promise<McpOAuthCredentialEntry | null> {
    return this.read((records) => {
      const record = records[key]
      return record?.credentialClass === 'interactive_oauth' ? record.value : null
    })
  }

  saveEntry(
    key: string,
    entry: Partial<McpOAuthCredentialEntry>
  ): Promise<McpOAuthCredentialEntry> {
    return this.write((records) => {
      const record = records[key]
      const current = record?.credentialClass === 'interactive_oauth' ? record.value : undefined
      const next = { ...current, ...entry, updatedAt: Date.now() }
      return {
        records: this.withRecord(records, key, {
          credentialClass: 'interactive_oauth',
          value: next
        }),
        value: next
      }
    })
  }

  moveInteractiveEntry(
    fromKey: string,
    toKey: string,
    binding: McpCredentialBinding
  ): Promise<{ key: string; entry: McpOAuthCredentialEntry } | null> {
    return this.write((records) => {
      const source = records[fromKey]
      if (source?.credentialClass !== 'interactive_oauth') return { records, value: null }
      const target = records[toKey]
      const entry = {
        ...(target?.credentialClass === 'interactive_oauth' ? target.value : {}),
        ...source.value,
        binding,
        updatedAt: Date.now()
      }
      const next = this.withRecord(records, toKey, {
        credentialClass: 'interactive_oauth',
        value: entry
      })
      if (fromKey !== toKey) delete next[fromKey]
      return { records: next, value: { key: toKey, entry } }
    })
  }

  findInteractiveCredential(
    binding: McpCredentialBinding
  ): Promise<{ key: string; entry: McpOAuthCredentialEntry } | null> {
    return this.read((records) => {
      const matches = Object.entries(records).filter(([, record]) => {
        if (record.credentialClass !== 'interactive_oauth' || !record.value.binding) return false
        const stored = record.value.binding
        return (
          stored.serverId === binding.serverId &&
          stored.configGeneration === binding.configGeneration &&
          stored.bindingHash === binding.bindingHash &&
          stored.endpoint === binding.endpoint &&
          (binding.protectedResourceUrl === undefined ||
            stored.protectedResourceUrl === binding.protectedResourceUrl) &&
          (binding.authorizationServerIssuer === undefined ||
            (stored.authorizationServerIssuer !== undefined &&
              normalizeMcpOAuthIssuer(stored.authorizationServerIssuer) ===
                normalizeMcpOAuthIssuer(binding.authorizationServerIssuer))) &&
          (binding.clientId === undefined || stored.clientId === binding.clientId)
        )
      })
      if (matches.length !== 1) return null
      const [key, record] = matches[0]
      return { key, entry: (record as InteractiveCredentialRecord).value }
    })
  }

  saveClientSecret(
    key: string,
    secret: string,
    binding: McpCredentialBinding
  ): Promise<McpSecretCredential> {
    const value = { secret, binding, updatedAt: Date.now() }
    return this.saveRecord(key, { credentialClass: 'client_secret', value })
  }

  loadClientSecret(key: string): Promise<McpSecretCredential | null> {
    return this.read((records) => {
      const record = records[key]
      return record?.credentialClass === 'client_secret' ? record.value : null
    })
  }

  savePrivateKey(
    key: string,
    input: {
      privateKey: string
      algorithm: 'RS256' | 'ES256'
      fingerprint: string
      binding: McpCredentialBinding
    }
  ): Promise<McpPrivateKeyCredential> {
    const value = { ...input, updatedAt: Date.now() }
    return this.saveRecord(key, { credentialClass: 'private_key', value })
  }

  loadPrivateKey(key: string): Promise<McpPrivateKeyCredential | null> {
    return this.read((records) => {
      const record = records[key]
      return record?.credentialClass === 'private_key' ? record.value : null
    })
  }

  saveEnterpriseResourceSecret(
    key: string,
    secret: string,
    binding: McpCredentialBinding
  ): Promise<McpSecretCredential> {
    const value = { secret, binding, updatedAt: Date.now() }
    return this.saveRecord(key, { credentialClass: 'enterprise_resource_secret', value })
  }

  loadEnterpriseResourceSecret(key: string): Promise<McpSecretCredential | null> {
    return this.read((records) => {
      const record = records[key]
      return record?.credentialClass === 'enterprise_resource_secret' ? record.value : null
    })
  }

  saveEnterpriseIdentity(
    key: string,
    input: Omit<McpEnterpriseIdentityCredential, 'updatedAt'>
  ): Promise<McpEnterpriseIdentityCredential> {
    const value = { ...input, updatedAt: Date.now() }
    return this.saveRecord(key, { credentialClass: 'enterprise_identity', value })
  }

  loadEnterpriseIdentity(key: string): Promise<McpEnterpriseIdentityCredential | null> {
    return this.read((records) => {
      const record = records[key]
      return record?.credentialClass === 'enterprise_identity' ? record.value : null
    })
  }

  saveEnterpriseIdentityClientSecret(
    key: string,
    value: {
      profileId: string
      issuer: string
      clientId: string
      secret: string
    }
  ): Promise<void> {
    return this.saveRecord(key, {
      credentialClass: 'enterprise_identity_client_secret',
      value: { ...value, updatedAt: Date.now() }
    }).then(() => undefined)
  }

  loadEnterpriseIdentityClientSecret(key: string): Promise<string | null> {
    return this.read((records) => {
      const record = records[key]
      return record?.credentialClass === 'enterprise_identity_client_secret'
        ? record.value.secret
        : null
    })
  }

  getCredentialRecordStatus(
    key: string,
    kind: McpCredentialKind
  ): Promise<{ configured: boolean; updatedAt?: number; fingerprint?: string }> {
    return this.read((records) => {
      const record = records[key]
      if (!record || record.credentialClass !== kind) return { configured: false }
      return {
        configured: true,
        updatedAt: record.value.updatedAt,
        ...(record.credentialClass === 'private_key'
          ? { fingerprint: record.value.fingerprint }
          : {})
      }
    })
  }

  clearEntry(key: string): Promise<void> {
    return this.write((records) => {
      if (!records[key]) return { records, value: undefined }
      const next = { ...records }
      delete next[key]
      return { records: next, value: undefined }
    }, true)
  }

  clearEntryScope(
    key: string,
    scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery'
  ): Promise<void> {
    if (scope === 'all') return this.clearEntry(key)
    return this.write((records) => {
      const record = records[key]
      if (record?.credentialClass !== 'interactive_oauth') return { records, value: undefined }
      const value = { ...record.value, updatedAt: Date.now() }
      if (scope === 'client') delete value.clientInformation
      else if (scope === 'tokens') delete value.tokens
      else if (scope === 'verifier') delete value.codeVerifier
      else if (scope === 'discovery') delete value.discoveryState
      return {
        records: this.withRecord(records, key, { credentialClass: 'interactive_oauth', value }),
        value: undefined
      }
    }, true)
  }

  clearServerCredentials(serverId: string): Promise<void> {
    return this.write((records) => {
      const next = { ...records }
      for (const [key, record] of Object.entries(records)) {
        if (
          (record.credentialClass === 'interactive_oauth' &&
            record.value.binding?.serverId === serverId) ||
          ((record.credentialClass === 'client_secret' ||
            record.credentialClass === 'private_key' ||
            record.credentialClass === 'enterprise_resource_secret') &&
            record.value.binding.serverId === serverId)
        )
          delete next[key]
      }
      return {
        records: Object.keys(next).length === Object.keys(records).length ? records : next,
        value: undefined
      }
    }, true)
  }

  clearEnterpriseProfileCredentials(profileId: string): Promise<void> {
    return this.write((records) => {
      const next = { ...records }
      for (const [key, record] of Object.entries(records)) {
        if (
          (record.credentialClass === 'enterprise_identity' ||
            record.credentialClass === 'enterprise_identity_client_secret') &&
          record.value.profileId === profileId
        )
          delete next[key]
      }
      return {
        records: Object.keys(next).length === Object.keys(records).length ? records : next,
        value: undefined
      }
    }, true)
  }

  private async read<T>(select: (records: McpCredentialData) => T): Promise<T> {
    const check = this.captureOperation()
    await this.ensureLoaded()
    await this.mutations
    check()
    return select(this.records)
  }

  private saveRecord<T extends StoredCredentialRecord>(
    key: string,
    record: T
  ): Promise<T['value']> {
    return this.write<T['value']>((records) => ({
      records: this.withRecord(records, key, record),
      value: record.value
    }))
  }

  private withRecord(
    records: McpCredentialData,
    key: string,
    record: StoredCredentialRecord
  ): McpCredentialData {
    if (!isBoundedString(key, MAX_CREDENTIAL_KEY_BYTES))
      throw new Error('MCP credential key is invalid')
    const normalized = this.normalizeRecord(record)
    if (!normalized) throw new Error('MCP credential record is invalid')
    return { ...records, [key]: normalized }
  }

  private async write<T>(
    mutate: (records: McpCredentialData) => { records: McpCredentialData; value: T },
    control = false
  ): Promise<T> {
    const check = this.captureOperation()
    if (
      this.pendingMutations >= MAX_PENDING_MUTATIONS ||
      (!control && this.pendingNormalMutations >= MAX_NORMAL_MUTATIONS)
    )
      return Promise.reject(new Error('MCP credential mutation queue is full'))
    this.pendingMutations++
    if (!control) this.pendingNormalMutations++
    const result = this.mutations.then(async () => {
      check()
      await this.ensureLoaded()
      check()
      this.assertWritable()
      const next = mutate(this.records)
      if (next.records !== this.records) {
        if (
          Object.keys(next.records).length > MAX_CREDENTIAL_RECORDS ||
          Buffer.byteLength(JSON.stringify(next.records), 'utf8') > MAX_CREDENTIAL_PAYLOAD_BYTES
        )
          throw new Error('MCP credential store limit exceeded')
        await this.persist(next.records, check)
        check()
        this.records = next.records
      }
      return next.value
    })
    this.mutations = result.then(
      () => undefined,
      () => undefined
    )
    return result.finally(() => {
      this.pendingMutations--
      if (!control) this.pendingNormalMutations--
      check()
    })
  }

  private ensureLoaded(): Promise<void> {
    this.captureOperation()
    if (this.loaded) return Promise.resolve()
    if (this.loading) return this.loading
    const loading = this.loadFile().finally(() => {
      if (this.loading === loading) this.loading = null
    })
    this.loading = loading
    return loading
  }

  private async loadFile(): Promise<void> {
    const check = this.captureOperation()
    try {
      if (!fs.existsSync(this.filePath)) return
      if (fs.statSync(this.filePath).size > MAX_CREDENTIAL_FILE_BYTES)
        throw new Error('MCP credential file is oversized')
      const serialized = fs.readFileSync(this.filePath, 'utf8')
      if (Buffer.byteLength(serialized, 'utf8') > MAX_CREDENTIAL_FILE_BYTES)
        throw new Error('MCP credential file is oversized')
      const envelope = JSON.parse(serialized) as
        | StoredCredentialEnvelopeV1
        | StoredCredentialEnvelopeV2
        | undefined
      if (!envelope) return
      if (envelope.version === 2 && envelope.storage === 'safeStorage') {
        if (
          !isBoundedString(envelope.wrapped, MAX_CREDENTIAL_FILE_BYTES) ||
          !isTimestamp(envelope.updatedAt)
        )
          throw new Error('MCP credential envelope is invalid')
        const persistent = await this.isPersistent()
        check()
        if (!persistent) {
          fs.unlinkSync(this.filePath)
          return
        }
        const raw = await this.crypto.decrypt(envelope.wrapped)
        check()
        if (Buffer.byteLength(raw, 'utf8') > MAX_CREDENTIAL_PAYLOAD_BYTES)
          throw new Error('MCP credential payload is oversized')
        this.records = this.normalizeRecords(JSON.parse(raw))
        return
      }
      if (envelope.version !== 1) return
      const persistent = await this.isPersistent()
      check()
      let entries: LegacyCredentialData
      if (envelope.storage === 'safeStorage') {
        if (!persistent) {
          fs.unlinkSync(this.filePath)
          return
        }
        if (!isBoundedString(envelope.wrapped, MAX_CREDENTIAL_FILE_BYTES))
          throw new Error('Legacy MCP credential envelope is invalid')
        const raw = await this.crypto.decrypt(envelope.wrapped)
        check()
        if (Buffer.byteLength(raw, 'utf8') > MAX_CREDENTIAL_PAYLOAD_BYTES)
          throw new Error('Legacy MCP credential payload is oversized')
        entries = JSON.parse(raw)
      } else entries = envelope.entries
      const records: McpCredentialData = Object.fromEntries(
        Object.entries(entries)
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
                  ]
                ]
              : []
          })
      )
      if (persistent) await this.persist(records, check)
      else if (envelope.storage === 'file') fs.unlinkSync(this.filePath)
      check()
      this.records = records
    } catch {
      check()
      this.records = {}
      this.loadFailed = true
    } finally {
      if (!this.stopped) this.loaded = true
    }
  }

  private assertWritable(): void {
    if (this.loadFailed) throw new Error('MCP credential store is unavailable')
  }

  private async persist(records: McpCredentialData, check: () => void): Promise<void> {
    const persistent = await this.isPersistent()
    check()
    if (!persistent) {
      try {
        if (fs.existsSync(this.filePath)) fs.unlinkSync(this.filePath)
      } catch {}
      return
    }
    const wrapped = await this.crypto.encrypt(JSON.stringify(this.normalizeRecords(records)))
    check()
    if (!isBoundedString(wrapped, MAX_CREDENTIAL_FILE_BYTES))
      throw new Error('MCP credential envelope is invalid')
    const envelope: StoredCredentialEnvelopeV2 = {
      version: 2,
      storage: 'safeStorage',
      wrapped,
      updatedAt: Date.now()
    }
    const serialized = JSON.stringify(envelope)
    if (Buffer.byteLength(serialized, 'utf8') > MAX_CREDENTIAL_FILE_BYTES)
      throw new Error('MCP credential file is oversized')
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true, mode: 0o700 })
    const temporaryPath =
      this.filePath + '.tmp-' + process.pid + '-' + randomBytes(6).toString('hex')
    try {
      fs.writeFileSync(temporaryPath, serialized, { encoding: 'utf8', mode: 0o600 })
      fs.renameSync(temporaryPath, this.filePath)
    } finally {
      try {
        fs.rmSync(temporaryPath, { force: true })
      } catch {}
    }
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
