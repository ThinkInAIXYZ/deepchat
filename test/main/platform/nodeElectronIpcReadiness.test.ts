import { afterEach, describe, expect, it } from 'vitest'
import { ipcMain, invokeIpc, whenIpcHandlerRegistered } from '@/platform/node/electron'

const channel = 'test:sidecar-ready'

afterEach(() => {
  ipcMain.removeHandler(channel)
})

describe('sidecar IPC readiness', () => {
  it('resolves only when the real handler is registered', async () => {
    let becameReady = false
    const ready = whenIpcHandlerRegistered(channel).then(() => {
      becameReady = true
    })

    await Promise.resolve()
    expect(becameReady).toBe(false)

    ipcMain.handle(channel, () => 'ready')
    await ready

    expect(becameReady).toBe(true)
    await expect(invokeIpc(channel, [])).resolves.toEqual({ handled: true, value: 'ready' })
  })
})
