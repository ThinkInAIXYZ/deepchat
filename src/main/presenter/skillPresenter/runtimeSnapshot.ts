import { createHash } from 'node:crypto'
import {
  SkillRuntimeUpdatingError,
  type PublishedSkillEntry,
  type PublishedSkillSourceError,
  type SkillExtensionConfig,
  type SkillMetadata,
  type SkillRuntimeSnapshot,
  type SkillScriptDescriptor,
  type WaitForStableSkillRuntimeOptions
} from '@shared/types/skill'

export function stableSerialize(value: unknown): string {
  if (value === undefined) return 'undefined'
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item)).join(',')}]`
  }
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableSerialize(item)}`)
    .join(',')}}`
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested)
  return Object.freeze(value)
}

export function createSkillSourceVersion(value: unknown): string {
  return createHash('sha256').update(stableSerialize(value)).digest('hex')
}

export function freezeSkillMetadata(metadata: SkillMetadata): Readonly<SkillMetadata> {
  return deepFreeze(structuredClone(metadata))
}

export function freezeSkillExtension(config: SkillExtensionConfig): Readonly<SkillExtensionConfig> {
  return deepFreeze(structuredClone(config))
}

export function freezeScriptDescriptors(
  scripts: SkillScriptDescriptor[]
): readonly Readonly<SkillScriptDescriptor>[] {
  return deepFreeze(structuredClone(scripts))
}

export function createMetadataOnlyEntry(
  metadata: SkillMetadata,
  sourceError?: PublishedSkillSourceError
): PublishedSkillEntry {
  const frozenMetadata = freezeSkillMetadata(metadata)
  return Object.freeze({
    sourceVersion: createSkillSourceVersion({
      availability: 'metadata_only',
      metadata: frozenMetadata,
      processArch: process.arch
    }),
    availability: 'metadata_only' as const,
    metadata: frozenMetadata,
    allowedTools: Object.freeze([...(frozenMetadata.allowedTools ?? [])]),
    sourceError: sourceError ? Object.freeze({ ...sourceError }) : undefined
  })
}

class ImmutableMapView<K, V> implements ReadonlyMap<K, V> {
  readonly #entries: Map<K, V>

  constructor(entries: ReadonlyMap<K, V>) {
    this.#entries = new Map(entries)
    Object.freeze(this)
  }

  get size(): number {
    return this.#entries.size
  }

  get(key: K): V | undefined {
    return this.#entries.get(key)
  }

  has(key: K): boolean {
    return this.#entries.has(key)
  }

  entries(): MapIterator<[K, V]> {
    return this.#entries.entries()
  }

  keys(): MapIterator<K> {
    return this.#entries.keys()
  }

  values(): MapIterator<V> {
    return this.#entries.values()
  }

  forEach(callbackfn: (value: V, key: K, map: ReadonlyMap<K, V>) => void, thisArg?: unknown): void {
    for (const [key, value] of this.#entries) {
      callbackfn.call(thisArg, value, key, this)
    }
  }

  [Symbol.iterator](): MapIterator<[K, V]> {
    return this.#entries[Symbol.iterator]()
  }

  get [Symbol.toStringTag](): string {
    return 'ImmutableMapView'
  }
}

export interface SkillRuntimePublishHandle {
  update(updater: (entries: Map<string, PublishedSkillEntry>) => void): void
  end(): void
}

export class SkillRuntimeSnapshotState {
  #epoch = 0
  #snapshot: SkillRuntimeSnapshot = this.#createSnapshot(0, new Map())
  #pendingEntries: Map<string, PublishedSkillEntry> | null = null
  #activePublishCount = 0
  #settlementPromise: Promise<void> | null = null
  #resolveSettlement: (() => void) | null = null

  get epoch(): number {
    return this.#epoch
  }

  get snapshot(): SkillRuntimeSnapshot {
    return this.#snapshot
  }

  get isPublishing(): boolean {
    return this.#epoch % 2 === 1
  }

  get settlementPromise(): Promise<void> | null {
    return this.#settlementPromise
  }

  beginPublish(
    onPublished: (entries: ReadonlyMap<string, PublishedSkillEntry>) => void
  ): SkillRuntimePublishHandle {
    if (this.#activePublishCount === 0) {
      if (this.#epoch % 2 !== 0) {
        throw new Error('Skill runtime publish entered from an unstable epoch')
      }
      this.#advanceEpoch()
      this.#pendingEntries = new Map(this.#snapshot.entries)
      this.#settlementPromise = new Promise<void>((resolve) => {
        this.#resolveSettlement = resolve
      })
    }
    this.#activePublishCount += 1
    let ended = false

    return {
      update: (updater) => {
        if (ended || !this.#pendingEntries || !this.isPublishing) {
          throw new Error('Skill runtime entries can only change inside an active publish window')
        }
        updater(this.#pendingEntries)
      },
      end: () => {
        if (ended) return
        ended = true
        this.#activePublishCount -= 1
        if (this.#activePublishCount > 0) return

        const entries = this.#pendingEntries ?? new Map(this.#snapshot.entries)
        const epoch = this.#advanceEpoch()
        this.#snapshot = this.#createSnapshot(epoch, entries)
        this.#pendingEntries = null
        onPublished(this.#snapshot.entries)
        const resolve = this.#resolveSettlement
        this.#resolveSettlement = null
        this.#settlementPromise = null
        resolve?.()
      }
    }
  }

  replace(
    entries: ReadonlyMap<string, PublishedSkillEntry>,
    onPublished: (published: ReadonlyMap<string, PublishedSkillEntry>) => void
  ): void {
    const publish = this.beginPublish(onPublished)
    try {
      publish.update((pending) => {
        pending.clear()
        for (const [name, entry] of entries) {
          pending.set(name, entry)
        }
      })
    } finally {
      publish.end()
    }
  }

  reset(): void {
    if (this.#activePublishCount !== 0) {
      throw new Error('Cannot reset skill runtime snapshot during publication')
    }
    this.#epoch = 0
    this.#snapshot = this.#createSnapshot(0, new Map())
    this.#pendingEntries = null
    this.#settlementPromise = null
    this.#resolveSettlement = null
  }

  #advanceEpoch(): number {
    if (this.#epoch >= Number.MAX_SAFE_INTEGER) {
      throw new Error('Skill mutation epoch exhausted')
    }
    this.#epoch += 1
    return this.#epoch
  }

  #createSnapshot(
    epoch: number,
    entries: ReadonlyMap<string, PublishedSkillEntry>
  ): SkillRuntimeSnapshot {
    return Object.freeze({
      epoch,
      entries: new ImmutableMapView(entries)
    })
  }
}

interface SkillRuntimeSnapshotCoordinatorOptions {
  stageEntry(metadata: SkillMetadata): Promise<PublishedSkillEntry | null>
  onPublished(entries: ReadonlyMap<string, PublishedSkillEntry>): void
}

export class SkillRuntimeSnapshotCoordinator {
  readonly #state = new SkillRuntimeSnapshotState()
  readonly #readinessStages = new Map<string, Promise<void>>()
  readonly #sourceObservationSequences = new Map<string, number>()
  readonly #sourceDiagnostics = new Map<string, PublishedSkillSourceError>()
  readonly #publishHandles: SkillRuntimePublishHandle[] = []

  constructor(private readonly options: SkillRuntimeSnapshotCoordinatorOptions) {}

  get snapshot(): SkillRuntimeSnapshot {
    return this.#state.snapshot
  }

  async wait(options: WaitForStableSkillRuntimeOptions): Promise<SkillRuntimeSnapshot> {
    this.#throwIfAborted(options.signal)
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const requiredStages = options.requiredSkillNames
        .map((name) => this.#ensureReady(name))
        .filter((stage): stage is Promise<void> => Boolean(stage))
      const pendingPublish = this.#state.isPublishing ? this.#state.settlementPromise : null
      const pending = [...requiredStages, ...(pendingPublish ? [pendingPublish] : [])]
      if (pending.length > 0) {
        await this.#waitForPreparation(Promise.all(pending), options)
      }

      this.#throwIfAborted(options.signal)
      const epochBefore = this.#state.epoch
      const snapshot = this.#state.snapshot
      const epochAfter = this.#state.epoch
      const requiredStillStaging = options.requiredSkillNames.some(
        (name) => snapshot.entries.get(name)?.availability === 'metadata_only'
      )
      if (
        epochBefore === epochAfter &&
        epochBefore % 2 === 0 &&
        snapshot.epoch === epochBefore &&
        !requiredStillStaging
      ) {
        return snapshot
      }
    }
    throw new SkillRuntimeUpdatingError()
  }

  seedFromMetadata(metadata: Iterable<SkillMetadata>): void {
    if (this.snapshot.entries.size > 0) return
    const entries = new Map<string, PublishedSkillEntry>()
    for (const item of metadata) entries.set(item.name, createMetadataOnlyEntry(item))
    if (entries.size > 0) this.replace(entries)
  }

  beginPublish(): () => void {
    const handle = this.#state.beginPublish(this.options.onPublished)
    this.#publishHandles.push(handle)
    return () => {
      const index = this.#publishHandles.lastIndexOf(handle)
      if (index >= 0) this.#publishHandles.splice(index, 1)
      handle.end()
    }
  }

  replace(entries: ReadonlyMap<string, PublishedSkillEntry>): void {
    const end = this.beginPublish()
    try {
      this.#update((pending) => {
        pending.clear()
        for (const [name, entry] of entries) pending.set(name, entry)
      })
    } finally {
      end()
    }
  }

  publishEntry(entry: PublishedSkillEntry, previousName?: string): void {
    const end = this.beginPublish()
    try {
      this.#update((entries) => {
        if (previousName && previousName !== entry.metadata.name) entries.delete(previousName)
        entries.set(entry.metadata.name, entry)
      })
    } finally {
      end()
    }
  }

  remove(name: string): void {
    const end = this.beginPublish()
    try {
      this.#update((entries) => entries.delete(name))
    } finally {
      end()
    }
  }

  publishSourceError(name: string, error: PublishedSkillSourceError, sourcePath?: string): void {
    const current = this.snapshot.entries.get(name)
    if (!current) {
      if (sourcePath) this.setDiagnostic(sourcePath, error)
      return
    }
    this.publishEntry(
      Object.freeze({
        ...current,
        sourceError: Object.freeze({ ...error })
      })
    )
  }

  nextObservation(sourcePath: string): number {
    const next = (this.#sourceObservationSequences.get(sourcePath) ?? 0) + 1
    this.#sourceObservationSequences.set(sourcePath, next)
    return next
  }

  currentObservation(sourcePath: string): number {
    return this.#sourceObservationSequences.get(sourcePath) ?? 0
  }

  isCurrentObservation(sourcePath: string, sequence: number): boolean {
    return this.currentObservation(sourcePath) === sequence
  }

  setDiagnostic(sourcePath: string, error: PublishedSkillSourceError): void {
    this.#sourceDiagnostics.set(sourcePath, Object.freeze({ ...error }))
  }

  deleteDiagnostic(sourcePath: string): void {
    this.#sourceDiagnostics.delete(sourcePath)
  }

  reset(): void {
    this.#sourceObservationSequences.clear()
    this.#readinessStages.clear()
    this.#sourceDiagnostics.clear()
    this.#publishHandles.splice(0)
    this.#state.reset()
  }

  #update(updater: (entries: Map<string, PublishedSkillEntry>) => void): void {
    const handle = this.#publishHandles.at(-1)
    if (!handle) throw new Error('Skill runtime entries can only change inside a publish window')
    handle.update(updater)
  }

  #ensureReady(name: string): Promise<void> | null {
    const entry = this.snapshot.entries.get(name)
    if (!entry || entry.availability !== 'metadata_only') return null
    const existingStage = this.#readinessStages.get(name)
    if (existingStage) return existingStage

    const sourcePath = entry.metadata.path
    const sequence = this.currentObservation(sourcePath)
    const stage = (async () => {
      try {
        const candidate = await this.options.stageEntry(entry.metadata as SkillMetadata)
        if (!this.isCurrentObservation(sourcePath, sequence)) return
        if (!candidate || candidate.metadata.name !== name) {
          this.publishSourceError(
            name,
            { code: 'INVALID_SOURCE', message: 'Skill source did not produce a valid entry' },
            sourcePath
          )
          return
        }
        this.publishEntry(candidate)
      } catch (error) {
        if (!this.isCurrentObservation(sourcePath, sequence)) return
        this.publishSourceError(
          name,
          {
            code: 'SOURCE_READ_FAILED',
            message: error instanceof Error ? error.message : String(error)
          },
          sourcePath
        )
      }
    })()
    this.#readinessStages.set(name, stage)
    void stage.finally(() => {
      if (this.#readinessStages.get(name) === stage) this.#readinessStages.delete(name)
    })
    return stage
  }

  #throwIfAborted(signal: AbortSignal): void {
    if (!signal.aborted) return
    if (signal.reason instanceof Error) throw signal.reason
    throw new DOMException('This operation was aborted', 'AbortError')
  }

  async #waitForPreparation(
    pending: Promise<unknown>,
    options: WaitForStableSkillRuntimeOptions
  ): Promise<void> {
    this.#throwIfAborted(options.signal)
    const remainingMs = Math.max(0, options.deadlineAt - Date.now())
    if (remainingMs === 0) throw new SkillRuntimeUpdatingError()

    await new Promise<void>((resolve, reject) => {
      let settled = false
      const settle = (action: () => void) => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        options.signal.removeEventListener('abort', onAbort)
        action()
      }
      const onAbort = () =>
        settle(() => {
          if (options.signal.reason instanceof Error) reject(options.signal.reason)
          else reject(new DOMException('This operation was aborted', 'AbortError'))
        })
      const timeout = setTimeout(
        () => settle(() => reject(new SkillRuntimeUpdatingError())),
        remainingMs
      )
      options.signal.addEventListener('abort', onAbort, { once: true })
      void pending.then(
        () => settle(resolve),
        (error) => settle(() => reject(error))
      )
    })
  }
}
