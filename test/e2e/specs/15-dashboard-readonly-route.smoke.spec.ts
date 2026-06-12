import { test, expect } from '../fixtures/electronApp'
import { openSettings, openSettingsTab } from '../helpers/settings'
import { waitForAppReady } from '../helpers/wait'

test('dashboard settings reads usage dashboard through typed route @smoke', async ({ app }) => {
  await waitForAppReady(app.page)

  const settingsPage = await openSettings(app)
  await openSettingsTab(settingsPage, 'settings-tab-overview')
  await expect(settingsPage.getByTestId('settings-overview-page')).toBeVisible({
    timeout: 30_000
  })
  await expect(settingsPage.getByTestId('settings-overview-usage-dashboard')).toBeVisible({
    timeout: 30_000
  })

  const snapshot = await settingsPage.evaluate(async () => {
    const result = (await window.deepchat.invoke('sessions.getUsageDashboard', {})) as {
      dashboard?: {
        backfillStatus?: { status?: unknown }
        calendar?: unknown[]
        modelBreakdown?: unknown[]
        providerBreakdown?: unknown[]
        recordingStartedAt?: unknown
        rtk?: {
          daily?: unknown[]
          health?: unknown
          scope?: unknown
          source?: unknown
          summary?: {
            totalCommands?: unknown
            totalSavedTokens?: unknown
          }
        }
        summary?: {
          estimatedCostUsd?: unknown
          messageCount?: unknown
          sessionCount?: unknown
          totalTokens?: unknown
        }
      }
    }

    const dashboard = result.dashboard
    return {
      backfillStatus: dashboard?.backfillStatus?.status,
      calendarCount: dashboard?.calendar?.length ?? -1,
      modelBreakdownCount: dashboard?.modelBreakdown?.length ?? -1,
      providerBreakdownCount: dashboard?.providerBreakdown?.length ?? -1,
      recordingStartedAt: dashboard?.recordingStartedAt,
      rtkDailyCount: dashboard?.rtk?.daily?.length ?? -1,
      rtkHealth: dashboard?.rtk?.health,
      rtkScope: dashboard?.rtk?.scope,
      rtkSource: dashboard?.rtk?.source,
      rtkTotalCommands: dashboard?.rtk?.summary?.totalCommands,
      rtkTotalSavedTokens: dashboard?.rtk?.summary?.totalSavedTokens,
      summaryEstimatedCostUsd: dashboard?.summary?.estimatedCostUsd,
      summaryMessageCount: dashboard?.summary?.messageCount,
      summarySessionCount: dashboard?.summary?.sessionCount,
      summaryTotalTokens: dashboard?.summary?.totalTokens
    }
  })

  expect(['idle', 'running', 'completed', 'failed']).toContain(snapshot.backfillStatus)
  expect(snapshot.calendarCount).toBeGreaterThanOrEqual(0)
  expect(snapshot.modelBreakdownCount).toBeGreaterThanOrEqual(0)
  expect(snapshot.providerBreakdownCount).toBeGreaterThanOrEqual(0)
  expect(
    snapshot.recordingStartedAt === null || typeof snapshot.recordingStartedAt === 'number'
  ).toBe(true)
  expect(snapshot.rtkDailyCount).toBeGreaterThanOrEqual(0)
  expect(['checking', 'healthy', 'unhealthy']).toContain(snapshot.rtkHealth)
  expect(snapshot.rtkScope).toBe('deepchat')
  expect(['bundled', 'system', 'none']).toContain(snapshot.rtkSource)
  expect(typeof snapshot.rtkTotalCommands).toBe('number')
  expect(typeof snapshot.rtkTotalSavedTokens).toBe('number')
  expect(
    snapshot.summaryEstimatedCostUsd === null ||
      typeof snapshot.summaryEstimatedCostUsd === 'number'
  ).toBe(true)
  expect(typeof snapshot.summaryMessageCount).toBe('number')
  expect(typeof snapshot.summarySessionCount).toBe('number')
  expect(typeof snapshot.summaryTotalTokens).toBe('number')
})
