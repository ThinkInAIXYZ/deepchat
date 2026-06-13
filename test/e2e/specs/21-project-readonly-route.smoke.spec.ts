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

  const repoRoot = process.cwd()
  const missingPath = `${repoRoot}/.deepchat-e2e-missing-${Date.now()}`
  const snapshot = await settingsPage.evaluate(
    async ({ existingPath, missingPath }) => {
      type Project = {
        icon?: unknown
        lastAccessedAt?: unknown
        name?: unknown
        path?: unknown
      }

      type Environment = {
        exists?: unknown
        isTemp?: unknown
        lastUsedAt?: unknown
        name?: unknown
        path?: unknown
        sessionCount?: unknown
      }

      const recent = (await window.deepchat.invoke('project.listRecent', { limit: 10 })) as {
        projects?: Project[]
      }
      const environments = (await window.deepchat.invoke('project.listEnvironments', {})) as {
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

      return {
        environmentCount: environments.environments?.length ?? -1,
        environmentRowsCount: environmentRows.length,
        environments: (environments.environments ?? []).slice(0, 10).map((environment) => ({
          existsType: typeof environment.exists,
          isTempType: typeof environment.isTemp,
          lastUsedAtType: typeof environment.lastUsedAt,
          nameType: typeof environment.name,
          pathType: typeof environment.path,
          sessionCountType: typeof environment.sessionCount
        })),
        existingPathExists: existing.exists,
        missingPathExists: missing.exists,
        projectCount: projects.length,
        projects: projects.slice(0, 10).map((project) => ({
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
  expect(snapshot.environmentRowsCount).toBeGreaterThanOrEqual(0)
  expect(snapshot.existingPathExists).toBe(true)
  expect(snapshot.missingPathExists).toBe(false)

  for (const project of snapshot.projects) {
    expect(project.pathType).toBe('string')
    expect(project.nameType).toBe('string')
    expect(project.iconType === 'string' || project.iconType === 'object').toBe(true)
    expect(project.lastAccessedAtType).toBe('number')
  }

  for (const environment of snapshot.environments) {
    expect(environment.pathType).toBe('string')
    expect(environment.nameType).toBe('string')
    expect(environment.sessionCountType).toBe('number')
    expect(environment.lastUsedAtType).toBe('number')
    expect(environment.isTempType).toBe('boolean')
    expect(environment.existsType).toBe('boolean')
  }
})
