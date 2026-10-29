import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { definePlugin } from '@arcships/rutis'
import { CoreMemoryRuntime, type CoreMemoryService } from '../../../src/harness/core/memory'
import { CorePayloadStore } from '../../../src/harness/core/payload'
import { RutisMemoryVectorStores } from '../../../src/main/harness/memory-vector'
import { CoreCarrierConfigSchema, type CorePayload } from '../../../src/shared/harness/core'

export default definePlugin({
  name: 'core-memory-contract',
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
    const payloads = new CorePayloadStore(config, 'core')
    const service = ctx.use<CoreMemoryService>('deepchatCoreNative')
    let memoryIdentity: unknown
    const memory = new CoreMemoryRuntime(
      ctx,
      {
        async memory(...args) {
          const value = await service.memory(...args)
          if (args[2] === 'start') memoryIdentity = value
          return value
        }
      },
      config.generation
    )
    let stores: RutisMemoryVectorStores | undefined
    let stopped = false
    const status = () => ({
      generation: config.generation,
      pid: process.pid,
      node: process.versions.node,
      modules: process.versions.modules,
      phase: stopped ? 'stopped' : 'idle',
      businessReady: false
    })
    const stop = async () => {
      await stores?.dispose()
      await memory.retire()
      stopped = true
    }
    ctx.effect(async () => {
      await stop()
      await payloads.close()
    })
    ctx.provide('deepchatCore', {
      identity: status,
      status: async () => await payloads.encode(status()),
      async openProfile(ref: CorePayload) {
        const bootstrap = (await payloads.decode(ref)) as {
          userDataDirectory: string
          appPath: string
        }
        stores = new RutisMemoryVectorStores(memory, {
          memoryDbDir: path.join(bootstrap.userDataDirectory, 'memory'),
          host: {
            appPath: bootstrap.appPath,
            userDataPath: bootstrap.userDataDirectory,
            isPackaged: false
          }
        })
        return await payloads.encode(status())
      },
      async configure(ref: CorePayload) {
        const { operation } = (await payloads.decode(ref)) as { operation: string }
        if (!stores) throw new Error('Memory has not been configured')
        if (operation === 'initialize') {
          const store = await stores.createVectorStore(
            randomUUID(),
            { providerId: 'fixture', modelId: 'fixture' },
            2
          )
          await store.close()
          return await payloads.encode(memoryIdentity)
        }
        if (operation === 'nativeSnapshot') {
          const store = await stores.createVectorStore(
            'core-data',
            { providerId: 'fixture', modelId: 'fixture' },
            2048
          )
          const records = Array.from({ length: 45 }, (_, row) => ({
            memoryId: `row-${String(row).padStart(2, '0')}`,
            embedding: Array.from({ length: 2048 }, (_, column) =>
              column === row ? 1 : column === 2047 ? -0.25 : 0
            )
          }))
          await store.upsert(records)
          const before = await store.listMemoryIds(null, 50)
          await store.deleteByMemoryIds(['row-00'])
          const after = await store.listMemoryIds(null, 50)
          await store.close()
          return await payloads.encode({ before, after })
        }
        return await payloads.encode({ available: memory.memoryAvailable })
      },
      async stop() {
        await stop()
        return await payloads.encode(status())
      }
    })
  }
})
