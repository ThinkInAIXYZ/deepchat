import { test, expect } from '../fixtures/electronApp'
import { openSettings, openSettingsTab } from '../helpers/settings'
import { waitForAppReady } from '../helpers/wait'

test('skills sync read-only routes and scan events work from settings @smoke', async ({ app }) => {
  await waitForAppReady(app.page)

  const settingsPage = await openSettings(app)
  await openSettingsTab(settingsPage, 'settings-tab-skills')
  await expect(settingsPage.getByTestId('settings-skills-page')).toBeVisible({
    timeout: 30_000
  })
  await expect(settingsPage.getByTestId('skills-sync-status-section')).toBeVisible({
    timeout: 30_000
  })
  await expect(settingsPage.getByTestId('skills-sync-refresh-button')).toBeVisible({
    timeout: 30_000
  })
  await expect
    .poll(async () => await settingsPage.getByTestId('skills-sync-scanning').isVisible(), {
      timeout: 30_000,
      intervals: [500, 1_000, 2_000]
    })
    .toBe(false)

  const snapshot = await settingsPage.evaluate(async () => {
    type RegisteredTool = {
      id?: unknown
      name?: unknown
      skillsDir?: unknown
      filePattern?: unknown
      format?: unknown
      isProjectLevel?: unknown
    }

    type ScanResult = {
      toolId?: unknown
      toolName?: unknown
      available?: unknown
      skillsDir?: unknown
      skills?: unknown[]
      error?: unknown
    }

    type Discovery = {
      toolId?: unknown
      toolName?: unknown
      newSkills?: unknown[]
    }

    const scanEvents = {
      completed: 0,
      completedResultCount: -1,
      started: 0
    }
    const offStarted = window.deepchat.on('skillSync.scan.started', () => {
      scanEvents.started += 1
    })
    const offCompleted = window.deepchat.on('skillSync.scan.completed', (payload) => {
      scanEvents.completed += 1
      scanEvents.completedResultCount = Array.isArray(payload.results) ? payload.results.length : -1
    })

    const registered = (await window.deepchat.invoke('skillSync.getRegisteredTools', {})) as {
      tools?: RegisteredTool[]
    }
    const discoveries = (await window.deepchat.invoke('skillSync.getNewDiscoveries', {})) as {
      discoveries?: Discovery[]
    }
    const scanned = (await window.deepchat.invoke('skillSync.scanExternalTools', {})) as {
      results?: ScanResult[]
    }

    await new Promise((resolve) => setTimeout(resolve, 250))
    offStarted()
    offCompleted()

    const tools = Array.isArray(registered.tools) ? registered.tools : []
    const results = Array.isArray(scanned.results) ? scanned.results : []
    const discoveryResults = Array.isArray(discoveries.discoveries) ? discoveries.discoveries : []

    return {
      discoveryCount: discoveryResults.length,
      discoveries: discoveryResults.slice(0, 8).map((discovery) => ({
        newSkillCount: Array.isArray(discovery.newSkills) ? discovery.newSkills.length : -1,
        toolId: discovery.toolId,
        toolNameType: typeof discovery.toolName
      })),
      registeredToolCount: tools.length,
      registeredTools: tools.slice(0, 12).map((tool) => ({
        filePatternType: typeof tool.filePattern,
        formatType: typeof tool.format,
        id: tool.id,
        isProjectLevelType: typeof tool.isProjectLevel,
        nameType: typeof tool.name,
        skillsDirType: typeof tool.skillsDir
      })),
      scanEvents,
      scanResultCount: results.length,
      scanResults: results.slice(0, 12).map((result) => ({
        availableType: typeof result.available,
        errorType: typeof result.error,
        skillCount: Array.isArray(result.skills) ? result.skills.length : -1,
        skillsDirType: typeof result.skillsDir,
        toolId: result.toolId,
        toolNameType: typeof result.toolName
      }))
    }
  })

  expect(snapshot.registeredToolCount).toBeGreaterThan(0)
  expect(snapshot.scanResultCount).toBeGreaterThan(0)
  expect(snapshot.discoveryCount).toBeGreaterThanOrEqual(0)

  for (const tool of snapshot.registeredTools) {
    expect(typeof tool.id).toBe('string')
    expect(tool.nameType).toBe('string')
    expect(tool.skillsDirType).toBe('string')
    expect(tool.filePatternType).toBe('string')
    expect(tool.formatType).toBe('string')
    expect(tool.isProjectLevelType === 'boolean' || tool.isProjectLevelType === 'undefined').toBe(
      true
    )
  }

  for (const result of snapshot.scanResults) {
    expect(typeof result.toolId).toBe('string')
    expect(result.toolNameType).toBe('string')
    expect(result.availableType).toBe('boolean')
    expect(result.skillsDirType).toBe('string')
    expect(result.skillCount).toBeGreaterThanOrEqual(0)
    expect(result.errorType === 'string' || result.errorType === 'undefined').toBe(true)
  }

  for (const discovery of snapshot.discoveries) {
    expect(typeof discovery.toolId).toBe('string')
    expect(discovery.toolNameType).toBe('string')
    expect(discovery.newSkillCount).toBeGreaterThan(0)
  }

  expect(snapshot.scanEvents.started).toBeGreaterThanOrEqual(1)
  expect(snapshot.scanEvents.completed).toBeGreaterThanOrEqual(1)
  expect(snapshot.scanEvents.completedResultCount).toBe(snapshot.scanResultCount)
})
