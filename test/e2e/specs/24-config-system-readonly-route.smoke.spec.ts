import { test, expect } from '../fixtures/electronApp'
import { openSettings, openSettingsTab } from '../helpers/settings'
import { waitForAppReady } from '../helpers/wait'

test('config system read-only routes expose proxy sync update and model defaults @smoke', async ({
  app
}) => {
  await waitForAppReady(app.page)

  const settingsPage = await openSettings(app)
  await openSettingsTab(settingsPage, 'settings-tab-about')
  await expect(settingsPage.getByTestId('settings-about-page')).toBeVisible({ timeout: 30_000 })

  const snapshot = await settingsPage.evaluate(async () => {
    type ModelSelection = {
      modelId?: unknown
      providerId?: unknown
    }

    const proxy = (await window.deepchat.invoke('config.getProxySettings', {})) as {
      customProxyUrl?: unknown
      mode?: unknown
    }
    const updateChannel = (await window.deepchat.invoke('config.getUpdateChannel', {})) as {
      channel?: unknown
    }
    const sync = (await window.deepchat.invoke('config.getSyncSettings', {})) as {
      enabled?: unknown
      folderPath?: unknown
    }
    const skillDraft = (await window.deepchat.invoke('config.getSkillDraftSuggestions', {})) as {
      enabled?: unknown
    }
    const upgradeStatus = (await window.deepchat.invoke('upgrade.getStatus', {})) as {
      snapshot?: {
        error?: unknown
        progress?: unknown
        status?: unknown
        updateInfo?: unknown
      }
    }
    const entries = (await window.deepchat.invoke('config.getEntries', {
      keys: ['maxFileSize', 'defaultModel', 'assistantModel']
    })) as {
      values?: {
        assistantModel?: ModelSelection | null
        defaultModel?: ModelSelection
        maxFileSize?: unknown
      }
      version?: unknown
    }

    const isModelSelection = (value: ModelSelection | null | undefined): boolean =>
      value == null || (typeof value.providerId === 'string' && typeof value.modelId === 'string')

    return {
      aboutPageHasChannelOptions:
        document.body.textContent?.includes('stable') ||
        document.body.textContent?.includes('beta'),
      assistantModelValid: isModelSelection(entries.values?.assistantModel),
      customProxyUrlType: typeof proxy.customProxyUrl,
      defaultModelValid: isModelSelection(entries.values?.defaultModel),
      maxFileSizeType: typeof entries.values?.maxFileSize,
      proxyMode: proxy.mode,
      skillDraftEnabledType: typeof skillDraft.enabled,
      syncEnabledType: typeof sync.enabled,
      syncFolderPathType: typeof sync.folderPath,
      updateChannel: updateChannel.channel,
      upgradeErrorValid:
        upgradeStatus.snapshot?.error === null || typeof upgradeStatus.snapshot?.error === 'string',
      upgradeInfoValid:
        upgradeStatus.snapshot?.updateInfo === null ||
        typeof upgradeStatus.snapshot?.updateInfo === 'object',
      upgradeProgressValid:
        upgradeStatus.snapshot?.progress === null ||
        typeof upgradeStatus.snapshot?.progress === 'object',
      upgradeStatusValid:
        upgradeStatus.snapshot?.status === null ||
        typeof upgradeStatus.snapshot?.status === 'string',
      versionType: typeof entries.version
    }
  })

  expect(snapshot.aboutPageHasChannelOptions).toBe(true)
  expect(['system', 'none', 'custom']).toContain(snapshot.proxyMode)
  expect(snapshot.customProxyUrlType).toBe('string')
  expect(['stable', 'beta']).toContain(snapshot.updateChannel)
  expect(snapshot.syncEnabledType).toBe('boolean')
  expect(snapshot.syncFolderPathType).toBe('string')
  expect(snapshot.skillDraftEnabledType).toBe('boolean')
  expect(snapshot.upgradeStatusValid).toBe(true)
  expect(snapshot.upgradeProgressValid).toBe(true)
  expect(snapshot.upgradeErrorValid).toBe(true)
  expect(snapshot.upgradeInfoValid).toBe(true)
  expect(snapshot.versionType).toBe('number')
  expect(['number', 'undefined']).toContain(snapshot.maxFileSizeType)
  expect(snapshot.defaultModelValid).toBe(true)
  expect(snapshot.assistantModelValid).toBe(true)
})
