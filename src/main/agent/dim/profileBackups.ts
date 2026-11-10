import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  rename,
  rm
} from 'node:fs/promises'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { DimMethodError } from './pluginClient'
import type { DimRuntimeSupervisor } from './runtimeSupervisor'
import type { DimSessionRuntime } from './sessionRuntime'
import { syncDirectory } from '../../data/durableFile'
import { profileExists, recoverDimProfile, writeDimProfileRecovery } from './profileRecovery'
import {
  captureDimProfile,
  validateDimProfile,
  type DimProfileIdentity,
  type DimProfileManifest,
  type DimProfileSnapshot
} from './profileSnapshot'

export interface PreparedDimProfile {
  readonly recoveryDirectory: string
  readonly nativeSessionIds?: readonly string[]
  install(): Promise<{ commit(): Promise<void>; rollback(): Promise<void> }>
  dispose(): Promise<void>
}
export interface SyncNativeProfilePort {
  capture<T>(collect: () => Promise<T>): Promise<{ value: T; profile: DimProfileSnapshot }>
  prepareRestore(directory: string, manifest: unknown): Promise<PreparedDimProfile>
  prepareMerge(directory: string, manifest: unknown): Promise<PreparedDimProfile>
}

async function syncProfileDirectories(directory: string): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true }))
    if (entry.isDirectory()) await syncProfileDirectories(path.join(directory, entry.name))
  await syncDirectory(directory)
}

export class DimProfileRecoveryError extends Error {
  constructor(
    readonly recoveryDirectory: string,
    cause: unknown
  ) {
    super(`Native profile requires recovery from ${recoveryDirectory}`, { cause })
  }
}

/** Opaque profile lifecycle. All content inspection continues through the storage plugin. */
export class DimProfileBackups implements SyncNativeProfilePort {
  constructor(
    private readonly options: {
      runtimeRoot: string
      profileRoot: string
      temporaryRoot: string
      host: DimRuntimeSupervisor
      readers(): DimSessionRuntime
    }
  ) {}

  private async identity(): Promise<DimProfileIdentity> {
    const lock = JSON.parse(
      await readFile(path.join(this.options.runtimeRoot, 'plugins/native-host-lock.json'), 'utf8')
    )
    if (
      typeof lock.sourceRevision !== 'string' ||
      typeof lock.bridgeVersion !== 'string' ||
      !Number.isSafeInteger(lock.storeFormat) ||
      lock.storeFormat < 1
    )
      throw new Error('Invalid native profile identity')
    return {
      sourceRevision: lock.sourceRevision,
      bridgeVersion: lock.bridgeVersion,
      storeFormat: lock.storeFormat
    }
  }

  async capture<T>(collect: () => Promise<T>): Promise<{ value: T; profile: DimProfileSnapshot }> {
    const deadline = Date.now() + 30_000
    for (;;) {
      try {
        return await this.options.readers().withSuspendedReaders(() =>
          this.options.host.withStopped(
            async () => {
              const profile = await captureDimProfile(
                path.join(this.options.profileRoot, 'dim'),
                this.options.temporaryRoot,
                await this.identity()
              )
              try {
                return { value: await collect(), profile }
              } catch (error) {
                await profile.dispose()
                throw error
              }
            },
            { ifIdle: true }
          )
        )
      } catch (error) {
        const data = error instanceof DimMethodError ? error.data : null
        if (
          !data ||
          typeof data !== 'object' ||
          Array.isArray(data) ||
          data.appError !== 'daemon_busy' ||
          Date.now() >= deadline
        )
          throw error
        // Background owners may still be publishing just after the UI turn ends. Retry only
        // cold-profile admission; restore observers and keep every native task alive meanwhile.
        await delay(500, undefined, { ref: false })
      }
    }
  }

  /** Read selected content through live native owners without stopping other Sessions. */
  async exportSessions(sessionIds: readonly string[]): Promise<DimProfileSnapshot> {
    const identity = await this.identity()
    const root = await mkdtemp(path.join(this.options.temporaryRoot, 'dim-export-owner-'))
    const directory = path.join(root, 'dim')
    let client: Awaited<ReturnType<DimRuntimeSupervisor['openConnection']>> | undefined
    let ownerMayBeActive = false
    try {
      await mkdir(path.join(directory, 'rust'), { recursive: true, mode: 0o700 })
      client = await this.options.host.openConnection()
      ownerMayBeActive = true
      await client.call(
        'deepchat.storage.archive_export',
        { targetDirectory: directory, sessionIds: [...sessionIds] },
        30 * 60_000
      )
      // Only a successful native reply acknowledges the target owner's release.
      // A forwarding plugin can report an error after losing its native connection.
      ownerMayBeActive = false
      return await captureDimProfile(directory, this.options.temporaryRoot, identity)
    } finally {
      client?.close()
      if (!ownerMayBeActive) await rm(root, { recursive: true, force: true })
    }
  }

  /** A subset is produced by native owners from a verified, cold snapshot. */
  async selectSessions(
    snapshot: DimProfileSnapshot,
    sessionIds: readonly string[]
  ): Promise<DimProfileSnapshot> {
    const identity = await this.identity()
    const manifest = await snapshot.manifest()
    await validateDimProfile(snapshot.directory, manifest, identity)
    const root = await mkdtemp(path.join(this.options.temporaryRoot, 'dim-selected-owner-'))
    const directory = path.join(root, 'selected', 'dim')
    const coordinator = this.options.host.createIsolatedProfile(path.join(root, 'coordinator'))
    let selected: DimProfileSnapshot | undefined
    const failures: unknown[] = []
    try {
      const working = await captureDimProfile(snapshot.directory, root, identity)
      await validateDimProfile(working.directory, manifest, identity)
      await mkdir(path.join(directory, 'rust'), { recursive: true, mode: 0o700 })
      const client = await coordinator.start()
      await client.call(
        'deepchat.storage.archive_transfer',
        {
          sourceDirectory: working.directory,
          targetDirectory: directory,
          initializeTarget: true,
          ...(manifest.sourceHome ? { sourceHome: manifest.sourceHome } : {}),
          installedDirectory: directory,
          sessionIds: [...sessionIds]
        },
        30 * 60_000
      )
      selected = await captureDimProfile(directory, this.options.temporaryRoot, identity)
    } catch (error) {
      failures.push(error)
    }
    const stopped = await Promise.allSettled([coordinator.stop()])
    const closeFailures = stopped.filter((result) => result.status === 'rejected')
    for (const result of closeFailures) failures.push(result.reason)
    // Keep private working files if an owner has not confirmed that it released them.
    if (!closeFailures.length) {
      try {
        await rm(root, { recursive: true, force: true })
      } catch (error) {
        failures.push(error)
      }
    }
    if (failures.length) {
      await selected?.dispose()
      throw failures.length === 1
        ? failures[0]
        : new AggregateError(failures, 'Native selection and cleanup failed')
    }
    if (!selected) throw new Error('Native selection did not produce a snapshot')
    return selected
  }

  prepareRestore(directory: string, value: unknown): Promise<PreparedDimProfile> {
    return this.prepare(directory, value)
  }

  /** The caller holds the common cold-profile/database barrier throughout admission. */
  async prepareMerge(directory: string, value: unknown): Promise<PreparedDimProfile> {
    const identity = await this.identity()
    const incoming = await validateDimProfile(directory, value, identity)
    const current = await captureDimProfile(
      path.join(this.options.profileRoot, 'dim'),
      this.options.temporaryRoot,
      identity
    )
    try {
      const manifest = await current.manifest()
      if (!incoming.files.some((file) => file.path === 'rust/dimcode.sqlite'))
        return await this.prepare(current.directory, manifest)
      // Native read-only opens may create SQLite sidecars. Never open the verified
      // immutable backup itself; even catalogue reads use this disposable working copy.
      const working = await captureDimProfile(directory, this.options.temporaryRoot, identity)
      try {
        await validateDimProfile(working.directory, incoming, identity)
        return await this.prepare(current.directory, manifest, {
          directory: working.directory,
          manifest: incoming
        })
      } finally {
        await working.dispose()
      }
    } finally {
      await current.dispose()
    }
  }

  /** LWW admission replaces selected canonical owners only in disposable cold staging. */
  async prepareReplica(
    incoming: { directory: string; manifest: unknown } | undefined,
    sessionIds: readonly string[],
    replaceSessionIds: readonly string[]
  ): Promise<PreparedDimProfile> {
    if (sessionIds.length && !incoming) throw new Error('Native replica content is missing')
    const identity = await this.identity()
    const current = await captureDimProfile(
      path.join(this.options.profileRoot, 'dim'),
      this.options.temporaryRoot,
      identity
    )
    let working: DimProfileSnapshot | undefined
    try {
      const manifest = await current.manifest()
      let merge:
        | { directory: string; manifest: DimProfileManifest; sessionIds: string[] }
        | undefined
      if (incoming && sessionIds.length) {
        const source = await validateDimProfile(incoming.directory, incoming.manifest, identity)
        working = await captureDimProfile(incoming.directory, this.options.temporaryRoot, identity)
        await validateDimProfile(working.directory, source, identity)
        merge = { directory: working.directory, manifest: source, sessionIds: [...sessionIds] }
      }
      return await this.prepare(current.directory, manifest, merge, [
        ...new Set([...replaceSessionIds, ...sessionIds])
      ])
    } finally {
      await working?.dispose()
      await current.dispose()
    }
  }

  private async prepare(
    directory: string,
    value: unknown,
    merge?: { directory: string; manifest: DimProfileManifest; sessionIds?: string[] },
    replaceSessionIds?: string[]
  ): Promise<PreparedDimProfile> {
    const manifest: DimProfileManifest = await validateDimProfile(
      directory,
      value,
      await this.identity()
    )
    await mkdir(this.options.profileRoot, { recursive: true, mode: 0o700 })
    const container = await mkdtemp(path.join(this.options.profileRoot, '.dim-restore-'))
    const next = replaceSessionIds
      ? path.join(container, 'next', 'dim')
      : path.join(container, 'next')
    const previous = path.join(container, 'previous')
    const target = path.join(this.options.profileRoot, 'dim')
    let state: 'staged' | 'swapping' | 'installed' | 'settled' = 'staged'
    let retainStaging = false
    const nativeSessionIds: string[] = []
    // A failed rollback retains its private recovery directory for explicit recovery.
    const dispose = async () => {
      if (!retainStaging && (state === 'staged' || state === 'settled'))
        await rm(container, { recursive: true, force: true })
    }
    try {
      await mkdir(next, { recursive: true, mode: 0o700 })
      for (const file of manifest.files) {
        const output = path.join(next, file.path)
        await mkdir(path.dirname(output), { recursive: true, mode: 0o700 })
        await copyFile(path.join(directory, file.path), output)
        await chmod(output, 0o600)
        const handle = await open(output, 'r+')
        try {
          await handle.sync()
        } finally {
          await handle.close()
        }
        await chmod(output, file.mode)
      }
      if (merge || manifest.files.some((file) => file.path === 'rust/dimcode.sqlite')) {
        await mkdir(path.join(next, 'rust'), { recursive: true, mode: 0o700 })
        // The application's supervisor remains fenced. This empty coordinator opens only
        // the disposable store through the storage plugin and restores no Agents from it.
        const coordinatorRoot = await mkdtemp(
          path.join(this.options.temporaryRoot, 'dim-restore-owner-')
        )
        const coordinator = this.options.host.createIsolatedProfile(coordinatorRoot)
        const failures: unknown[] = []
        try {
          const client = await coordinator.start()
          if (
            replaceSessionIds &&
            manifest.files.some((file) => file.path === 'rust/dimcode.sqlite')
          ) {
            // Copied command-output ownership initially points at the live source.
            // Relocate it before the native deletion owner can touch physical files.
            await client.call(
              'deepchat.storage.archive_rebase',
              {
                directory: next,
                ...(manifest.sourceHome ? { sourceHome: manifest.sourceHome } : {}),
                installedDirectory: next
              },
              120_000
            )
            await client.call(
              'deepchat.storage.archive_prune',
              {
                directory: next,
                sessionIds: replaceSessionIds
              },
              30 * 60_000
            )
          }
          if (merge)
            await client.call(
              'deepchat.storage.archive_transfer',
              {
                sourceDirectory: merge.directory,
                targetDirectory: next,
                initializeTarget: true,
                ...(merge.manifest.sourceHome ? { sourceHome: merge.manifest.sourceHome } : {}),
                installedDirectory: replaceSessionIds ? next : target,
                ...(merge.sessionIds ? { sessionIds: merge.sessionIds } : {})
              },
              30 * 60_000
            )
          await client.call(
            'deepchat.storage.archive_rebase',
            {
              directory: next,
              ...(replaceSessionIds
                ? { sourceHome: next }
                : manifest.sourceHome
                  ? { sourceHome: manifest.sourceHome }
                  : {}),
              installedDirectory: target
            },
            120_000
          )
          let after: string | undefined
          do {
            const page = await client.call<{
              sessions: Array<{ sessionId: string }>
              next: string | null
            }>('deepchat.storage.archive_catalog', {
              directory: next,
              limit: 64,
              ...(after ? { after } : {})
            })
            nativeSessionIds.push(...page.sessions.map((session) => session.sessionId))
            after = page.next ?? undefined
          } while (after)
        } catch (error) {
          failures.push(error)
        }
        try {
          await coordinator.stop()
        } catch (error) {
          retainStaging = true
          failures.push(error)
        }
        if (!retainStaging) {
          try {
            await rm(coordinatorRoot, { recursive: true, force: true })
          } catch (error) {
            failures.push(error)
          }
        }
        if (failures.length)
          throw failures.length === 1
            ? failures[0]
            : new AggregateError(failures, 'Native admission and cleanup failed')
      }
      await syncProfileDirectories(next)
      await writeDimProfileRecovery(container, {
        version: 1,
        phase: 'prepared',
        hadPrevious: false
      })
      return {
        recoveryDirectory: path.basename(container),
        nativeSessionIds,
        dispose,
        // The caller already holds the common cold-profile/database maintenance barrier.
        install: async () => {
          if (state !== 'staged') throw new Error('Native restore was already consumed')
          state = 'swapping'
          try {
            const replaced = await profileExists(target)
            await writeDimProfileRecovery(container, {
              version: 1,
              phase: 'swapping',
              hadPrevious: replaced
            })
            if (replaced) {
              await rename(target, previous)
              await syncDirectory(container)
              await syncDirectory(this.options.profileRoot)
            }
            await rename(next, target)
            await syncDirectory(this.options.profileRoot)
            await syncDirectory(container)
            await writeDimProfileRecovery(container, {
              version: 1,
              phase: 'installed',
              hadPrevious: replaced
            })
          } catch (error) {
            try {
              await recoverDimProfile(this.options.profileRoot, path.basename(container))
            } catch (rollbackError) {
              throw new DimProfileRecoveryError(container, rollbackError)
            }
            state = 'staged'
            throw error
          }
          state = 'installed'
          return {
            commit: async () => {
              state = 'settled'
              await dispose()
            },
            rollback: async () => {
              try {
                await recoverDimProfile(this.options.profileRoot, path.basename(container))
              } catch (error) {
                throw new DimProfileRecoveryError(container, error)
              }
              state = 'settled'
            }
          }
        }
      }
    } catch (error) {
      await dispose()
      throw error
    }
  }
}
