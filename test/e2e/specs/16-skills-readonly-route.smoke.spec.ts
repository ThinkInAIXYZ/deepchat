import { test, expect } from '../fixtures/electronApp'
import { openSettings, openSettingsTab } from '../helpers/settings'
import { waitForAppReady } from '../helpers/wait'

test('skills settings exposes read-only skill routes through typed bridge @smoke', async ({
  app
}) => {
  await waitForAppReady(app.page)

  const settingsPage = await openSettings(app)
  await openSettingsTab(settingsPage, 'settings-tab-skills')
  await expect(settingsPage.getByTestId('settings-skills-page')).toBeVisible({ timeout: 30_000 })

  const snapshot = await settingsPage.evaluate(async () => {
    const directory = (await window.deepchat.invoke('skills.getDirectory', {})) as {
      path?: unknown
    }
    const metadata = (await window.deepchat.invoke('skills.listMetadata', {})) as {
      skills?: Array<{
        description?: unknown
        name?: unknown
        path?: unknown
        skillRoot?: unknown
      }>
    }
    const firstSkill = metadata.skills?.find((skill) => typeof skill.name === 'string')

    if (!firstSkill || typeof firstSkill.name !== 'string') {
      return {
        directoryPath: directory.path,
        hasSkillFileContent: false,
        skillCount: metadata.skills?.length ?? -1
      }
    }

    const content = (await window.deepchat.invoke('skills.readFile', {
      name: firstSkill.name
    })) as { content?: unknown }
    const folderTree = (await window.deepchat.invoke('skills.getFolderTree', {
      name: firstSkill.name
    })) as { nodes?: unknown[] }
    const extension = (await window.deepchat.invoke('skills.getExtension', {
      name: firstSkill.name
    })) as {
      config?: {
        env?: unknown
        runtimePolicy?: { node?: unknown; python?: unknown }
        scriptOverrides?: unknown
        version?: unknown
      }
    }
    const scripts = (await window.deepchat.invoke('skills.listScripts', {
      name: firstSkill.name
    })) as { scripts?: unknown[] }

    return {
      directoryPath: directory.path,
      firstSkillDescription: firstSkill.description,
      firstSkillName: firstSkill.name,
      firstSkillPath: firstSkill.path,
      firstSkillRoot: firstSkill.skillRoot,
      folderNodeCount: folderTree.nodes?.length ?? -1,
      hasSkillFileContent: typeof content.content === 'string' && content.content.length > 0,
      scriptCount: scripts.scripts?.length ?? -1,
      skillCount: metadata.skills?.length ?? -1,
      skillExtension: extension.config
    }
  })

  expect(typeof snapshot.directoryPath).toBe('string')
  expect(snapshot.skillCount).toBeGreaterThanOrEqual(0)

  if (snapshot.skillCount > 0) {
    expect(typeof snapshot.firstSkillName).toBe('string')
    expect(typeof snapshot.firstSkillDescription).toBe('string')
    expect(typeof snapshot.firstSkillPath).toBe('string')
    expect(typeof snapshot.firstSkillRoot).toBe('string')
    expect(snapshot.hasSkillFileContent).toBe(true)
    expect(snapshot.folderNodeCount).toBeGreaterThanOrEqual(0)
    expect(snapshot.scriptCount).toBeGreaterThanOrEqual(0)
    expect(snapshot.skillExtension?.version).toBe(1)
    expect(snapshot.skillExtension?.env).toBeTruthy()
    expect(snapshot.skillExtension?.scriptOverrides).toBeTruthy()
    expect(['auto', 'system', 'builtin']).toContain(snapshot.skillExtension?.runtimePolicy?.node)
    expect(['auto', 'system', 'builtin']).toContain(snapshot.skillExtension?.runtimePolicy?.python)
  }
})
