import { createCoreAdmission, type CoreAdmissionService } from '../core/admission'
import { createCoreSettings } from '../core/settings'
import { CoreMemoryRuntime, type CoreMemoryService } from '../core/memory'
import { RutisMemoryVectorStores } from '@/harness/memory-vector'
import path from 'node:path'
import {
  CoreConfigurationCommandSchema,
  type CoreConfigurationNative
} from '@shared/harness/configuration'
import { createDeepchatEventEnvelope, type DeepchatEventEnvelope } from '@shared/contracts/events'
import { definePlugin } from '@arcships/rutis'
import { z } from 'zod'
import { initializeCoreProfile } from '@/app/profileStartup'
import type { CoreProfileHost } from '@/app/profileStartup'
import type { DatabaseSecurityCryptoPort } from '@/app/databaseSecurity'
import { CorePayloadStore } from '../core/payload'
import {
  CORE_NATIVE_CALLS,
  CoreCarrierConfigSchema,
  type CoreCarrierConfig,
  type CoreNativeMethod,
  type CorePayload,
  type CoreStatus
} from '@shared/harness/core'

const profileBootstrap = z
  .object({
    userDataDirectory: z.string().min(1).max(8192),
    homeDirectory: z.string().min(1).max(8192),
    currentAppVersion: z.string().min(1).max(64),
    systemLocale: z.string().min(1).max(256),
    appPath: z.string().min(1).max(32768),
    isPackaged: z.boolean()
  })
  .strict()

export default definePlugin<CoreCarrierConfig>({
  name: 'deepchat-core',
  inject: ['deepchatCoreNative'],
  provides: {
    deepchatCore: {
      identity: 'async',
      openProfile: 'async',
      configure: 'async',
      status: 'async',
      stop: 'async'
    }
  },
  async apply(ctx, input) {
    const config = CoreCarrierConfigSchema.parse(input)
    const store = new CorePayloadStore(config, 'core')
    const native = ctx.use<
      CoreAdmissionService &
        CoreMemoryService & {
          invoke(
            generation: string,
            method: CoreNativeMethod,
            args: CorePayload
          ): Promise<CorePayload>
        }
    >('deepchatCoreNative')
    let profile: Awaited<ReturnType<typeof initializeCoreProfile>> | undefined
    const admission = await createCoreAdmission(native, config.generation, {
      observationsEnabled: () => profile?.settingsStore.get<boolean>('loggingEnabled') ?? false
    })
    const memory = new CoreMemoryRuntime(ctx, native, config.generation)
    let vectorStores: RutisMemoryVectorStores | undefined
    let phase: CoreStatus['phase'] = 'idle'
    let opening: Promise<CorePayload> | undefined
    let stopping: Promise<void> | undefined
    let nativeCalls = 0
    let ownsProfile = false
    let configuration: ReturnType<typeof createCoreSettings> | undefined
    let configurationTail: Promise<void> = Promise.resolve()
    let configurationEvents: DeepchatEventEnvelope[] | undefined
    let settingsVersion = 0
    const isStopping = () => phase === 'stopping' || phase === 'stopped'
    const status = (): CoreStatus => ({
      generation: config.generation,
      pid: process.pid,
      node: process.versions.node,
      modules: process.versions.modules,
      phase,
      businessReady: false
    })
    const callNative = async (method: CoreNativeMethod, args: unknown[]): Promise<unknown> => {
      if (isStopping() || ctx.signal.aborted) throw new Error('Core is stopping')
      if (nativeCalls >= CORE_NATIVE_CALLS) throw new Error('Core Native call limit exceeded')
      nativeCalls++
      let ref: CorePayload | undefined
      try {
        ref = await store.encode(args)
        return await store.decode(await native.invoke(config.generation, method, ref))
      } finally {
        nativeCalls--
        if (ref) await store.release(ref)
      }
    }
    const host: CoreProfileHost = {
      setLoggingEnabled: async (enabled) => {
        await callNative('profile.logging', [enabled])
      },
      showDatabaseUnlockProgress: async (payload, options) => {
        await callNative('profile.progress', [payload, options])
      },
      requestDatabaseUnlock: async (payload) =>
        z
          .string()
          .nullable()
          .parse(await callNative('profile.unlock', [payload])),
      requestDatabaseRecovery: async (payload) => {
        const value = await callNative('profile.recovery', [payload])
        return z
          .union([
            z.object({ action: z.literal('start-empty') }).strict(),
            z.object({ action: z.literal('password'), password: z.string() }).strict()
          ])
          .nullable()
          .parse(value)
      },
      quit: async () => {
        await callNative('profile.quit', [])
      }
    }
    const crypto: DatabaseSecurityCryptoPort = {
      isAvailable: async () => z.boolean().parse(await callNative('crypto.available', [])),
      encrypt: async (value) => z.string().parse(await callNative('crypto.encrypt', [value])),
      decrypt: async (value) => z.string().parse(await callNative('crypto.decrypt', [value])),
      getBackend: async () =>
        z
          .string()
          .optional()
          .parse(await callNative('crypto.backend', []))
    }
    const stop = (): Promise<void> => {
      if (stopping) return stopping
      phase = 'stopping'
      stopping = (async () => {
        // An in-flight Native effect must settle before profile startup can retire its lock.
        await opening?.catch(() => undefined)
        await configurationTail
        await configuration?.appSettingsService.stop()
        await vectorStores?.dispose()
        await memory.retire()
        await admission.close()
        profile?.closeProfile()
        if (ownsProfile) throw new Error('Core profile ownership did not retire')
        profile = undefined
        phase = 'stopped'
      })()
      return stopping
    }
    ctx.effect(async () => {
      try {
        await stop()
      } finally {
        await store.close()
      }
    })
    ctx.provide('deepchatCore', {
      identity: status,
      async openProfile(ref: CorePayload): Promise<CorePayload> {
        if (opening || phase !== 'idle') throw new Error('Core profile generation already started')
        phase = 'opening'
        opening = (async () => {
          try {
            const bootstrap = profileBootstrap.parse(await store.decode(ref))
            profile = await initializeCoreProfile({
              ...bootstrap,
              host,
              crypto,
              onOwnershipChanged: (owned) => {
                ownsProfile = owned
              }
            })
            if (isStopping()) {
              throw new Error('Core profile startup was stopped')
            }
            if (!path.isAbsolute(bootstrap.appPath)) throw new Error('Invalid Core app path')
            vectorStores = new RutisMemoryVectorStores(memory, {
              memoryDbDir: path.join(bootstrap.userDataDirectory, 'app_db', 'AgentMemory'),
              host: {
                appPath: bootstrap.appPath,
                userDataPath: bootstrap.userDataDirectory,
                isPackaged: bootstrap.isPackaged
              }
            })
            const effect = (command: CoreConfigurationNative) =>
              callNative('configuration', [command])
            configuration = createCoreSettings({
              profile,
              homeDirectory: bootstrap.homeDirectory,
              ownerId: config.generation,
              desktop: {
                systemLocale: bootstrap.systemLocale,
                readTheme: async () =>
                  z
                    .object({ theme: z.enum(['dark', 'light', 'system']), isDark: z.boolean() })
                    .strict()
                    .parse(await effect({ operation: 'readTheme' })),
                applyTheme: async (theme) =>
                  z.boolean().parse(await effect({ operation: 'applyTheme', theme })),
                refreshLanguage: async (locale) => {
                  await effect({ operation: 'refreshLanguage', locale })
                },
                refreshTheme: async (isDark) => {
                  await effect({ operation: 'refreshTheme', isDark })
                },
                readLaunchAtLogin: async () =>
                  z.boolean().parse(await effect({ operation: 'readLaunchAtLogin' })),
                setLaunchAtLogin: async (enabled) =>
                  z.boolean().parse(await effect({ operation: 'setLaunchAtLogin', enabled })),
                applyContentProtection: async (enabled) => {
                  await effect({ operation: 'applyContentProtection', enabled })
                },
                applyFloatingButtonEnabled: async (enabled) => {
                  await effect({ operation: 'applyFloatingButtonEnabled', enabled })
                }
              },
              logging: {
                applyLogging: async (enabled) => {
                  await effect({ operation: 'applyLogging', enabled })
                },
                openLoggingFolder: async () => {
                  await effect({ operation: 'openLoggingFolder' })
                }
              },
              enumerateFonts: async () =>
                z.array(z.string()).parse(await effect({ operation: 'enumerateFonts' })),
              publishNativeSnapshot: async (snapshot) => {
                await effect({ operation: 'snapshot', snapshot })
              },
              publishEvent: (name, payload) => {
                if (!configurationEvents || configurationEvents.length >= 64)
                  throw new Error('Core configuration event batch is unavailable')
                configurationEvents.push(createDeepchatEventEnvelope(name, payload))
              },
              nextVersion: () => ++settingsVersion,
              assertActive: () => {
                if (phase !== 'profile-open') throw new Error('Core configuration is unavailable')
              }
            })
            phase = 'profile-open'
            return await store.encode(status())
          } catch (error) {
            if (!stopping) {
              await vectorStores?.dispose()
              await memory.retire()
              profile?.closeProfile()
              if (!ownsProfile) {
                profile = undefined
                phase = 'stopped'
              } else phase = 'stopping'
            }
            throw error
          }
        })()
        return await opening
      },
      async configure(ref: CorePayload): Promise<CorePayload> {
        if (phase !== 'profile-open' || !configuration)
          throw new Error('Core configuration is unavailable')
        const operation = configurationTail.then(async () => {
          if (phase !== 'profile-open' || !configuration)
            throw new Error('Core configuration is unavailable')
          const command = CoreConfigurationCommandSchema.parse(await store.decode(ref))
          if (phase !== 'profile-open') throw new Error('Core configuration is unavailable')
          const events: DeepchatEventEnvelope[] = []
          configurationEvents = events
          try {
            const owner = configuration.appSettingsService
            const [outcome] = await Promise.allSettled([
              (async () => {
                switch (command.operation) {
                  case 'read':
                    return await owner.getSnapshot(command.input.keys)
                  case 'update':
                    return await owner.update(command.input.changes)
                  case 'nativeSnapshot':
                    return owner.readNativeSnapshot()
                  case 'initialize':
                    return await owner.initializeDesktop()
                }
              })()
            ])
            if (events.length) await callNative('configuration', [{ operation: 'events', events }])
            if (outcome.status === 'rejected') throw outcome.reason
            return await store.encode(outcome.value)
          } finally {
            configurationEvents = undefined
          }
        })
        configurationTail = operation.then(
          () => undefined,
          () => undefined
        )
        return await operation
      },
      async status() {
        return await store.encode(status())
      },
      async stop() {
        await stop()
        return await store.encode(status())
      }
    })
  }
})
