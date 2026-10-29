import { randomUUID } from 'node:crypto'
import { definePlugin } from '@arcships/rutis'
import { createCoreAdmission, type CoreAdmissionService } from '../../../src/harness/core/admission'
import { CorePayloadStore } from '../../../src/harness/core/payload'
import { CoreCarrierConfigSchema, type CorePayload } from '../../../src/shared/harness/core'

export default definePlugin({
  name: 'core-admission-contract',
  inject: ['deepchatCoreNative'],
  provides: {
    deepchatCore: { identity: 'async', configure: 'async', status: 'async', stop: 'async' }
  },
  async apply(ctx, input) {
    const config = CoreCarrierConfigSchema.parse(input)
    const payloads = new CorePayloadStore(config, 'core')
    const service = ctx.use<
      CoreAdmissionService & {
        invoke(generation: string, method: string, args: CorePayload): Promise<CorePayload>
      }
    >('deepchatCoreNative')
    const admission = await createCoreAdmission(service, config.generation, {
      observationsEnabled: () => true
    })
    let stopped = false
    const status = () => ({
      generation: config.generation,
      pid: process.pid,
      node: process.versions.node,
      modules: process.versions.modules,
      phase: stopped ? 'stopped' : 'idle',
      businessReady: false
    })
    ctx.effect(async () => {
      await admission.close()
      await payloads.close()
    })
    ctx.provide('deepchatCore', {
      identity: status,
      status: async () => await payloads.encode(status()),
      async configure(ref: CorePayload) {
        await payloads.decode(ref)
        try {
          await service.admission(randomUUID(), 0, 'limits', [])
          throw new Error('Foreign generation was admitted')
        } catch (error) {
          if (!(error instanceof Error) || !error.message.includes('generation is unavailable'))
            throw error
        }
        const controller = new AbortController()
        const cancelled = admission.acquire({
          ownerId: 'cancelled-core',
          signal: controller.signal
        })
        controller.abort()
        try {
          await cancelled
          throw new Error('Cancelled Core acquisition was granted')
        } catch (error) {
          if (!(error instanceof Error) || error.name !== 'AgentInvocationAdmissionAbortedError')
            throw error
        }
        const permit = await admission.acquire({ ownerId: 'core-work' })
        try {
          await payloads.decode(
            await service.invoke(
              config.generation,
              'profile.logging',
              await payloads.encode([true])
            )
          )
        } finally {
          permit.release()
          await admission.flushObservations()
        }
        return await payloads.encode(await admission.snapshot())
      },
      async stop() {
        await admission.close()
        stopped = true
        return await payloads.encode(status())
      }
    })
  }
})
