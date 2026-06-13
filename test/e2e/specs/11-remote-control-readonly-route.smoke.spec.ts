import { test, expect } from '../fixtures/electronApp'
import { openSettings, openSettingsTab } from '../helpers/settings'
import { waitForAppReady } from '../helpers/wait'

const expectedChannels = ['telegram', 'feishu', 'qqbot', 'discord', 'weixin-ilink'] as const

test('remote settings read-only routes match visible channel tabs @smoke', async ({ app }) => {
  await waitForAppReady(app.page)

  const settingsPage = await openSettings(app)
  await openSettingsTab(settingsPage, 'settings-tab-remote')
  await expect(settingsPage.getByTestId('settings-remote-page')).toBeVisible({ timeout: 30_000 })

  for (const channel of expectedChannels) {
    const tab = settingsPage.getByTestId(`remote-tab-${channel}`)
    await expect(tab).toBeVisible({ timeout: 30_000 })
    await tab.click()
    await expect(settingsPage.getByTestId(`remote-channel-toggle-${channel}`)).toBeVisible({
      timeout: 30_000
    })
  }

  const routeSnapshot = await settingsPage.evaluate(async (channels) => {
    const listed = (await window.deepchat.invoke('remoteControl.listChannels', {})) as {
      channels?: Array<{
        id?: unknown
        implemented?: unknown
        supportsPairing?: unknown
      }>
    }

    const perChannel = []
    for (const channel of channels) {
      const settings = (await window.deepchat.invoke('remoteControl.getChannelSettings', {
        channel
      })) as {
        settings?: Record<string, unknown>
      }
      const status = (await window.deepchat.invoke('remoteControl.getChannelStatus', {
        channel
      })) as {
        status?: Record<string, unknown>
      }
      const bindings = (await window.deepchat.invoke('remoteControl.getChannelBindings', {
        channel
      })) as {
        bindings?: unknown[]
      }

      perChannel.push({
        channel,
        bindingCount: bindings.bindings?.length ?? -1,
        defaultAgentIdType: typeof settings.settings?.defaultAgentId,
        defaultWorkdirType: typeof settings.settings?.defaultWorkdir,
        remoteEnabledType: typeof settings.settings?.remoteEnabled,
        statusChannel: status.status?.channel,
        statusEnabledType: typeof status.status?.enabled,
        statusStateType: typeof status.status?.state
      })
    }

    return {
      channels: listed.channels?.map((channel) => ({
        id: channel.id,
        implemented: channel.implemented,
        supportsPairing: channel.supportsPairing
      })),
      perChannel
    }
  }, expectedChannels)

  expect(routeSnapshot.channels?.map((channel) => channel.id)).toEqual([...expectedChannels])
  for (const channel of routeSnapshot.channels ?? []) {
    expect(channel.implemented).toBe(true)
    expect(typeof channel.supportsPairing).toBe('boolean')
  }

  for (const snapshot of routeSnapshot.perChannel) {
    expect(snapshot.statusChannel).toBe(snapshot.channel)
    expect(snapshot.remoteEnabledType).toBe('boolean')
    expect(snapshot.defaultAgentIdType).toBe('string')
    expect(snapshot.defaultWorkdirType).toBe('string')
    expect(snapshot.statusEnabledType).toBe('boolean')
    expect(snapshot.statusStateType).toBe('string')
    expect(snapshot.bindingCount).toBeGreaterThanOrEqual(0)
  }
})
