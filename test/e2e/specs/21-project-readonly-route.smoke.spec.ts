import { test, expect } from '../fixtures/electronApp'
import { openSettings, openSettingsTab } from '../helpers/settings'
import { waitForAppReady } from '../helpers/wait'

test('environment settings reads project routes without native dialogs @smoke', async ({ app }) => {
  await waitForAppReady(app.page)

  const settingsPage = await openSettings(app)
  await openSettingsTab(settingsPage, 'settings-tab-environments')
  await expect(settingsPage.getByTestId('settings-environments-page')).toBeVisible({
    timeout: 30_000
  })
  await expect(settingsPage.getByTestId('missing-toggle')).toBeVisible({
    timeout: 30_000
  })
  await expect(settingsPage.getByTestId('environments-active-tab')).toBeVisible({
    timeout: 30_000
  })
  await expect(settingsPage.getByTestId('environments-archived-tab')).toBeVisible({
    timeout: 30_000
  })

  await settingsPage.getByTestId('environments-archived-tab').click()
  const archivedPanel = settingsPage.getByTestId('environments-archived-panel')
  await expect(archivedPanel).toBeVisible({ timeout: 30_000 })
  await expect(
    archivedPanel
      .locator('[data-testid="environments-archived-empty"], [data-testid="environment-row"]')
      .first()
  ).toBeVisible({ timeout: 30_000 })
  await settingsPage.getByTestId('environments-active-tab').click()

  const repoRoot = process.cwd()
  const missingPath = `${repoRoot}/.deepchat-e2e-missing-${Date.now()}`
  const snapshot = await settingsPage.evaluate(
    async ({ existingPath, missingPath }) => {
      type Project = {
        icon?: unknown
        exists?: unknown
        lastAccessedAt?: unknown
        name?: unknown
        path?: unknown
      }

      type Environment = {
        archivedAt?: unknown
        exists?: unknown
        isTemp?: unknown
        lastUsedAt?: unknown
        name?: unknown
        path?: unknown
        removedAt?: unknown
        sessionCount?: unknown
        sortOrder?: unknown
        status?: unknown
      }

      const recent = (await window.deepchat.invoke('project.listRecent', { limit: 10 })) as {
        projects?: Project[]
      }
      const environments = (await window.deepchat.invoke('project.listEnvironments', {
        status: 'active'
      })) as {
        environments?: Environment[]
      }
      const archivedEnvironments = (await window.deepchat.invoke('project.listEnvironments', {
        status: 'archived'
      })) as {
        environments?: Environment[]
      }
      const existing = (await window.deepchat.invoke('project.pathExists', {
        path: existingPath
      })) as {
        exists?: unknown
      }
      const missing = (await window.deepchat.invoke('project.pathExists', {
        path: missingPath
      })) as {
        exists?: unknown
      }

      const projects = Array.isArray(recent.projects) ? recent.projects : []
      const environmentRows = Array.from(
        document.querySelectorAll('[data-testid="environment-row"]')
      )

      const summarizeEnvironment = (environment: Environment) => ({
        archivedAtType: typeof environment.archivedAt,
        existsType: typeof environment.exists,
        isTempType: typeof environment.isTemp,
        lastUsedAtType: typeof environment.lastUsedAt,
        nameType: typeof environment.name,
        pathType: typeof environment.path,
        removedAtType: typeof environment.removedAt,
        sessionCountType: typeof environment.sessionCount,
        sortOrderType: typeof environment.sortOrder,
        status: environment.status,
        statusType: typeof environment.status
      })

      return {
        archivedEnvironmentCount: archivedEnvironments.environments?.length ?? -1,
        archivedEnvironments: (archivedEnvironments.environments ?? [])
          .slice(0, 10)
          .map(summarizeEnvironment),
        environmentCount: environments.environments?.length ?? -1,
        environmentRowsCount: environmentRows.length,
        environments: (environments.environments ?? []).slice(0, 10).map(summarizeEnvironment),
        existingPathExists: existing.exists,
        missingPathExists: missing.exists,
        projectCount: projects.length,
        projects: projects.slice(0, 10).map((project) => ({
          existsType: typeof project.exists,
          iconType: typeof project.icon,
          lastAccessedAtType: typeof project.lastAccessedAt,
          nameType: typeof project.name,
          pathType: typeof project.path
        }))
      }
    },
    { existingPath: repoRoot, missingPath }
  )

  expect(snapshot.projectCount).toBeGreaterThanOrEqual(0)
  expect(snapshot.environmentCount).toBeGreaterThanOrEqual(0)
  expect(snapshot.archivedEnvironmentCount).toBeGreaterThanOrEqual(0)
  expect(snapshot.environmentRowsCount).toBeGreaterThanOrEqual(0)
  expect(snapshot.existingPathExists).toBe(true)
  expect(snapshot.missingPathExists).toBe(false)

  for (const project of snapshot.projects) {
    expect(project.pathType).toBe('string')
    expect(project.nameType).toBe('string')
    expect(project.iconType === 'string' || project.iconType === 'object').toBe(true)
    expect(project.lastAccessedAtType).toBe('number')
    expect(project.existsType).toBe('boolean')
  }

  for (const environment of snapshot.environments) {
    expect(environment.pathType).toBe('string')
    expect(environment.nameType).toBe('string')
    expect(environment.sessionCountType).toBe('number')
    expect(environment.lastUsedAtType).toBe('number')
    expect(environment.isTempType).toBe('boolean')
    expect(environment.existsType).toBe('boolean')
    expect(environment.statusType).toBe('string')
    expect(environment.status).toBe('active')
    expect(environment.sortOrderType).toBe('number')
    expect(environment.archivedAtType === 'number' || environment.archivedAtType === 'object').toBe(
      true
    )
    expect(environment.removedAtType === 'number' || environment.removedAtType === 'object').toBe(
      true
    )
  }

  for (const environment of snapshot.archivedEnvironments) {
    expect(environment.pathType).toBe('string')
    expect(environment.nameType).toBe('string')
    expect(environment.sessionCountType).toBe('number')
    expect(environment.lastUsedAtType).toBe('number')
    expect(environment.isTempType).toBe('boolean')
    expect(environment.existsType).toBe('boolean')
    expect(environment.statusType).toBe('string')
    expect(environment.status).toBe('archived')
    expect(environment.sortOrderType).toBe('number')
    expect(environment.archivedAtType === 'number' || environment.archivedAtType === 'object').toBe(
      true
    )
    expect(environment.removedAtType === 'number' || environment.removedAtType === 'object').toBe(
      true
    )
  }
})
