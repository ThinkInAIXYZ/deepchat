import { createHash, randomBytes } from 'node:crypto'
import type { ReadStream } from 'node:fs'
import type { FileHandle } from 'node:fs/promises'
import { chmod, link, lstat, mkdir, open, readdir, unlink } from 'node:fs/promises'
import path from 'node:path'
import {
  ArtifactMetadataSchema,
  type ArtifactMetadata
} from '@shared/contracts/routes/artifacts.routes'
import type { CliRouteCaller } from '@/routes/routeRegistry'
import { CliRequestError } from './errors'

const DEFAULT_ARTIFACT_TTL_MS = 60 * 60_000
const MAX_ARTIFACT_TTL_MS = 7 * 24 * 60 * 60_000
const DEFAULT_CLEANUP_INTERVAL_MS = 60_000
const OWNED_FILE_PATTERN = /^(?:\.[A-Za-z0-9_-]{16,128}\.tmp|[A-Za-z0-9_-]{16,128}\.artifact)$/

export type ArtifactSpoolLimits = Readonly<{
  maxArtifactBytes: number
  maxRequestBytes: number
  maxConnectionBytes: number
  maxOwnerBytes: number
  maxTotalBytes: number
  maxRequestCount: number
  maxConnectionCount: number
  maxOwnerCount: number
  maxTotalCount: number
}>

const DEFAULT_LIMITS: ArtifactSpoolLimits = {
  maxArtifactBytes: 512 * 1024 * 1024,
  maxRequestBytes: 768 * 1024 * 1024,
  maxConnectionBytes: 1024 * 1024 * 1024,
  maxOwnerBytes: 1024 * 1024 * 1024,
  maxTotalBytes: 2 * 1024 * 1024 * 1024,
  maxRequestCount: 16,
  maxConnectionCount: 64,
  maxOwnerCount: 128,
  maxTotalCount: 256
}

type ArtifactOwner = Readonly<{
  principal: 'human' | 'agent'
  conversationId?: string
}>

type StoredArtifact = Readonly<{
  metadata: ArtifactMetadata
  filePath: string
  ownerKey: string
  requestKey: string
  connectionId: string
}>

type QuotaReservation = {
  bytes: number
  count: number
}

export type ArtifactWriteInput = Readonly<{
  caller: CliRouteCaller
  requestId: string
  mimeType: string
  suggestedFilename?: string
  data: Uint8Array | AsyncIterable<Uint8Array>
  ttlMs?: number
  signal?: AbortSignal
}>

export type OpenArtifact = Readonly<{
  metadata: ArtifactMetadata
  stream: ReadStream
}>

export type ArtifactInputFile = Readonly<{
  metadata: ArtifactMetadata
  path: string
}>

type OpenArtifactHandle = Readonly<{
  artifact: StoredArtifact
  handle: FileHandle
  release: () => void
}>

export type ArtifactSpoolOptions = Readonly<{
  directory: string
  limits?: Partial<ArtifactSpoolLimits>
  consumeAgentBytes?: (tokenId: string, bytes: number) => boolean
  now?: () => number
  createId?: () => string
  cleanupIntervalMs?: number
  log?: Pick<Console, 'warn'>
}>

function ownerForCaller(caller: CliRouteCaller): ArtifactOwner {
  return caller.principal === 'human'
    ? { principal: 'human' }
    : { principal: 'agent', conversationId: caller.conversationId }
}

function ownerKey(owner: ArtifactOwner): string {
  return owner.principal === 'human' ? 'human' : `agent:${owner.conversationId ?? ''}`
}

function requestKey(owner: string, requestId: string): string {
  return JSON.stringify([owner, requestId])
}

function normalizeMimeType(value: string): string {
  return ArtifactMetadataSchema.shape.mimeType.parse(value.trim().toLowerCase())
}

export function artifactExtensionForMimeType(mimeType: string): string {
  switch (mimeType.split(';', 1)[0]) {
    case 'image/png':
      return '.png'
    case 'image/jpeg':
      return '.jpg'
    case 'image/webp':
      return '.webp'
    case 'image/gif':
      return '.gif'
    case 'image/avif':
      return '.avif'
    case 'video/mp4':
      return '.mp4'
    case 'video/webm':
      return '.webm'
    case 'audio/mpeg':
      return '.mp3'
    case 'audio/wav':
      return '.wav'
    case 'audio/ogg':
      return '.ogg'
    case 'audio/aac':
      return '.aac'
    case 'audio/flac':
      return '.flac'
    case 'audio/pcm':
      return '.pcm'
    default:
      return '.bin'
  }
}

function normalizeFilename(value: string | undefined, mimeType: string): string {
  const sanitized = Buffer.from(value ?? '', 'utf8')
    .toString('utf8')
    .normalize('NFC')
    .replace(/[\\/]/g, '_')
    .replace(/\p{Cc}/gu, '_')
    .trim()
  let normalized = ''
  for (const character of sanitized) {
    if (normalized.length + character.length > 255) break
    normalized += character
  }
  return normalized && normalized !== '.' && normalized !== '..'
    ? normalized
    : `artifact${artifactExtensionForMimeType(mimeType)}`
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive safe integer`)
  }
  return value
}

async function writeAll(handle: FileHandle, bytes: Uint8Array, position: number): Promise<number> {
  let offset = 0
  while (offset < bytes.byteLength) {
    const { bytesWritten } = await handle.write(
      bytes,
      offset,
      bytes.byteLength - offset,
      position + offset
    )
    if (bytesWritten <= 0) throw new Error('Artifact output write made no progress')
    offset += bytesWritten
  }
  return position + bytes.byteLength
}

function throwIfArtifactWriteCancelled(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new CliRequestError('cancelled', 'Artifact output was cancelled')
  }
}

async function* artifactChunks(
  data: Uint8Array | AsyncIterable<Uint8Array>
): AsyncGenerator<Uint8Array> {
  if (data instanceof Uint8Array) {
    yield data
    return
  }
  for await (const chunk of data) {
    if (!(chunk instanceof Uint8Array)) {
      throw new CliRequestError('invalid_request', 'Artifact stream yielded a non-byte chunk')
    }
    yield chunk
  }
}

export class ArtifactSpool {
  private readonly limits: ArtifactSpoolLimits
  private readonly now: () => number
  private readonly createId: () => string
  private readonly cleanupIntervalMs: number
  private readonly log: Pick<Console, 'warn'>
  private readonly artifacts = new Map<string, StoredArtifact>()
  private readonly storedOwnerUsage = new Map<string, QuotaReservation>()
  private readonly storedRequestUsage = new Map<string, QuotaReservation>()
  private readonly storedConnectionUsage = new Map<string, QuotaReservation>()
  private readonly ownerReservations = new Map<string, QuotaReservation>()
  private readonly requestReservations = new Map<string, QuotaReservation>()
  private readonly connectionReservations = new Map<string, QuotaReservation>()
  private readonly allocatedIds = new Set<string>()
  private storedBytes = 0
  private reservedBytes = 0
  private reservedCount = 0
  private activeWrites = 0
  private readonly activeReads = new Map<string, number>()
  private readonly openReadStreams = new Set<ReadStream>()
  private readonly pendingRemovalIds = new Set<string>()
  private readonly removalPromises = new Map<string, Promise<void>>()
  private readonly writeDrainListeners = new Set<() => void>()
  private readonly readDrainListeners = new Set<() => void>()
  private closing = false
  private initializePromise: Promise<void> | undefined
  private closePromise: Promise<void> | undefined
  private cleanupTimer: NodeJS.Timeout | undefined

  constructor(private readonly options: ArtifactSpoolOptions) {
    this.limits = {
      ...DEFAULT_LIMITS,
      ...options.limits
    }
    for (const [name, value] of Object.entries(this.limits)) positiveInteger(value, name)
    this.now = options.now ?? Date.now
    this.createId = options.createId ?? (() => randomBytes(24).toString('base64url'))
    this.cleanupIntervalMs = positiveInteger(
      options.cleanupIntervalMs ?? DEFAULT_CLEANUP_INTERVAL_MS,
      'cleanupIntervalMs'
    )
    this.log = options.log ?? console
  }

  async initialize(): Promise<void> {
    if (this.closing) {
      throw new CliRequestError('unavailable', 'Artifact spool is closed', { httpStatus: 503 })
    }
    if (this.initializePromise) return await this.initializePromise
    this.initializePromise = this.initializeInternal().catch((error) => {
      this.initializePromise = undefined
      throw error
    })
    return await this.initializePromise
  }

  private async initializeInternal(): Promise<void> {
    await mkdir(this.options.directory, { recursive: true, mode: 0o700 })
    const directoryStat = await lstat(this.options.directory)
    if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) {
      throw new Error('Artifact spool path is not a regular directory')
    }
    if (typeof process.getuid === 'function' && directoryStat.uid !== process.getuid()) {
      throw new Error('Artifact spool directory is owned by another user')
    }
    if (process.platform !== 'win32') {
      await chmod(this.options.directory, 0o700)
      const protectedStat = await lstat(this.options.directory)
      if ((protectedStat.mode & 0o077) !== 0) {
        throw new Error('Artifact spool directory permissions are not private')
      }
    }

    for (const entry of await readdir(this.options.directory, { withFileTypes: true })) {
      if (!OWNED_FILE_PATTERN.test(entry.name)) continue
      if (entry.isFile() || entry.isSymbolicLink()) {
        await unlink(path.join(this.options.directory, entry.name))
      }
    }

    this.cleanupTimer = setInterval(() => {
      void this.cleanupExpired().catch((error) => {
        this.log.warn('[CLI] Failed to clean expired artifacts', error)
      })
    }, this.cleanupIntervalMs)
    this.cleanupTimer.unref()
  }

  async write(input: ArtifactWriteInput): Promise<ArtifactMetadata> {
    if (this.closing) {
      throw new CliRequestError('unavailable', 'Artifact spool is closed', { httpStatus: 503 })
    }
    this.activeWrites += 1
    try {
      return await this.writeInternal(input)
    } finally {
      this.activeWrites = Math.max(0, this.activeWrites - 1)
      if (this.activeWrites === 0) {
        for (const listener of this.writeDrainListeners) listener()
        this.writeDrainListeners.clear()
      }
    }
  }

  private async writeInternal(input: ArtifactWriteInput): Promise<ArtifactMetadata> {
    throwIfArtifactWriteCancelled(input.signal)
    await this.initialize()
    const owner = ownerForCaller(input.caller)
    const ownerQuotaKey = ownerKey(owner)
    const requestQuotaKey = requestKey(ownerQuotaKey, input.requestId)
    const connectionQuotaKey = input.caller.connectionId
    const mimeType = normalizeMimeType(input.mimeType)
    const requestId = ArtifactMetadataSchema.shape.requestId.parse(input.requestId)
    const filename = normalizeFilename(input.suggestedFilename, mimeType)
    const ttlMs = positiveInteger(input.ttlMs ?? DEFAULT_ARTIFACT_TTL_MS, 'ttlMs')
    if (ttlMs > MAX_ARTIFACT_TTL_MS) {
      throw new Error('Artifact expiry is outside the supported range')
    }
    this.reserveArtifact(ownerQuotaKey, requestQuotaKey, connectionQuotaKey)

    let id = ''
    let tempPath = ''
    let finalPath = ''
    let published = false
    let size = 0
    let reservedSize = 0
    try {
      id = this.allocateId()
      tempPath = path.join(this.options.directory, `.${id}.tmp`)
      finalPath = path.join(this.options.directory, `${id}.artifact`)
      let metadata: ArtifactMetadata
      const handle = await open(tempPath, 'wx', 0o600)
      try {
        const hash = createHash('sha256')
        let position = 0
        for await (const chunk of artifactChunks(input.data)) {
          throwIfArtifactWriteCancelled(input.signal)
          if (chunk.byteLength === 0) continue
          if (chunk.byteLength > this.limits.maxArtifactBytes - size) {
            throw new CliRequestError(
              'body_too_large',
              'Artifact exceeds the per-file byte limit',
              {
                httpStatus: 413
              }
            )
          }
          if (
            input.caller.principal === 'agent' &&
            !this.options.consumeAgentBytes?.(input.caller.tokenId, chunk.byteLength)
          ) {
            throw new CliRequestError('rate_limited', 'Agent CLI token byte quota is exhausted', {
              httpStatus: 429
            })
          }
          this.reserveBytes(ownerQuotaKey, requestQuotaKey, connectionQuotaKey, chunk.byteLength)
          reservedSize += chunk.byteLength
          position = await writeAll(handle, chunk, position)
          size += chunk.byteLength
          hash.update(chunk)
        }
        throwIfArtifactWriteCancelled(input.signal)
        if (size === 0) {
          throw new CliRequestError('invalid_request', 'Artifact output is empty')
        }
        await handle.sync()
        throwIfArtifactWriteCancelled(input.signal)
        const createdAt = this.now()
        if (createdAt > Number.MAX_SAFE_INTEGER - ttlMs) {
          throw new Error('Artifact expiry is outside the supported range')
        }
        metadata = ArtifactMetadataSchema.parse({
          id,
          requestId,
          owner: owner.principal,
          mimeType,
          size,
          sha256: hash.digest('hex'),
          filename,
          createdAt,
          expiresAt: createdAt + ttlMs
        })
      } finally {
        await handle.close()
      }
      throwIfArtifactWriteCancelled(input.signal)
      if (process.platform !== 'win32') await chmod(tempPath, 0o600)
      throwIfArtifactWriteCancelled(input.signal)
      await link(tempPath, finalPath)
      published = true
      throwIfArtifactWriteCancelled(input.signal)
      await unlink(tempPath)
      tempPath = ''
      throwIfArtifactWriteCancelled(input.signal)
      this.recordStoredArtifact({
        metadata,
        filePath: finalPath,
        ownerKey: ownerQuotaKey,
        requestKey: requestQuotaKey,
        connectionId: connectionQuotaKey
      })
      return metadata
    } catch (error) {
      if (tempPath) await unlink(tempPath).catch(() => undefined)
      if (published && finalPath) await unlink(finalPath).catch(() => undefined)
      throw error
    } finally {
      if (id) this.allocatedIds.delete(id)
      this.releaseReservation(ownerQuotaKey, requestQuotaKey, connectionQuotaKey, reservedSize)
    }
  }

  async describe(id: string, caller: CliRouteCaller): Promise<ArtifactMetadata> {
    await this.initialize()
    const artifact = await this.getAuthorizedArtifact(id, caller)
    return artifact.metadata
  }

  async openRead(id: string, caller: CliRouteCaller): Promise<OpenArtifact> {
    const opened = await this.openAuthorizedHandle(id, caller)
    try {
      let stream: ReadStream
      try {
        stream = opened.handle.createReadStream({ autoClose: true })
      } catch (error) {
        await opened.handle.close().catch(() => undefined)
        throw error
      }
      this.openReadStreams.add(stream)
      stream.once('close', () => {
        this.openReadStreams.delete(stream)
        opened.release()
      })
      if (this.closing) stream.destroy()
      return { metadata: opened.artifact.metadata, stream }
    } catch (error) {
      opened.release()
      throw error
    }
  }

  async withFile<T>(
    id: string,
    caller: CliRouteCaller,
    operation: (file: ArtifactInputFile) => Promise<T>
  ): Promise<T> {
    const opened = await this.openAuthorizedHandle(id, caller)
    try {
      return await operation({
        metadata: opened.artifact.metadata,
        path: opened.artifact.filePath
      })
    } finally {
      await opened.handle.close().catch(() => undefined)
      opened.release()
    }
  }

  async delete(id: string, caller: CliRouteCaller): Promise<void> {
    await this.initialize()
    const artifact = await this.getAuthorizedArtifact(id, caller)
    await this.removeStoredArtifact(artifact, 'reject')
  }

  async discard(id: string): Promise<void> {
    await this.initialize()
    const artifact = this.artifacts.get(id)
    if (artifact) await this.removeStoredArtifact(artifact)
  }

  async cleanupExpired(): Promise<void> {
    if (this.closing) return
    await this.initialize()
    const now = this.now()
    const expired = Array.from(this.artifacts.values()).filter(
      (artifact) => artifact.metadata.expiresAt <= now
    )
    await Promise.all(expired.map((artifact) => this.removeStoredArtifact(artifact)))
  }

  async close(): Promise<void> {
    if (this.closePromise) return await this.closePromise
    this.closing = true
    this.closePromise = this.closeInternal()
    return await this.closePromise
  }

  private async closeInternal(): Promise<void> {
    if (this.initializePromise) await this.initializePromise.catch(() => undefined)
    if (this.activeWrites > 0) {
      await new Promise<void>((resolve) => this.writeDrainListeners.add(resolve))
    }
    for (const stream of this.openReadStreams) stream.destroy()
    if (this.activeReads.size > 0) {
      await new Promise<void>((resolve) => this.readDrainListeners.add(resolve))
    }
    if (this.cleanupTimer) clearInterval(this.cleanupTimer)
    this.cleanupTimer = undefined
    await Promise.all(
      Array.from(this.artifacts.values()).map((artifact) => this.removeStoredArtifact(artifact))
    )
    this.artifacts.clear()
    this.activeReads.clear()
    this.openReadStreams.clear()
    this.pendingRemovalIds.clear()
    this.removalPromises.clear()
    this.storedOwnerUsage.clear()
    this.storedRequestUsage.clear()
    this.storedConnectionUsage.clear()
    this.ownerReservations.clear()
    this.requestReservations.clear()
    this.connectionReservations.clear()
    this.allocatedIds.clear()
    this.storedBytes = 0
    this.reservedBytes = 0
    this.reservedCount = 0
  }

  private allocateId(): string {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const id = this.createId()
      if (!/^[A-Za-z0-9_-]{16,128}$/.test(id)) {
        throw new Error('Artifact ID generator returned an invalid identifier')
      }
      if (!this.artifacts.has(id) && !this.allocatedIds.has(id)) {
        this.allocatedIds.add(id)
        return id
      }
    }
    throw new Error('Unable to allocate a unique artifact ID')
  }

  private reserveArtifact(owner: string, request: string, connection: string): void {
    if (
      this.quotaUsage(this.storedOwnerUsage, this.ownerReservations, owner).count + 1 >
        this.limits.maxOwnerCount ||
      this.quotaUsage(this.storedRequestUsage, this.requestReservations, request).count + 1 >
        this.limits.maxRequestCount ||
      this.quotaUsage(this.storedConnectionUsage, this.connectionReservations, connection).count +
        1 >
        this.limits.maxConnectionCount ||
      this.artifacts.size + this.reservedCount + 1 > this.limits.maxTotalCount
    ) {
      throw this.quotaError()
    }
    this.addQuotaUsage(this.ownerReservations, owner, 0, 1)
    this.addQuotaUsage(this.requestReservations, request, 0, 1)
    this.addQuotaUsage(this.connectionReservations, connection, 0, 1)
    this.reservedCount += 1
  }

  private reserveBytes(owner: string, request: string, connection: string, bytes: number): void {
    if (
      this.quotaUsage(this.storedOwnerUsage, this.ownerReservations, owner).bytes + bytes >
        this.limits.maxOwnerBytes ||
      this.quotaUsage(this.storedRequestUsage, this.requestReservations, request).bytes + bytes >
        this.limits.maxRequestBytes ||
      this.quotaUsage(this.storedConnectionUsage, this.connectionReservations, connection).bytes +
        bytes >
        this.limits.maxConnectionBytes ||
      this.storedBytes + this.reservedBytes + bytes > this.limits.maxTotalBytes
    ) {
      throw this.quotaError()
    }
    this.addQuotaUsage(this.ownerReservations, owner, bytes, 0)
    this.addQuotaUsage(this.requestReservations, request, bytes, 0)
    this.addQuotaUsage(this.connectionReservations, connection, bytes, 0)
    this.reservedBytes += bytes
  }

  private quotaUsage(
    storedUsage: ReadonlyMap<string, QuotaReservation>,
    reservations: ReadonlyMap<string, QuotaReservation>,
    key: string
  ): QuotaReservation {
    const stored = storedUsage.get(key)
    const reserved = reservations.get(key)
    return {
      bytes: (stored?.bytes ?? 0) + (reserved?.bytes ?? 0),
      count: (stored?.count ?? 0) + (reserved?.count ?? 0)
    }
  }

  private addQuotaUsage(
    usageByKey: Map<string, QuotaReservation>,
    key: string,
    bytes: number,
    count: number
  ): void {
    const usage = usageByKey.get(key) ?? { bytes: 0, count: 0 }
    usage.bytes += bytes
    usage.count += count
    usageByKey.set(key, usage)
  }

  private releaseReservation(
    owner: string,
    request: string,
    connection: string,
    bytes: number
  ): void {
    this.subtractQuotaUsage(this.ownerReservations, owner, bytes, 1)
    this.subtractQuotaUsage(this.requestReservations, request, bytes, 1)
    this.subtractQuotaUsage(this.connectionReservations, connection, bytes, 1)
    this.reservedBytes = Math.max(0, this.reservedBytes - bytes)
    this.reservedCount = Math.max(0, this.reservedCount - 1)
  }

  private subtractQuotaUsage(
    usageByKey: Map<string, QuotaReservation>,
    key: string,
    bytes: number,
    count: number
  ): void {
    const usage = usageByKey.get(key)
    if (!usage) return
    usage.bytes = Math.max(0, usage.bytes - bytes)
    usage.count = Math.max(0, usage.count - count)
    if (usage.bytes === 0 && usage.count === 0) usageByKey.delete(key)
  }

  private recordStoredArtifact(artifact: StoredArtifact): void {
    const id = artifact.metadata.id
    if (this.artifacts.has(id)) throw new Error('Artifact ID is already stored')
    this.artifacts.set(id, artifact)
    this.addQuotaUsage(this.storedOwnerUsage, artifact.ownerKey, artifact.metadata.size, 1)
    this.addQuotaUsage(this.storedRequestUsage, artifact.requestKey, artifact.metadata.size, 1)
    this.addQuotaUsage(this.storedConnectionUsage, artifact.connectionId, artifact.metadata.size, 1)
    this.storedBytes += artifact.metadata.size
  }

  private forgetStoredArtifact(artifact: StoredArtifact): void {
    const id = artifact.metadata.id
    if (this.artifacts.get(id) !== artifact) return
    this.artifacts.delete(id)
    this.subtractQuotaUsage(this.storedOwnerUsage, artifact.ownerKey, artifact.metadata.size, 1)
    this.subtractQuotaUsage(this.storedRequestUsage, artifact.requestKey, artifact.metadata.size, 1)
    this.subtractQuotaUsage(
      this.storedConnectionUsage,
      artifact.connectionId,
      artifact.metadata.size,
      1
    )
    this.storedBytes = Math.max(0, this.storedBytes - artifact.metadata.size)
  }

  private quotaError(): CliRequestError {
    return new CliRequestError('rate_limited', 'Artifact spool quota is exhausted', {
      httpStatus: 429,
      retriable: true
    })
  }

  private async getAuthorizedArtifact(id: string, caller: CliRouteCaller): Promise<StoredArtifact> {
    const artifact = this.artifacts.get(id)
    if (!artifact || this.pendingRemovalIds.has(id) || this.removalPromises.has(id)) {
      throw new CliRequestError('not_found', 'Artifact was not found', { httpStatus: 404 })
    }
    if (artifact.metadata.expiresAt <= this.now()) {
      await this.removeStoredArtifact(artifact)
      throw new CliRequestError('not_found', 'Artifact has expired', { httpStatus: 404 })
    }
    if (caller.principal === 'agent' && artifact.ownerKey !== ownerKey(ownerForCaller(caller))) {
      throw new CliRequestError('permission_denied', 'Artifact belongs to another caller', {
        httpStatus: 403
      })
    }
    return artifact
  }

  private async openAuthorizedHandle(
    id: string,
    caller: CliRouteCaller
  ): Promise<OpenArtifactHandle> {
    await this.initialize()
    const artifact = await this.getAuthorizedArtifact(id, caller)
    const release = this.acquireRead(artifact)
    try {
      const fileStat = await lstat(artifact.filePath).catch(() => null)
      if (
        !fileStat?.isFile() ||
        fileStat.isSymbolicLink() ||
        fileStat.size !== artifact.metadata.size
      ) {
        await this.removeStoredArtifact(artifact).catch((error) => {
          this.log.warn('[CLI] Failed to remove invalid artifact', error)
        })
        throw new CliRequestError('unavailable', 'Artifact data is unavailable', {
          httpStatus: 410
        })
      }
      const handle = await open(artifact.filePath, 'r').catch(async () => {
        await this.removeStoredArtifact(artifact).catch((error) => {
          this.log.warn('[CLI] Failed to remove unavailable artifact', error)
        })
        throw new CliRequestError('unavailable', 'Artifact data is unavailable', {
          httpStatus: 410
        })
      })
      const openedStat = await handle.stat().catch(() => null)
      if (
        !openedStat?.isFile() ||
        openedStat.size !== artifact.metadata.size ||
        openedStat.dev !== fileStat.dev ||
        openedStat.ino !== fileStat.ino
      ) {
        await handle.close().catch(() => undefined)
        await this.removeStoredArtifact(artifact).catch((error) => {
          this.log.warn('[CLI] Failed to remove changed artifact', error)
        })
        throw new CliRequestError('unavailable', 'Artifact data changed before it could be read', {
          httpStatus: 410
        })
      }
      if (this.closing) {
        await handle.close().catch(() => undefined)
        throw new CliRequestError('unavailable', 'Artifact spool is closed', { httpStatus: 503 })
      }
      return { artifact, handle, release }
    } catch (error) {
      release()
      throw error
    }
  }

  private acquireRead(artifact: StoredArtifact): () => void {
    const id = artifact.metadata.id
    if (
      this.artifacts.get(id) !== artifact ||
      this.pendingRemovalIds.has(id) ||
      this.removalPromises.has(id)
    ) {
      throw new CliRequestError('not_found', 'Artifact was not found', { httpStatus: 404 })
    }
    this.activeReads.set(id, (this.activeReads.get(id) ?? 0) + 1)
    let released = false
    return () => {
      if (released) return
      released = true
      const remaining = Math.max(0, (this.activeReads.get(id) ?? 1) - 1)
      if (remaining > 0) {
        this.activeReads.set(id, remaining)
        return
      }
      this.activeReads.delete(id)
      if (this.pendingRemovalIds.delete(id)) {
        const current = this.artifacts.get(id)
        if (current) {
          void this.removeStoredArtifact(current).catch((error) => {
            this.log.warn('[CLI] Failed to remove released artifact', error)
          })
        }
      }
      if (this.activeReads.size === 0) {
        for (const listener of this.readDrainListeners) listener()
        this.readDrainListeners.clear()
      }
    }
  }

  private async removeStoredArtifact(
    artifact: StoredArtifact,
    activeReadBehavior: 'defer' | 'reject' = 'defer'
  ): Promise<void> {
    if (this.artifacts.get(artifact.metadata.id) !== artifact) return
    const id = artifact.metadata.id
    const existingRemoval = this.removalPromises.get(id)
    if (existingRemoval) return await existingRemoval
    if ((this.activeReads.get(id) ?? 0) > 0) {
      if (activeReadBehavior === 'reject') {
        throw new CliRequestError('conflict', 'Artifact is currently in use', {
          httpStatus: 409,
          retriable: true
        })
      }
      this.pendingRemovalIds.add(id)
      return
    }

    const removal = (async () => {
      await unlink(artifact.filePath).catch((error) => {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      })
      this.forgetStoredArtifact(artifact)
      this.pendingRemovalIds.delete(id)
    })()
    this.removalPromises.set(id, removal)
    try {
      await removal
    } finally {
      if (this.removalPromises.get(id) === removal) this.removalPromises.delete(id)
    }
  }
}
