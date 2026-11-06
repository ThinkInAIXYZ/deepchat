import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nodeAppHost } from '@/platform/node/appHost'
import {
  BrowserWindow,
  ipcMain,
  invokeIpc,
  whenIpcHandlerRegistered
} from '@/platform/node/electron'

const channel = 'test:sidecar-ready'

beforeEach(() => {
  vi.stubEnv('DEEPCHAT_NATIVE_WINDOW_ID', '1')
})

afterEach(() => {
  ipcMain.removeHandler(channel)
  vi.unstubAllEnvs()
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
    const primary = new BrowserWindow({})
    nodeAppHost.registerNativePrimaryWindow!(primary)
    await ready

    expect(becameReady).toBe(true)
    await expect(
      invokeIpc(channel, [], { windowId: primary.id, documentUrl: 'mygo://localhost/' })
    ).resolves.toEqual({ handled: true, value: 'ready' })
  })
})
