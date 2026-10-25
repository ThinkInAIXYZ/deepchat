import { definePlugin } from '@arcships/rutis'
import { MemoryVectorOwner } from '../memory-vector'
import {
  MEMORY_VECTOR_PENDING,
  type MemoryVectorNativeCommand,
  type MemoryVectorConfig
} from '@shared/harness/memory-vector'
import {
  isDuckDbFatalError,
  MemoryVectorStoreQuarantineRequiredError
} from '@/memory/infra/vectorStoreErrors'

export default definePlugin<MemoryVectorConfig>({
  name: 'deepchat-memory-vector',
  provides: { harnessMemoryVector: { dispatch: 'async', identity: 'async' } },
  apply(ctx, config) {
    const owner = new MemoryVectorOwner(config)
    let nextRequest = 1
    const requests = new Map<
      number,
      {
        command: unknown
        resolve: (value: unknown) => void
        reject: (error: unknown) => void
      }
    >()
    ctx.effect(async () => {
      for (const request of requests.values())
        request.reject(new Error('Memory vector generation ended'))
      requests.clear()
      await owner.dispose()
    })
    ctx.provide('harnessMemoryVector', {
      identity: () => ({
        generation: config.generation,
        pid: process.pid,
        node: process.versions.node,
        modules: process.versions.modules
      }),
      dispatch(sequence: number, command: unknown): Promise<unknown> {
        if (
          !Number.isSafeInteger(sequence) ||
          sequence < nextRequest ||
          sequence - nextRequest >= MEMORY_VECTOR_PENDING ||
          requests.has(sequence)
        ) {
          throw new Error('Invalid memory vector command sequence')
        }
        return new Promise((resolve, reject) => {
          requests.set(sequence, { command, resolve, reject })
          while (requests.has(nextRequest)) {
            const request = requests.get(nextRequest)!
            requests.delete(nextRequest++)
            // Start in wire order; close must fence an opening native handle without waiting for it.
            owner.command(request.command).then(
              (value) => {
                // Poisoned native handles cannot run GC finalizers before the file owner dies.
                if ((request.command as MemoryVectorNativeCommand).method === 'quarantine')
                  process.kill(process.pid, 'SIGKILL')
                else request.resolve(value)
              },
              (error) => {
                if (
                  error instanceof MemoryVectorStoreQuarantineRequiredError ||
                  isDuckDbFatalError(error)
                )
                  process.kill(process.pid, 'SIGKILL')
                else request.reject(error)
              }
            )
          }
        })
      }
    })
  }
})
