import { test, expect } from '../fixtures/electronApp'
import { waitForAppReady } from '../helpers/wait'

test('main renderer IPC boundary rejects legacy presenter transport @smoke', async ({ app }) => {
  await waitForAppReady(app.page)
  await expect(app.page.getByTestId('app-main')).toBeVisible()

  const boundary = await app.page.evaluate(async () => {
    const runtime = window as unknown as {
      api?: Record<string, unknown>
      deepchat?: {
        invoke?: (routeName: string, input: unknown) => Promise<unknown>
        on?: unknown
      }
      electron?: unknown
      useLegacyPresenter?: unknown
    }

    let legacyInvokeError = ''
    let appVersion = ''
    let remoteChannelCount = -1
    let telegramStatusChannel = ''
    let telegramStatusStateType = ''
    try {
      const result = (await runtime.deepchat?.invoke?.('device.getAppVersion', {})) as
        | { version?: unknown }
        | undefined
      appVersion = typeof result?.version === 'string' ? result.version : ''
    } catch {
      appVersion = ''
    }

    try {
      const channels = (await runtime.deepchat?.invoke?.('remoteControl.listChannels', {})) as
        | { channels?: Array<{ id?: unknown }> }
        | undefined
      remoteChannelCount = channels?.channels?.length ?? -1

      const telegramStatus = (await runtime.deepchat?.invoke?.('remoteControl.getChannelStatus', {
        channel: 'telegram'
      })) as { status?: { channel?: unknown; state?: unknown } } | undefined
      telegramStatusChannel =
        typeof telegramStatus?.status?.channel === 'string' ? telegramStatus.status.channel : ''
      telegramStatusStateType = typeof telegramStatus?.status?.state
    } catch {
      remoteChannelCount = -1
      telegramStatusChannel = ''
      telegramStatusStateType = ''
    }

    try {
      await runtime.deepchat?.invoke?.('presenter:call', {})
    } catch (error) {
      legacyInvokeError = error instanceof Error ? error.message : String(error)
    }

    return {
      apiKeys: Object.keys(runtime.api ?? {}).sort(),
      appVersion,
      hasApiIpcRenderer: Boolean(runtime.api && 'ipcRenderer' in runtime.api),
      hasDeepchatInvoke: typeof runtime.deepchat?.invoke === 'function',
      hasDeepchatOn: typeof runtime.deepchat?.on === 'function',
      hasLegacyPresenterGlobal: typeof runtime.useLegacyPresenter === 'function',
      hasWindowElectron: Boolean(runtime.electron),
      legacyInvokeError,
      remoteChannelCount,
      telegramStatusChannel,
      telegramStatusStateType
    }
  })

  expect(boundary.hasDeepchatInvoke).toBe(true)
  expect(boundary.hasDeepchatOn).toBe(true)
  expect(boundary.appVersion).toMatch(/\d+\.\d+\.\d+/)
  expect(boundary.hasWindowElectron).toBe(false)
  expect(boundary.hasApiIpcRenderer).toBe(false)
  expect(boundary.hasLegacyPresenterGlobal).toBe(false)
  expect(boundary.apiKeys).not.toContain('ipcRenderer')
  expect(boundary.remoteChannelCount).toBeGreaterThanOrEqual(5)
  expect(boundary.telegramStatusChannel).toBe('telegram')
  expect(boundary.telegramStatusStateType).toBe('string')
  expect(boundary.legacyInvokeError).toContain('Unknown deepchat route: presenter:call')
})
