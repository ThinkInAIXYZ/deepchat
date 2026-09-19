import { describe, expect, it } from 'vitest'
import { AgentLifecycleGate } from '@/agent/lifecycleGate'

const createDeferred = <T>() => {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

describe('AgentLifecycleGate', () => {
  it('fences new operations and waits for admitted operations before deletion', async () => {
    const gate = new AgentLifecycleGate()
    const operationStarted = createDeferred<void>()
    const operationRelease = createDeferred<void>()
    const deletionStarted = createDeferred<void>()
    const deletionRelease = createDeferred<void>()
    let deletionEntered = false

    const operation = gate.runWithAgentOperation(' writer ', async () => {
      operationStarted.resolve(undefined)
      await operationRelease.promise
      return 'operation-complete'
    })
    await operationStarted.promise

    const deletion = gate.runWithAgentDeletion('writer', async () => {
      deletionEntered = true
      deletionStarted.resolve(undefined)
      await deletionRelease.promise
      return 'deleted'
    })
    await Promise.resolve()

    await expect(
      gate.runWithAgentOperation('writer', async () => 'late-operation')
    ).rejects.toThrow('DeepChat Agent is being deleted: writer')
    expect(deletionEntered).toBe(false)

    operationRelease.resolve(undefined)
    await expect(operation).resolves.toBe('operation-complete')
    await deletionStarted.promise
    deletionRelease.resolve(undefined)
    await expect(deletion).resolves.toBe('deleted')
    await expect(gate.runWithAgentOperation('writer', async () => 'next')).resolves.toBe('next')
  })

  it('isolates Agent ids and drains rejected operations', async () => {
    const gate = new AgentLifecycleGate()
    const operationStarted = createDeferred<void>()
    const operationRelease = createDeferred<void>()

    const operation = gate.runWithAgentOperation('writer', async () => {
      operationStarted.resolve(undefined)
      await operationRelease.promise
      throw new Error('operation failed')
    })
    await operationStarted.promise

    await expect(gate.runWithAgentOperation('reviewer', async () => 'parallel')).resolves.toBe(
      'parallel'
    )
    const deletion = gate.runWithAgentDeletion('writer', async () => 'deleted')
    operationRelease.resolve(undefined)
    await expect(operation).rejects.toThrow('operation failed')
    await expect(deletion).resolves.toBe('deleted')
  })
})
