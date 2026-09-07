import { describe, expect, it, vi } from 'vitest'
import { SessionDeletionGate } from '@/session/deletionGate'

describe('SessionDeletionGate', () => {
  it('waits for admitted work and rejects work that arrives after deletion starts', async () => {
    const gate = new SessionDeletionGate()
    let releaseOperation!: () => void
    const operation = gate.runWithSessionOperation(
      'parent',
      async () =>
        await new Promise<void>((resolve) => {
          releaseOperation = resolve
        })
    )

    let deletionEntered = false
    const deletion = gate.runWithSessionDeletion('parent', async () => {
      deletionEntered = true
    })
    await new Promise<void>((resolve) => setImmediate(resolve))

    expect(deletionEntered).toBe(false)
    await expect(gate.runWithSessionOperation('parent', async () => undefined)).rejects.toThrow(
      'Session is being deleted: parent'
    )

    releaseOperation()
    await operation
    await deletion
    expect(deletionEntered).toBe(true)
  })

  it('releases the fence when deletion fails', async () => {
    const gate = new SessionDeletionGate()

    await expect(
      gate.runWithSessionDeletion('parent', async () => {
        throw new Error('delete failed')
      })
    ).rejects.toThrow('delete failed')

    await expect(gate.runWithSessionOperation('parent', async () => 'available')).resolves.toBe(
      'available'
    )
  })

  it('bounds drain waits and removes the timed-out deletion fence', async () => {
    vi.useFakeTimers()
    try {
      const gate = new SessionDeletionGate(25)
      let releaseOperation!: () => void
      const operation = gate.runWithSessionOperation(
        'parent',
        async () =>
          await new Promise<void>((resolve) => {
            releaseOperation = resolve
          })
      )
      const deletion = gate.runWithSessionDeletion('parent', async () => undefined)
      const rejection = expect(deletion).rejects.toThrow(
        'Timed out waiting for active Session operations to drain: parent (25ms)'
      )

      await vi.advanceTimersByTimeAsync(25)
      await rejection
      await expect(gate.runWithSessionOperation('parent', async () => 'available')).resolves.toBe(
        'available'
      )

      releaseOperation()
      await operation
      await expect(gate.runWithSessionDeletion('parent', async () => 'deleted')).resolves.toBe(
        'deleted'
      )
    } finally {
      vi.useRealTimers()
    }
  })
})
