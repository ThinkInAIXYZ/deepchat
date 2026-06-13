import { test, expect } from '../fixtures/electronApp'
import { openSettings, openSettingsTab } from '../helpers/settings'
import { waitForAppReady } from '../helpers/wait'

type HookConfig = {
  hooks: Array<{
    id: string
    name: string
    enabled: boolean
    command: string
    events: string[]
  }>
}

test('notification hooks can save test command and restore config @smoke', async ({ app }) => {
  await waitForAppReady(app.page)

  const settingsPage = await openSettings(app)
  const hookId = `deepchat-e2e-hook-${Date.now()}`
  let originalConfig: HookConfig | null = null

  try {
    originalConfig = await settingsPage.evaluate(async () => {
      const result = (await window.deepchat.invoke('config.getHooksNotifications', {})) as {
        config: HookConfig
      }
      return result.config
    })

    const tempConfig: HookConfig = {
      hooks: [
        ...(originalConfig?.hooks ?? []).filter((hook) => hook.id !== hookId),
        {
          id: hookId,
          name: 'DeepChat E2E Hook',
          enabled: true,
          command: 'node -e "console.log(\'deepchat-hook-e2e-ok\')"',
          events: ['SessionStart']
        }
      ]
    }

    const savedConfig = (await settingsPage.evaluate(
      async ({ config }) => {
        return await window.deepchat.invoke('config.setHooksNotifications', { config })
      },
      { config: tempConfig }
    )) as {
      config?: HookConfig
    }
    expect(savedConfig.config?.hooks.some((hook) => hook.id === hookId)).toBe(true)

    await openSettingsTab(settingsPage, 'settings-tab-notifications-hooks')
    await expect(settingsPage.getByTestId('settings-notifications-hooks-page')).toBeVisible({
      timeout: 30_000
    })
    await expect(settingsPage.getByTestId(`notifications-hook-${hookId}`)).toBeVisible({
      timeout: 30_000
    })

    const testResult = (await settingsPage.evaluate(
      async ({ hookId }) => {
        return await window.deepchat.invoke('config.testHookCommand', { hookId })
      },
      { hookId }
    )) as {
      result?: {
        durationMs?: unknown
        exitCode?: unknown
        stdout?: unknown
        success?: unknown
      }
    }

    expect(testResult.result?.success).toBe(true)
    expect(testResult.result?.exitCode).toBe(0)
    expect(typeof testResult.result?.durationMs).toBe('number')
    expect(String(testResult.result?.stdout ?? '')).toContain('deepchat-hook-e2e-ok')
  } finally {
    if (originalConfig) {
      await settingsPage
        .evaluate(
          async ({ config }) => {
            await window.deepchat.invoke('config.setHooksNotifications', { config })
          },
          { config: originalConfig }
        )
        .catch(() => undefined)
    }
  }
})
