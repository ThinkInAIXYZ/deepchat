import { chmod, copyFile, mkdir, mkdtemp, open, readFile, rename, rm } from 'node:fs/promises'
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
  install(): Promise<{ commit(): Promise<void>; rollback(): Promise<void> }>
  dispose(): Promise<void>
}
export interface SyncNativeProfilePort {
  capture<T>(collect: () => Promise<T>): Promise<{ value: T; profile: DimProfileSnapshot }>
  prepareRestore(directory: string, manifest: unknown): Promise<PreparedDimProfile>
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

  async prepareRestore(directory: string, value: unknown): Promise<PreparedDimProfile> {
    const manifest: DimProfileManifest = await validateDimProfile(
      directory,
      value,
      await this.identity()
    )
    const container = await mkdtemp(path.join(this.options.profileRoot, '.dim-restore-'))
    const next = path.join(container, 'next')
    const previous = path.join(container, 'previous')
    const target = path.join(this.options.profileRoot, 'dim')
    let state: 'staged' | 'swapping' | 'installed' | 'settled' = 'staged'
    // A failed rollback retains its private recovery directory for explicit recovery.
    const dispose = async () => {
      if (state === 'staged' || state === 'settled')
        await rm(container, { recursive: true, force: true })
    }
    try {
      await mkdir(next, { mode: 0o700 })
      const directories = new Set([next])
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
        for (
          let parent = path.dirname(output);
          parent.startsWith(next);
          parent = path.dirname(parent)
        )
          directories.add(parent)
      }
      for (const directory of [...directories].sort((a, b) => b.length - a.length))
        await syncDirectory(directory)
      await writeDimProfileRecovery(container, {
        version: 1,
        phase: 'prepared',
        hadPrevious: false
      })
      return {
        recoveryDirectory: path.basename(container),
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
