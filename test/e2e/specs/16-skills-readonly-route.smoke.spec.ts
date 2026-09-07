import { test, expect } from '../fixtures/electronApp'
import { waitForAppReady } from '../helpers/wait'

test('Plugins Skills exposes read-only skill routes through typed bridge @smoke', async ({
  app
}) => {
  await waitForAppReady(app.page)

  await app.page.evaluate(() => {
    window.location.hash = '#/plugins/skills'
  })
  const skillsPage = app.page
  await expect(skillsPage.getByTestId('plugins-skills-page')).toBeVisible({ timeout: 30_000 })
  await expect(skillsPage.getByTestId('skills-import-action')).toBeVisible()
  await expect(skillsPage.getByTestId('skills-sync-directory-action')).toBeVisible()
  await expect(skillsPage.getByTestId('skills-agent-assignments-tab')).toHaveCount(0)

  await skillsPage.getByTestId('skills-sync-directory-action').click()
  await expect(skillsPage.getByTestId('skills-back-action')).toBeVisible()
  await skillsPage.getByTestId('skills-back-action').click()

  const snapshot = await skillsPage.evaluate(async () => {
    const directory = (await window.deepchat.invoke('skills.getDirectory', {
      agentId: 'deepchat'
    })) as {
      path?: unknown
    }
    const metadata = (await window.deepchat.invoke('skills.listMetadata', {
      agentId: 'deepchat'
    })) as {
      skills?: Array<{
        description?: unknown
        name?: unknown
        path?: unknown
        skillRoot?: unknown
      }>
    }
    const allSkillsResult = (await window.deepchat.invoke('skills.listAll', {})) as {
      skills?: Array<{
        assigned?: unknown
        assignedAgentIds?: unknown
        name?: unknown
        skillRoot?: unknown
      }>
    }
    const allSkills = Array.isArray(allSkillsResult.skills) ? allSkillsResult.skills : []
    const firstSkill = metadata.skills?.find((skill) => typeof skill.name === 'string')

    if (!firstSkill || typeof firstSkill.name !== 'string') {
      return {
        directoryPath: directory.path,
        hasSkillFileContent: false,
        allSkillCount: allSkills.length,
        allSkillShapeValid: allSkills.every(
          (skill) =>
            typeof skill.name === 'string' &&
            typeof skill.skillRoot === 'string' &&
            typeof skill.assigned === 'boolean' &&
            Array.isArray(skill.assignedAgentIds)
        ),
        skillCount: metadata.skills?.length ?? -1
      }
    }

    const content = (await window.deepchat.invoke('skills.readFile', {
      agentId: 'deepchat',
      name: firstSkill.name
    })) as { content?: unknown }
    const folderTree = (await window.deepchat.invoke('skills.getFolderTree', {
      agentId: 'deepchat',
      name: firstSkill.name
    })) as { nodes?: unknown[] }
    const extension = (await window.deepchat.invoke('skills.getExtension', {
      agentId: 'deepchat',
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
      agentId: 'deepchat',
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
      allSkillCount: allSkills.length,
      allSkillShapeValid: allSkills.every(
        (skill) =>
          typeof skill.name === 'string' &&
          typeof skill.skillRoot === 'string' &&
          typeof skill.assigned === 'boolean' &&
          Array.isArray(skill.assignedAgentIds)
      ),
      scriptCount: scripts.scripts?.length ?? -1,
      skillCount: metadata.skills?.length ?? -1,
      skillExtension: extension.config
    }
  })

  expect(typeof snapshot.directoryPath).toBe('string')
  expect(snapshot.skillCount).toBeGreaterThanOrEqual(0)
  expect(snapshot.allSkillCount).toBeGreaterThanOrEqual(snapshot.skillCount)
  expect(snapshot.allSkillShapeValid).toBe(true)

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

    if (typeof snapshot.firstSkillName === 'string') {
      await skillsPage.getByTestId(`plugin-skill-${snapshot.firstSkillName}`).click()
      await expect(skillsPage.getByTestId('plugins-skill-detail-enabled-agents')).toBeVisible()
    }
  }
})
