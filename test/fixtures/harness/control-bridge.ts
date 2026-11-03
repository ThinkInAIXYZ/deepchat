import { definePlugin } from '@arcships/rutis'
import { CorePayloadStore } from '../../../src/harness/core/payload'
import type { CoreControlService } from '../../../src/harness/core/control'
import { CoreCarrierConfigSchema, type CorePayload } from '../../../src/shared/harness/core'
import type { HarnessControlCommand } from '../../../src/shared/harness/control'

export default definePlugin({
  name: 'control-test-bridge',
  inject: ['deepchatCoreNative'],
  provides: {
    deepchatCore: { identity: 'async', invokeRoute: 'async', status: 'async', stop: 'async' }
  },
  async apply(ctx, input) {
    const config = CoreCarrierConfigSchema.parse(input)
    const payloads = new CorePayloadStore(config, 'core')
    const native = ctx.use<CoreControlService>('deepchatCoreNative')
    let stopped = false
    const status = () => ({
      generation: config.generation,
      pid: process.pid,
      node: process.versions.node,
      modules: process.versions.modules,
      phase: stopped ? 'stopped' : 'idle',
      businessReady: false
    })
    ctx.effect(async () => await payloads.close())
    ctx.provide('deepchatCore', {
      identity: status,
      status: async () => await payloads.encode(status()),
      async invokeRoute(ref: CorePayload) {
        const { input } = (await payloads.decode(ref)) as {
          input: { sequence: number; command: HarnessControlCommand }
        }
        return await payloads.encode(
          await native.control(config.generation, input.sequence, input.command)
        )
      },
      async stop() {
        stopped = true
        return await payloads.encode(status())
      }
    })
  }
})
