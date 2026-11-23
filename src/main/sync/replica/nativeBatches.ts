import { mkdir, readFile, readdir, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import { SyncNativeTransferSchema } from '@shared/contracts/syncNative'
import {
  SYNC_MAX_BATCH_BYTES,
  type SyncBatch,
  type SyncBatchManifest,
  type SyncUnit
} from '@shared/contracts/syncReplica'
import type { DimProfileSnapshot } from '../../agent/dim/profileSnapshot'
import { writeDurableJson } from '../../data/durableFile'
import type { SyncReplicaStore } from './store'
import { SyncNativeFiles } from './nativeFiles'

export function nativeSessionIds(units: readonly SyncUnit[]): string[] {
  return [
    ...new Set(
      units
        .filter((unit) => unit.kind === 'session' && !unit.deleted)
        .flatMap((unit) => [
          ...(unit.tables.dim_session_bindings ?? []),
          ...(unit.tables.dim_session_scopes ?? [])
        ])
        .map((row) => {
          if (typeof row.dim_session_id !== 'string' || !row.dim_session_id)
            throw new Error('Invalid Native Session identity')
          return row.dim_session_id
        })
    )
  ].sort()
}

export interface SyncReplicaNativePort {
  exportSessions(batch: SyncBatch, sessionIds: string[]): Promise<DimProfileSnapshot>
  admit(
    batch: SyncBatch,
    winners: SyncUnit[],
    incoming: { directory: string; manifest: unknown } | undefined,
    commit: (nativeToken?: string) => boolean
  ): Promise<boolean>
}

/** File transport is opaque; all canonical admission belongs to the Native profile port. */
export class SyncNativeBatches {
  readonly files: SyncNativeFiles
  constructor(
    private readonly directory: string,
    private readonly owner?: SyncReplicaNativePort
  ) {
    this.files = new SyncNativeFiles(path.join(directory, 'native-files'))
  }

  private index(id: string): string {
    if (!/^[a-f0-9]{64}$/.test(id)) throw new Error('Invalid sync batch identity')
    return path.join(this.directory, 'native-batches', `${id}.json`)
  }

  async attach(batch: SyncBatch, manifest: SyncBatchManifest): Promise<SyncBatchManifest> {
    const ids = nativeSessionIds(batch.units)
    if (!ids.length) return manifest
    if (!this.owner) throw new Error('sync.tunnel.error.automaticUnsupported')
    let transfer: z.infer<typeof SyncNativeTransferSchema> | undefined
    try {
      transfer = SyncNativeTransferSchema.parse(
        JSON.parse(await readFile(this.index(manifest.id), 'utf8'))
      )
      await this.files.assemble(transfer)
    } catch (error) {
      if (
        (error as NodeJS.ErrnoException).code !== 'ENOENT' &&
        !(error instanceof z.ZodError) &&
        !(error instanceof SyntaxError) &&
        !(error instanceof Error && error.message === 'sync.tunnel.error.integrityFailed')
      )
        throw error
      transfer = undefined
    }
    if (!transfer) {
      // The SQL batch was collected first. Native owners export at least those committed facts.
      const snapshot = await this.owner.exportSessions(batch, ids)
      try {
        transfer = await this.files.prepare(snapshot)
      } finally {
        await snapshot.dispose()
      }
      await mkdir(path.dirname(this.index(manifest.id)), { recursive: true, mode: 0o700 })
      await writeDurableJson(this.index(manifest.id), transfer)
    }
    const result = { ...manifest, nativeProfile: transfer }
    if (Buffer.byteLength(JSON.stringify(result)) > SYNC_MAX_BATCH_BYTES)
      throw new Error('sync.tunnel.error.batchTooLarge')
    return result
  }

  async apply(
    store: SyncReplicaStore,
    batch: SyncBatch,
    manifest: SyncBatchManifest,
    authorized: () => boolean
  ): Promise<boolean> {
    if (!this.owner) {
      if (manifest.nativeProfile || nativeSessionIds(batch.units).length)
        throw new Error('sync.tunnel.error.automaticUnsupported')
      return store.apply(batch, authorized)
    }
    return store.apply(batch, authorized, async (winners, commit) => {
      const incoming =
        manifest.nativeProfile && nativeSessionIds(winners).length
          ? {
              directory: await this.files.assemble(manifest.nativeProfile),
              manifest: manifest.nativeProfile.manifest
            }
          : undefined
      return this.owner!.admit(batch, winners, incoming, commit)
    })
  }

  async prune(keep: ReadonlySet<string>): Promise<void> {
    await this.files.prune(keep)
    const directory = path.join(this.directory, 'native-batches')
    for (const name of await readdir(directory).catch(() => [])) {
      if (!/^[a-f0-9]{64}\.json$/.test(name)) continue
      const file = path.join(directory, name)
      if (Date.now() - (await stat(file)).mtimeMs < 24 * 60 * 60_000) continue
      let retained = false
      try {
        const transfer = SyncNativeTransferSchema.parse(JSON.parse(await readFile(file, 'utf8')))
        retained = keep.has(transfer.id)
      } catch (error) {
        if (!(error instanceof SyntaxError) && !(error instanceof z.ZodError)) throw error
      }
      if (!retained) await rm(file, { force: true })
    }
  }

  async discard(manifest: SyncBatchManifest): Promise<void> {
    await rm(this.index(manifest.id), { force: true })
    if (manifest.nativeProfile) await this.files.discard(manifest.nativeProfile)
  }
}
