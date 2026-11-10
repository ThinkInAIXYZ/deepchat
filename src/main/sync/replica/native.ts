import type Database from 'better-sqlite3-multiple-ciphers'
import type { SyncBatch, SyncUnit } from '@shared/contracts/syncReplica'
import type { DimRuntimeSupervisor } from '../../agent/dim/runtimeSupervisor'
import type { DimSessionRuntime } from '../../agent/dim/sessionRuntime'
import { DimProfileBackups, type PreparedDimProfile } from '../../agent/dim/profileBackups'
import { DimMethodError } from '../../agent/dim/pluginClient'
import { nativeSessionIds, type SyncReplicaNativePort } from './nativeBatches'
import { NativeReplicaRecovery } from './nativeRecovery'

/** Desktop coordinates directory ownership and product metadata; Native owns every content edit. */
export class SyncReplicaNative implements SyncReplicaNativePort {
  constructor(
    private readonly deps: {
      root: string
      database(): Database.Database
      backups: DimProfileBackups
      host: DimRuntimeSupervisor
      readers(): Pick<DimSessionRuntime, 'withSuspendedReaders'>
      exportGuard<T>(batch: SyncBatch, operation: () => Promise<T>): Promise<T>
    }
  ) {}

  async exportSessions(batch: SyncBatch, ids: string[]) {
    try {
      return await this.deps.exportGuard(batch, () => this.deps.backups.exportSessions(ids))
    } catch (error) {
      if (
        error instanceof DimMethodError &&
        error.data &&
        typeof error.data === 'object' &&
        !Array.isArray(error.data) &&
        error.data.appError === 'daemon_busy'
      )
        throw new Error('sync.tunnel.error.busy', { cause: error })
      throw error
    }
  }

  private localSessions(units: SyncUnit[]): string[] {
    const db = this.deps.database()
    const ids = new Set<string>()
    for (const table of ['dim_session_bindings', 'dim_session_scopes']) {
      if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table))
        continue
      const query = db.prepare(`SELECT dim_session_id FROM "${table}" WHERE session_id=?`)
      for (const unit of units)
        if (unit.kind === 'session') {
          for (const row of query.all(unit.id) as { dim_session_id: string }[])
            ids.add(row.dim_session_id)
        }
    }
    return [...ids].sort()
  }

  private assertOwnership(units: SyncUnit[]): void {
    const db = this.deps.database()
    const sessions = new Set(units.filter((unit) => unit.kind === 'session').map((unit) => unit.id))
    const incoming = new Map<string, string>()
    const hasScopes = db
      .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='dim_session_scopes'")
      .get()
    for (const unit of units) {
      if (unit.kind !== 'session' || unit.deleted) continue
      for (const row of [
        ...(unit.tables.dim_session_bindings ?? []),
        ...(unit.tables.dim_session_scopes ?? [])
      ]) {
        if (typeof row.dim_session_id !== 'string' || typeof row.branch_id !== 'string')
          throw new Error('Invalid Native scope identity')
        const key = JSON.stringify([row.dim_session_id, row.branch_id])
        const owner = incoming.get(key)
        if (owner && owner !== unit.id)
          throw new Error('Native scope belongs to another desktop Session')
        incoming.set(key, unit.id)
        if (hasScopes) {
          const stored = db
            .prepare(
              'SELECT session_id FROM dim_session_scopes WHERE dim_session_id=? AND branch_id=?'
            )
            .get(row.dim_session_id, row.branch_id) as { session_id: string } | undefined
          if (stored && stored.session_id !== unit.id && !sessions.has(stored.session_id))
            throw new Error('Native scope belongs to another desktop Session')
        }
      }
    }
  }

  async admit(
    batch: SyncBatch,
    winners: SyncUnit[],
    incoming: { directory: string; manifest: unknown } | undefined,
    commit: (nativeToken?: string) => boolean
  ): Promise<boolean> {
    const source = nativeSessionIds(winners)
    const local = this.localSessions(winners)
    if (!source.length && !local.length) return commit()
    if (source.length && !incoming) throw new Error('Native replica content is missing')
    this.assertOwnership(winners)
    try {
      return await this.deps.readers().withSuspendedReaders(() =>
        this.deps.host.withStopped(
          async () => {
            const db = this.deps.database()
            await NativeReplicaRecovery.recover(this.deps.root, db)
            let prepared: PreparedDimProfile | undefined
            let installed: Awaited<ReturnType<PreparedDimProfile['install']>> | undefined
            let journal: NativeReplicaRecovery | undefined
            let committed = false
            let applied = false
            const failures: unknown[] = []
            try {
              prepared = await this.deps.backups.prepareReplica(incoming, source, local)
              journal = await NativeReplicaRecovery.begin(
                this.deps.root,
                prepared.recoveryDirectory,
                batch.replicaId,
                batch.through
              )
              installed = await prepared.install()
              applied = commit(journal.state.token)
              committed = applied
            } catch (error) {
              failures.push(error)
            }
            if (committed) {
              try {
                await installed!.commit()
                await journal!.clear(db)
              } catch (error) {
                // SQL and canonical content are committed. The receipt preserves cleanup on restart.
                console.warn('[Sync] Committed Native profile requires cleanup', error)
              }
            } else if (journal) {
              try {
                if (installed) {
                  await installed.rollback()
                  await journal.clear(db)
                } else await NativeReplicaRecovery.recover(this.deps.root, db)
              } catch (error) {
                const recovery = new Error('Native replica storage requires recovery', {
                  cause: error
                })
                this.deps.host.requireProfileRecovery(recovery)
                failures.push(recovery)
              }
            }
            try {
              await prepared?.dispose()
            } catch (error) {
              if (committed) console.warn('[Sync] Committed Native staging cleanup failed', error)
              else failures.push(error)
            }
            if (failures.length)
              throw failures.length === 1
                ? failures[0]
                : new AggregateError(failures, 'Native replica admission and recovery failed')
            return applied
          },
          { ifIdle: true }
        )
      )
    } catch (error) {
      if (
        error instanceof DimMethodError &&
        error.data &&
        typeof error.data === 'object' &&
        !Array.isArray(error.data) &&
        error.data.appError === 'daemon_busy'
      )
        throw new Error('sync.tunnel.error.busy', { cause: error })
      throw error
    }
  }
}
