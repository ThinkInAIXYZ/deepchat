import { createCoreAdmission, type CoreAdmissionService } from '../core/admission'
import { CoreNativeHelpers } from '../core/helpers'
import { CoreNativeBrowser } from '../core/browser'
import { CoreNativeDesktop } from '../core/desktop'
import { createCoreKernel } from '../core/kernel'
import { CoreNativeCalls } from '../core/native'
import { createCoreSettings } from '../core/settings'
import { CoreMemoryRuntime, type CoreMemoryService } from '../core/memory'
import { RutisMemoryVectorStores } from '@/harness/memory-vector'
import path from 'node:path'
import {
  CoreConfigurationCommandSchema,
  type CoreConfigurationNative
} from '@shared/harness/configuration'
import {
  createDeepchatEventEnvelope,
  type DeepchatEventEnvelope,
  type DeepchatEventName
} from '@shared/contracts/events'
import { definePlugin } from '@arcships/rutis'
import { z } from 'zod'
import { initializeCoreProfile } from '@/app/profileStartup'
import { dispatchDeepchatRoute } from '@/routes'
import type { CoreProfileHost } from '@/app/profileStartup'
import type { DatabaseSecurityCryptoPort } from '@/app/databaseSecurity'
import { CorePayloadStore } from '../core/payload'
import {
  CoreCarrierConfigSchema,
  CoreNativeEventSchema,
  CoreKernelBootstrapSchema,
  CoreRouteInvocationSchema,
  CoreMcpAppProtocolCommandSchema,
  CoreMcpAppProtocolPolicySchema,
  CoreHostQuerySchema,
  CoreFailureComponentSchema,
  isCoreControlRoute,
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
      assembleKernel: 'async',
      startKernel: 'async',
      invokeRoute: 'async',
      invokeControlRoute: 'async',
      mcpAppProtocol: 'async',
      hostQuery: 'async',
      configure: 'async',
      observeSystemTheme: 'async',
      nativeEvents: 'async',
      status: 'async',
      beginShutdown: 'async',
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
    let profilePaths: z.infer<typeof profileBootstrap> | undefined
    let kernel: Awaited<ReturnType<typeof createCoreKernel>> | undefined
    let assembling: Promise<CorePayload> | undefined
    let starting: Promise<CorePayload> | undefined
    let kernelAttempted = false
    let kernelPublish: ((name: DeepchatEventName, payload: unknown) => void) | undefined
    const admission = await createCoreAdmission(native, config.generation, {
      observationsEnabled: () => profile?.settingsStore.get<boolean>('loggingEnabled') ?? false
    })
    const memory = new CoreMemoryRuntime(ctx, native, config.generation)
    let vectorStores: RutisMemoryVectorStores | undefined
    let phase: CoreStatus['phase'] = 'idle'
    let opening: Promise<CorePayload> | undefined
    let stopping: Promise<void> | undefined
    let ownsProfile = false
    let configuration: ReturnType<typeof createCoreSettings> | undefined
    let configurationTail: Promise<void> = Promise.resolve()
    let configurationEvents: DeepchatEventEnvelope[] | undefined
    const businessCalls = new Set<Promise<CorePayload>>()
    let settingsVersion = 0
    const isStopping = () =>
      phase === 'stopping' || phase === 'stopped' || Boolean(kernel?.stopping)
    const status = (): CoreStatus => ({
      generation: config.generation,
      pid: process.pid,
      node: process.versions.node,
      modules: process.versions.modules,
      phase: phase !== 'stopped' && kernel?.stopping ? 'stopping' : phase,
      businessReady: phase === 'running' && !isStopping()
    })
    const nativeCalls = new CoreNativeCalls(
      store,
      async (method, ref) => await native.invoke(config.generation, method, ref),
      () => isStopping() || ctx.signal.aborted
    )
    const callNative = (method: CoreNativeMethod, args: unknown[]) => nativeCalls.call(method, args)
    let failureReported = false
    const fail = (component: z.infer<typeof CoreFailureComponentSchema>) => {
      if (failureReported || phase === 'stopped') return
      failureReported = true
      // Report through reserved capacity even when presentation delivery has failed.
      void callNative('core.failure', [component]).catch(() => {})
      void stop().catch(() => {})
    }
    const helpers = new CoreNativeHelpers(
      async (command) => await callNative('helpers', [command]),
      () => fail('helpers')
    )
    const browser = new CoreNativeBrowser(
      async (command) => await callNative('browser', [command]),
      () => fail('browser')
    )
    const desktop = new CoreNativeDesktop(
      async (command) => await callNative('desktop', [command]),
      (event) => kernel?.runtime.remoteService.handleAuthWindowEvent(event),
      () => fail('desktop')
    )
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
    const runConfiguration = async (
      execute: (owner: NonNullable<typeof configuration>['appSettingsService']) => Promise<unknown>
    ): Promise<CorePayload> => {
      if (
        isStopping() ||
        !['profile-open', 'kernel-assembled', 'starting', 'running'].includes(phase) ||
        !configuration
      )
        throw new Error('Core configuration is unavailable')
      const operation = configurationTail.then(async () => {
        if (
          isStopping() ||
          !['profile-open', 'kernel-assembled', 'starting', 'running'].includes(phase) ||
          !configuration
        )
          throw new Error('Core configuration is unavailable')
        const events: DeepchatEventEnvelope[] = []
        configurationEvents = events
        try {
          const [outcome] = await Promise.allSettled([execute(configuration.appSettingsService)])
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
    }
    const trackBusinessCall = (operation: Promise<CorePayload>): Promise<CorePayload> => {
      businessCalls.add(operation)
      void operation.then(
        () => businessCalls.delete(operation),
        () => businessCalls.delete(operation)
      )
      return operation
    }
    const invokeRoute = (ref: CorePayload, control: boolean): Promise<CorePayload> =>
      trackBusinessCall(
        (async () => {
          const input = CoreRouteInvocationSchema.parse(await store.decode(ref))
          if (isCoreControlRoute(input.routeName) !== control)
            throw new Error('Invalid Core route lane')
          if (isStopping() || phase !== 'running' || !kernel)
            throw new Error('Core business routes are unavailable')
          return await store.encode(
            await dispatchDeepchatRoute(
              kernel.controller.routeDispatcher,
              input.routeName,
              input.input,
              input.context
            )
          )
        })()
      )
    const stop = (): Promise<void> => {
      if (stopping) return stopping
      phase = 'stopping'
      profile?.databaseSecurityService.stop()
      profile?.secretStore.pause()
      const kernelRetirement = kernel?.stop()
      void kernelRetirement?.catch(() => {})
      stopping = (async () => {
        // An in-flight Native effect must settle before profile startup can retire its lock.
        await opening?.catch(() => undefined)
        await assembling?.catch(() => undefined)
        const errors: unknown[] = []
        const retire = async (action: () => unknown | Promise<unknown>) => {
          try {
            await action()
          } catch (error) {
            errors.push(error)
          }
        }
        await retire(async () => await (kernelRetirement ?? kernel?.stop()))
        await retire(async () => await starting?.catch(() => undefined))
        if (kernelAttempted) await retire(() => browser.close())
        await retire(() => helpers.close())
        await retire(() => desktop.close())
        await retire(() => configurationTail)
        await retire(async () => await configuration?.appSettingsService.stop())
        await retire(async () => await vectorStores?.dispose())
        await retire(() => memory.retire())
        await retire(() => admission.close())
        await retire(() => nativeCalls.drain())
        await Promise.allSettled(businessCalls)
        if (kernelAttempted && !kernel)
          errors.push(new Error('Partial Core Kernel requires physical retirement'))
        if (errors.length) throw new AggregateError(errors, 'Core did not retire')
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
            profilePaths = bootstrap
            profile = await initializeCoreProfile({
              ...bootstrap,
              host,
              crypto,
              observe: async (observation) => {
                await callNative('profile.observation', [observation])
              },
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
                if (kernelPublish) return kernelPublish(name, payload)
                if (!configurationEvents || configurationEvents.length >= 64)
                  throw new Error('Core configuration event batch is unavailable')
                configurationEvents.push(createDeepchatEventEnvelope(name, payload))
              },
              nextVersion: () => ++settingsVersion,
              assertActive: () => {
                if (
                  isStopping() ||
                  !['profile-open', 'kernel-assembled', 'starting', 'running'].includes(phase)
                )
                  throw new Error('Core configuration is unavailable')
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
      async assembleKernel(ref: CorePayload): Promise<CorePayload> {
        if (
          assembling ||
          phase !== 'profile-open' ||
          !profile ||
          !configuration ||
          !vectorStores ||
          !profilePaths
        )
          throw new Error('Core Kernel is unavailable')
        const ownerProfile = profile
        const ownerSettings = configuration
        const ownerVectors = vectorStores
        const paths = profilePaths
        phase = 'assembling'
        assembling = (async () => {
          try {
            const input = CoreKernelBootstrapSchema.parse(await store.decode(ref))
            for (const value of Object.values(input).flat())
              if (typeof value === 'string' && !path.isAbsolute(value))
                throw new Error('Invalid Core Kernel path')
            const nativePorts = await desktop.createPorts({
              temporaryDirectory: input.temporaryDirectory,
              profileDirectory: paths.userDataDirectory
            })
            if (isStopping()) throw new Error('Core Kernel startup was stopped')
            kernelAttempted = true
            kernel = await createCoreKernel({
              profile: ownerProfile,
              settings: ownerSettings,
              bootstrap: {
                ...input,
                profileDirectory: paths.userDataDirectory,
                homeDirectory: paths.homeDirectory,
                appPath: paths.appPath,
                appVersion: paths.currentAppVersion,
                isPackaged: paths.isPackaged
              },
              providerCatalogBootstrap: {
                userDataDirectory: paths.userDataDirectory,
                builtInCatalogPath: input.providerCatalogPath
              },
              nextSettingsVersion: () => ++settingsVersion,
              native: nativePorts,
              browser,
              helpers: {
                spawnBackgroundExecHost: helpers.spawnBackgroundExecHost.bind(helpers),
                spawnCodeModeHost: helpers.spawnCodeModeHost.bind(helpers),
                spawnSchedulerHost: helpers.spawnSchedulerHost.bind(helpers),
                spawnFileWatcherHost: helpers.spawnFileWatcherHost
              },
              admission,
              vectors: ownerVectors,
              bindEventPublisher: (publish) => {
                kernelPublish = publish
              },
              isStopping,
              allowInsecureTls: input.allowInsecureTls,
              onFailure: () => fail('http')
            })
            if (isStopping()) throw new Error('Core Kernel startup was stopped')
            phase = 'kernel-assembled'
            return await store.encode(status())
          } catch (error) {
            if (!isStopping()) phase = kernelAttempted ? 'stopping' : 'profile-open'
            throw error
          }
        })()
        return await assembling
      },
      async configure(ref: CorePayload): Promise<CorePayload> {
        return await runConfiguration(async (owner) => {
          const command = CoreConfigurationCommandSchema.parse(await store.decode(ref))
          if (!['profile-open', 'kernel-assembled', 'starting', 'running'].includes(phase))
            throw new Error('Core configuration is unavailable')
          switch (command.operation) {
            case 'read':
              return await owner.getSnapshot(command.input.keys)
            case 'update':
              return await owner.update(command.input.changes)
            case 'nativeSnapshot':
              return owner.readNativeSnapshot()
            case 'floatingBounds':
              return await owner.setFloatingButtonBounds(command.bounds)
            case 'initialize':
              return await owner.initializeDesktop()
          }
        })
      },
      async startKernel(): Promise<CorePayload> {
        if (starting || phase !== 'kernel-assembled' || !kernel)
          throw new Error('Core Kernel cannot start')
        phase = 'starting'
        starting = (async () => {
          try {
            await kernel.start()
            if (isStopping()) throw new Error('Core Kernel startup was stopped')
            phase = 'running'
            return await store.encode(status())
          } catch (error) {
            void stop().catch(() => {})
            throw error
          }
        })()
        return await starting
      },
      async invokeRoute(ref: CorePayload): Promise<CorePayload> {
        return await invokeRoute(ref, false)
      },
      async invokeControlRoute(ref: CorePayload): Promise<CorePayload> {
        return await invokeRoute(ref, true)
      },
      async mcpAppProtocol(ref: CorePayload): Promise<CorePayload> {
        return await trackBusinessCall(
          (async () => {
            const input = CoreMcpAppProtocolCommandSchema.parse(await store.decode(ref))
            if (isStopping() || phase !== 'running' || !kernel)
              throw new Error('Core MCP App protocol is unavailable')
            const sandbox = kernel.runtime.mcpAppSandbox
            return await store.encode(
              input.operation === 'policy'
                ? CoreMcpAppProtocolPolicySchema.parse(
                    await sandbox.getProtocolPolicy(input.instanceId)
                  )
                : z
                    .boolean()
                    .parse(
                      await sandbox.requestBrowserPermission(
                        input.instanceId,
                        input.context,
                        input.kinds
                      )
                    )
            )
          })()
        )
      },
      async hostQuery(ref: CorePayload): Promise<CorePayload> {
        return await trackBusinessCall(
          (async () => {
            const input = CoreHostQuerySchema.parse(await store.decode(ref))
            if (isStopping() || phase !== 'running' || !kernel)
              throw new Error('Core host queries are unavailable')
            const host = kernel.runtime.host
            return await store.encode(
              input.operation === 'workspacePreview'
                ? await host.resolveWorkspacePreviewRequest(input.url)
                : await host.hasProvider(input.providerId)
            )
          })()
        )
      },
      async observeSystemTheme() {
        return await runConfiguration(async (owner) => await owner.observeSystemTheme())
      },
      async nativeEvents(ref: CorePayload): Promise<CorePayload> {
        const event = CoreNativeEventSchema.parse(await store.decode(ref))
        if (Array.isArray(event)) {
          helpers.accept(event)
          return await store.encode(undefined)
        }
        if (event.type === 'host.settingsWindow' || event.type === 'host.systemResume') {
          if (isStopping() || !kernel) throw new Error('Core host control is unavailable')
          if (event.type === 'host.systemResume') {
            if (phase !== 'running' || kernel.databaseRequests.state !== 'running')
              return await store.encode(undefined)
            kernel.observeSystemResume()
          } else {
            kernel.observeSettingsWindow(event.action)
          }
          return await store.encode(undefined)
        }
        if (event.type === 'host.clearPermissions' || event.type === 'host.shutdownConfirmation') {
          return await trackBusinessCall(
            (async () => {
              if (isStopping() || phase !== 'running' || !kernel)
                throw new Error('Core host control is unavailable')
              return await store.encode(
                event.type === 'host.clearPermissions'
                  ? await kernel.runtime.host.clearPermissionCaches()
                  : await kernel.runtime.host.getShutdownConfirmation()
              )
            })()
          )
        }
        if (event.type.startsWith('desktop.')) {
          desktop.accept(event)
          return await store.encode(undefined)
        }
        return await store.encode(await browser.accept(event))
      },
      async status() {
        return await store.encode(status())
      },
      async stop() {
        await stop()
        return await store.encode(status())
      },
      async beginShutdown() {
        void stop().catch(() => {})
        return await store.encode(status())
      }
    })
  }
})
