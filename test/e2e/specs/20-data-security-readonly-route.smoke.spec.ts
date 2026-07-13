import { test, expect } from '../fixtures/electronApp'
import { openSettings, openSettingsTab } from '../helpers/settings'
import { waitForAppReady } from '../helpers/wait'

test('data settings exposes database security and device read-only routes @smoke', async ({
  app
}) => {
  await waitForAppReady(app.page)

  const settingsPage = await openSettings(app)
  await openSettingsTab(settingsPage, 'settings-tab-database')
  await expect(settingsPage.getByTestId('settings-data-page')).toBeVisible({
    timeout: 30_000
  })
  await expect(settingsPage.getByTestId('database-encryption-section')).toBeVisible({
    timeout: 30_000
  })
  await expect(settingsPage.getByTestId('database-encryption-status-badge')).toBeVisible({
    timeout: 30_000
  })
  await expect(settingsPage.getByTestId('database-repair-section')).toBeVisible({
    timeout: 30_000
  })
  await expect(settingsPage.getByTestId('database-repair-button')).toBeVisible({
    timeout: 30_000
  })
  await expect(settingsPage.getByTestId('yobrowser-sandbox-section')).toBeVisible({
    timeout: 30_000
  })
  await expect(settingsPage.getByTestId('yobrowser-clear-sandbox-button')).toBeVisible({
    timeout: 30_000
  })

  const snapshot = await settingsPage.evaluate(async () => {
    const databaseSecurity = (await window.deepchat.invoke('databaseSecurity.getStatus', {})) as {
      status?: {
        cipher?: unknown
        enabled?: unknown
        lastMigrationAt?: unknown
        manualUnlockRequired?: unknown
        migrationInProgress?: unknown
        passwordStorage?: unknown
        safeStorageAvailable?: unknown
        safeStorageBackend?: unknown
      }
    }
    const deviceInfo = (await window.deepchat.invoke('device.getInfo', {})) as {
      info?: {
        arch?: unknown
        cpuModel?: unknown
        osVersion?: unknown
        osVersionMetadata?: unknown[]
        platform?: unknown
        totalMemory?: unknown
      }
    }
    const appVersion = (await window.deepchat.invoke('device.getAppVersion', {})) as {
      version?: unknown
    }

    return {
      appVersionType: typeof appVersion.version,
      databaseStatus: {
        cipher: databaseSecurity.status?.cipher,
        enabledType: typeof databaseSecurity.status?.enabled,
        lastMigrationAtType: typeof databaseSecurity.status?.lastMigrationAt,
        manualUnlockRequiredType: typeof databaseSecurity.status?.manualUnlockRequired,
        migrationInProgressType: typeof databaseSecurity.status?.migrationInProgress,
        passwordStorage: databaseSecurity.status?.passwordStorage,
        safeStorageAvailableType: typeof databaseSecurity.status?.safeStorageAvailable,
        safeStorageBackendType: typeof databaseSecurity.status?.safeStorageBackend
      },
      deviceInfo: {
        archType: typeof deviceInfo.info?.arch,
        cpuModelType: typeof deviceInfo.info?.cpuModel,
        osVersionMetadataCount: deviceInfo.info?.osVersionMetadata?.length ?? -1,
        osVersionType: typeof deviceInfo.info?.osVersion,
        platformType: typeof deviceInfo.info?.platform,
        totalMemoryType: typeof deviceInfo.info?.totalMemory
      }
    }
  })

  expect(snapshot.appVersionType).toBe('string')
  expect(snapshot.databaseStatus.cipher).toBe('sqlcipher')
  expect(snapshot.databaseStatus.enabledType).toBe('boolean')
  expect(snapshot.databaseStatus.manualUnlockRequiredType).toBe('boolean')
  expect(snapshot.databaseStatus.migrationInProgressType).toBe('boolean')
  expect(['safeStorage', 'manual', 'none']).toContain(snapshot.databaseStatus.passwordStorage)
  expect(snapshot.databaseStatus.safeStorageAvailableType).toBe('boolean')
  expect(
    snapshot.databaseStatus.safeStorageBackendType === 'string' ||
      snapshot.databaseStatus.safeStorageBackendType === 'undefined'
  ).toBe(true)
  expect(
    snapshot.databaseStatus.lastMigrationAtType === 'number' ||
      snapshot.databaseStatus.lastMigrationAtType === 'undefined'
  ).toBe(true)

  expect(snapshot.deviceInfo.platformType).toBe('string')
  expect(snapshot.deviceInfo.archType).toBe('string')
  expect(snapshot.deviceInfo.cpuModelType).toBe('string')
  expect(snapshot.deviceInfo.totalMemoryType).toBe('number')
  expect(snapshot.deviceInfo.osVersionType).toBe('string')
  expect(snapshot.deviceInfo.osVersionMetadataCount).toBeGreaterThanOrEqual(0)
})
