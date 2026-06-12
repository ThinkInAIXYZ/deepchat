import { test, expect } from '../fixtures/electronApp'
import { openSettings, openSettingsTab } from '../helpers/settings'
import { waitForAppReady } from '../helpers/wait'

const migratedSettingsSurfaces = [
  {
    tabTestId: 'settings-tab-knowledge-base',
    pageTestId: 'settings-knowledge-base-page'
  },
  {
    tabTestId: 'settings-tab-skills',
    pageTestId: 'settings-skills-page'
  },
  {
    tabTestId: 'settings-tab-remote',
    pageTestId: 'settings-remote-page'
  },
  {
    tabTestId: 'settings-tab-mcp',
    pageTestId: 'settings-mcp-page'
  },
  {
    tabTestId: 'settings-tab-database',
    pageTestId: 'settings-data-page'
  }
] as const

test('settings IPC boundary rejects legacy presenter transport @smoke', async ({ app }) => {
  await waitForAppReady(app.page)

  const settingsPage = await openSettings(app)

  const boundary = await settingsPage.evaluate(async () => {
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
    try {
      await runtime.deepchat?.invoke?.('presenter:call', {})
    } catch (error) {
      legacyInvokeError = error instanceof Error ? error.message : String(error)
    }

    return {
      apiKeys: Object.keys(runtime.api ?? {}).sort(),
      hasApiIpcRenderer: Boolean(runtime.api && 'ipcRenderer' in runtime.api),
      hasDeepchatInvoke: typeof runtime.deepchat?.invoke === 'function',
      hasDeepchatOn: typeof runtime.deepchat?.on === 'function',
      hasLegacyPresenterGlobal: typeof runtime.useLegacyPresenter === 'function',
      hasWindowElectron: Boolean(runtime.electron),
      legacyInvokeError
    }
  })

  expect(boundary.hasDeepchatInvoke).toBe(true)
  expect(boundary.hasDeepchatOn).toBe(true)
  expect(boundary.hasWindowElectron).toBe(false)
  expect(boundary.hasApiIpcRenderer).toBe(false)
  expect(boundary.hasLegacyPresenterGlobal).toBe(false)
  expect(boundary.apiKeys).not.toContain('ipcRenderer')
  expect(boundary.legacyInvokeError).toContain('Unknown deepchat route: presenter:call')

  for (const surface of migratedSettingsSurfaces) {
    await openSettingsTab(settingsPage, surface.tabTestId)
    await expect(settingsPage.getByTestId(surface.pageTestId)).toBeVisible({ timeout: 30_000 })
  }
})
