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
    currentAppVersion: z.string().min(1).max(64)
  })
  .strict()

export default definePlugin<CoreCarrierConfig>({
  name: 'deepchat-core',
  inject: ['deepchatCoreNative'],
  provides: {
    deepchatCore: { identity: 'async', openProfile: 'async', status: 'async', stop: 'async' }
  },
  async apply(ctx, input) {
    const config = CoreCarrierConfigSchema.parse(input)
    const store = new CorePayloadStore(config, 'core')
    const native = ctx.use<{
      invoke(generation: string, method: CoreNativeMethod, args: CorePayload): Promise<CorePayload>
    }>('deepchatCoreNative')
    let phase: CoreStatus['phase'] = 'idle'
    let profile: Awaited<ReturnType<typeof initializeCoreProfile>> | undefined
    let opening: Promise<CorePayload> | undefined
    let stopping: Promise<void> | undefined
    let nativeCalls = 0
    let ownsProfile = false
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
            phase = 'profile-open'
            return await store.encode(status())
          } catch (error) {
            if (!stopping) {
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
