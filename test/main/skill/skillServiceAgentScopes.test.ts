import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { app } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SkillService, type SkillAgentScopePort } from '@/skill'
import type { SkillSettingsPort } from '@/skill/settings'
import type { IFileWatcherService } from '@/platform/fileWatcher'
import type { SkillManagementState, UnifiedSkillItem } from '@shared/types/skillManagement'
import { resolveAgentSkillsRoot } from '@/skill/agentSkillRoots'

vi.unmock('fs')
vi.unmock('node:fs')
vi.unmock('path')
vi.unmock('node:path')

type MigrationAgent = {
  id: string
  enabledSkillNames?: string[] | null
  protected?: boolean
}

describe('SkillService Agent scopes', () => {
  let temporaryRoot: string
  let skillsRoot: string
  let settingsState: SkillManagementState | null
  let agents: MigrationAgent[]
  let sessionAgentIds: Map<string, string>
  let service: SkillService
  let getPathSpy: ReturnType<typeof vi.spyOn>

  const watcherService = {
    watch: vi.fn(async () => ({ close: vi.fn(async () => undefined) })),
    destroy: vi.fn(async () => undefined)
  } as unknown as IFileWatcherService

  const sessionState = {
    hasNewSession: vi.fn(async () => true),
    getPersistedNewSessionSkills: vi.fn(() => []),
    setPersistedNewSessionSkills: vi.fn(),
    repairImportedLegacySessionSkills: vi.fn(async () => [])
  }

  const writeSkill = (root: string, name: string, body: string): string => {
    const skillRoot = path.join(root, name)
    fs.mkdirSync(skillRoot, { recursive: true })
    fs.writeFileSync(
      path.join(skillRoot, 'SKILL.md'),
      `---\nname: ${name}\ndescription: ${name}\n---\n\n${body}`,
      'utf-8'
    )
    return skillRoot
  }

  const toUnifiedItem = (name: string, skillRoot: string): UnifiedSkillItem => ({
    agentId: 'deepchat',
    name,
    description: name,
    path: path.join(skillRoot, 'SKILL.md'),
    skillRoot,
    category: null,
    canonicalPath: skillRoot,
    sourceType: 'created',
    disabled: false,
    deepchatDisabled: false,
    agentLinks: {},
    mutable: true
  })

  beforeEach(() => {
    temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'deepchat-agent-skill-service-'))
    skillsRoot = path.join(temporaryRoot, 'skills')
    settingsState = null
    agents = [{ id: 'deepchat', protected: true }]
    sessionAgentIds = new Map()
    getPathSpy = vi.spyOn(app, 'getPath').mockImplementation((name: string) => {
      if (name === 'home') return temporaryRoot
      if (name === 'temp') return path.join(temporaryRoot, 'temp')
      return temporaryRoot
    })

    const settings = {
      getPath: () => skillsRoot,
      getManagementState: () => settingsState,
      setManagementState: (state: SkillManagementState) => {
        settingsState = structuredClone(state)
      }
    } as unknown as SkillSettingsPort
    const agentScope: SkillAgentScopePort = {
      isDeepChatAgent: async (agentId) => agents.some((agent) => agent.id === agentId),
      listDeepChatAgents: async () => structuredClone(agents),
      getSessionAgentId: async (sessionId) => sessionAgentIds.get(sessionId) ?? null,
      listSessions: async () => []
    }
    service = new SkillService(settings, sessionState, watcherService, vi.fn(), agentScope)
  })

  afterEach(async () => {
    await service.destroy()
    getPathSpy.mockRestore()
    fs.rmSync(temporaryRoot, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  it('restores the previous Skill when a staged overwrite fails after backup', async () => {
    agents.push({ id: 'writer' })
    const writerRoot = resolveAgentSkillsRoot(skillsRoot, 'writer')
    const targetRoot = writeSkill(writerRoot, 'review', '# old')
    const sourceRoot = writeSkill(path.join(temporaryRoot, 'source'), 'review', '# new')
    vi.spyOn(service as any, 'parseSkillMetadata').mockResolvedValue(null)

    const result = await service.installFromFolderForAgent('writer', sourceRoot, {
      overwrite: true
    })

    expect(result.success).toBe(false)
    expect(fs.readFileSync(path.join(targetRoot, 'SKILL.md'), 'utf-8')).toContain('# old')
    expect(fs.readdirSync(writerRoot).some((name) => name.startsWith('.install-'))).toBe(false)
  })

  it('keeps a permanent backup after a successful staged overwrite', async () => {
    agents.push({ id: 'writer' })
    const writerRoot = resolveAgentSkillsRoot(skillsRoot, 'writer')
    const targetRoot = writeSkill(writerRoot, 'review', '# old')
    const sourceRoot = writeSkill(path.join(temporaryRoot, 'source'), 'review', '# new')

    await expect(
      service.installFromFolderForAgent('writer', sourceRoot, { overwrite: true })
    ).resolves.toMatchObject({ success: true, skillName: 'review' })

    expect(fs.readFileSync(path.join(targetRoot, 'SKILL.md'), 'utf-8')).toContain('# new')
    const backupRoot = path.join(temporaryRoot, '.deepchat', 'backups', 'skill-installs')
    const [backupName] = fs.readdirSync(backupRoot)
    expect(fs.readFileSync(path.join(backupRoot, backupName, 'SKILL.md'), 'utf-8')).toContain(
      '# old'
    )
  })

  it('rechecks non-overwrite conflicts at commit time', async () => {
    agents.push({ id: 'writer' })
    const writerRoot = resolveAgentSkillsRoot(skillsRoot, 'writer')
    const sourceRoot = writeSkill(path.join(temporaryRoot, 'source'), 'review', '# candidate')
    const copyDirectory = (service as any).copyDirectory.bind(service)
    vi.spyOn(service as any, 'copyDirectory').mockImplementation(
      (source: string, target: string) => {
        copyDirectory(source, target)
        if (target.includes('/.install-review-')) {
          writeSkill(writerRoot, 'review', '# concurrent winner')
        }
      }
    )

    await expect(service.installFromFolderForAgent('writer', sourceRoot)).resolves.toMatchObject({
      success: false,
      errorCode: 'conflict',
      existingSkillName: 'review'
    })
    expect(fs.readFileSync(path.join(writerRoot, 'review', 'SKILL.md'), 'utf-8')).toContain(
      '# concurrent winner'
    )
    expect(fs.existsSync(path.join(temporaryRoot, '.deepchat', 'backups'))).toBe(false)
  })

  it('persists the initial migration targets and never enrolls later Agents', async () => {
    agents.push({ id: 'legacy-writer', enabledSkillNames: [] })
    vi.spyOn(service, 'getUnifiedSkillCatalog').mockResolvedValue([])
    const migrateScope = vi
      .spyOn(service as any, 'migrateLegacyAgentSkillScope')
      .mockRejectedValueOnce(new Error('copy failed'))

    await expect((service as any).migrateLegacyAgentSkillScopes()).rejects.toThrow('copy failed')
    expect(settingsState?.migration).toMatchObject({
      targetAgentIds: ['legacy-writer'],
      completedAgentIds: []
    })
    expect(migrateScope.mock.calls[0][1]).toEqual([])

    agents.push({ id: 'created-after-failure' })
    migrateScope.mockClear()
    migrateScope.mockResolvedValue(undefined)
    await (service as any).migrateLegacyAgentSkillScopes()

    expect(migrateScope).toHaveBeenCalledOnce()
    expect(migrateScope.mock.calls[0][0]).toBe('legacy-writer')
    expect(settingsState?.migration?.completedAt).toEqual(expect.any(String))

    agents.push({ id: 'created-after-completion' })
    migrateScope.mockClear()
    await (service as any).migrateLegacyAgentSkillScopes()
    expect(migrateScope).not.toHaveBeenCalled()
  })

  it('continues migration when a legacy builtin Skill sidecar is unreadable', async () => {
    const skill = toUnifiedItem(
      'broken-sidecar',
      writeSkill(skillsRoot, 'broken-sidecar', '# Skill')
    )
    vi.spyOn(service, 'getUnifiedSkillCatalog').mockResolvedValue([skill])
    vi.spyOn(service as any, 'migrateLegacySkillExtension').mockRejectedValue(
      new Error('sidecar unreadable')
    )

    await expect((service as any).migrateLegacyAgentSkillScopes()).resolves.toBeUndefined()
    expect(settingsState?.migration?.completedAt).toEqual(expect.any(String))
  })

  it('materializes the builtin legacy allow-list into per-Skill disabled state', async () => {
    const skillA = toUnifiedItem('skill-a', writeSkill(skillsRoot, 'skill-a', '# A'))
    const skillB = toUnifiedItem('skill-b', writeSkill(skillsRoot, 'skill-b', '# B'))
    agents = [{ id: 'deepchat', protected: true, enabledSkillNames: ['skill-a'] }]
    vi.spyOn(service, 'getUnifiedSkillCatalog').mockResolvedValue([skillA, skillB])

    await (service as any).migrateLegacyAgentSkillScopes()

    expect(settingsState?.agents.deepchat.skills['skill-a'].disabled).toBe(false)
    expect(settingsState?.agents.deepchat.skills['skill-b'].disabled).toBe(true)
  })

  it('uses the frozen legacy allow-list for an unreadable Agent config', async () => {
    writeSkill(skillsRoot, 'skill-a', '# A')
    writeSkill(skillsRoot, 'skill-b', '# B')
    agents.push({ id: 'broken' })
    settingsState = {
      version: 2,
      agents: { deepchat: { skills: {} } },
      migration: {
        targetAgentIds: ['broken'],
        completedAgentIds: [],
        legacySkillAllowLists: { broken: ['skill-a'] }
      }
    }

    await (service as any).migrateLegacyAgentSkillScopes()

    const brokenRoot = resolveAgentSkillsRoot(skillsRoot, 'broken')
    expect(fs.existsSync(path.join(brokenRoot, 'skill-a', 'SKILL.md'))).toBe(true)
    expect(fs.existsSync(path.join(brokenRoot, 'skill-b'))).toBe(false)
    expect(settingsState?.agents.broken.skills['skill-a'].disabled).toBe(false)
  })

  it('invalidates an empty Agent catalog discovered before its migration copy commits', async () => {
    const builtinRoot = writeSkill(skillsRoot, 'skill-a', '# A')
    agents.push({ id: 'writer', enabledSkillNames: ['skill-a'] })

    await expect(service.getMetadataList('writer')).resolves.toEqual([])
    expect((service as any).getScopedCatalog('writer').discovered).toBe(true)

    const builtinItem = toUnifiedItem('skill-a', builtinRoot)
    const state = (service as any).getStoredManagementState() as SkillManagementState
    await (service as any).migrateLegacyAgentSkillScope(
      'writer',
      ['skill-a'],
      ['skill-a'],
      [builtinItem],
      new Map([['skill-a', builtinItem]]),
      state
    )

    await expect(service.getMetadataList('writer')).resolves.toEqual([
      expect.objectContaining({ name: 'skill-a' })
    ])
  })

  it('migrates legacy sidecar extensions before manual Agent state is materialized', async () => {
    const extension = {
      version: 1 as const,
      env: { API_KEY: 'legacy-secret' },
      runtimePolicy: { python: 'builtin' as const, node: 'system' as const },
      scriptOverrides: { 'scripts/run.py': { enabled: false } }
    }
    writeSkill(skillsRoot, 'legacy-skill', '# legacy')
    const sidecarDir = path.join(skillsRoot, '.deepchat-meta')
    const sidecarPath = path.join(sidecarDir, 'legacy-skill.json')
    fs.mkdirSync(sidecarDir, { recursive: true })
    fs.writeFileSync(sidecarPath, JSON.stringify(extension), 'utf-8')
    agents.push({ id: 'writer' })

    await (service as any).migrateLegacyAgentSkillScopes()

    expect(settingsState?.agents.deepchat.skills['legacy-skill'].extension).toEqual(extension)
    expect(settingsState?.agents.writer.skills['legacy-skill'].extension).toEqual(extension)
    expect(fs.existsSync(sidecarPath)).toBe(false)
  })

  it('uses default extension state when a legacy sidecar is unreadable', async () => {
    writeSkill(skillsRoot, 'legacy-skill', '# legacy')
    const sidecarDir = path.join(skillsRoot, '.deepchat-meta')
    const sidecarPath = path.join(sidecarDir, 'legacy-skill.json')
    fs.mkdirSync(sidecarDir, { recursive: true })
    fs.writeFileSync(sidecarPath, '{invalid', 'utf-8')
    agents.push({ id: 'writer' })

    await expect((service as any).migrateLegacyAgentSkillScopes()).resolves.toBeUndefined()

    expect(settingsState?.migration?.completedAt).toEqual(expect.any(String))
    expect(settingsState?.agents.deepchat.skills['legacy-skill']).toMatchObject({
      name: 'legacy-skill',
      disabled: false
    })
    expect(fs.existsSync(sidecarPath)).toBe(true)
  })

  it('keeps Plugin management scoped without copying builtin Agent links', async () => {
    const regularRoot = writeSkill(skillsRoot, 'regular-skill', '# regular')
    const pluginRoot = writeSkill(path.join(temporaryRoot, 'plugin'), 'plugin-skill', '# plugin')
    agents = [
      { id: 'deepchat', protected: true, enabledSkillNames: ['regular-skill'] },
      { id: 'writer', enabledSkillNames: ['regular-skill'] }
    ]
    const initialState = (service as any).getStoredManagementState() as SkillManagementState
    initialState.agents.deepchat.skills['plugin-skill'] = {
      ...(service as any).createDefaultManagementItem('plugin-skill', 'deepchat'),
      canonicalPath: pluginRoot,
      agentLinks: {
        'legacy-external': {
          path: '/legacy/external/plugin-skill',
          state: 'linked',
          createdByDeepChat: true
        }
      }
    }
    settingsState = structuredClone(initialState)
    await service.registerPluginSkill({
      ownerPluginId: 'plugin-owner',
      id: 'plugin-skill',
      skillRoot: pluginRoot,
      pluginRoot: path.dirname(pluginRoot)
    })

    await (service as any).migrateLegacyAgentSkillScopes()

    const writerPlugin = (await service.getUnifiedSkillCatalog('writer')).find(
      (skill) => skill.name === 'plugin-skill'
    )
    expect(writerPlugin).toMatchObject({
      ownerPluginId: 'plugin-owner',
      canonicalPath: pluginRoot,
      disabled: true,
      mutable: false
    })
    expect(settingsState?.agents.writer.skills['plugin-skill'].agentLinks).toBeUndefined()
    expect(
      fs.existsSync(path.join(resolveAgentSkillsRoot(skillsRoot, 'writer'), 'plugin-skill'))
    ).toBe(false)
    expect(fs.existsSync(path.join(regularRoot, 'SKILL.md'))).toBe(true)
  })

  it('exposes Plugin Skills before a new Agent private root exists', async () => {
    agents.push({ id: 'writer' })
    const pluginRoot = writeSkill(path.join(temporaryRoot, 'plugin'), 'plugin-skill', '# plugin')
    const writerRoot = resolveAgentSkillsRoot(skillsRoot, 'writer')
    await service.registerPluginSkill({
      ownerPluginId: 'plugin-owner',
      id: 'plugin-skill',
      skillRoot: pluginRoot,
      pluginRoot: path.dirname(pluginRoot)
    })

    await expect(service.getUnifiedSkillCatalog('writer')).resolves.toEqual([
      expect.objectContaining({
        agentId: 'writer',
        name: 'plugin-skill',
        ownerPluginId: 'plugin-owner',
        mutable: false
      })
    ])
    expect(fs.existsSync(writerRoot)).toBe(false)
  })

  it('preserves a preexisting independent Agent root instead of overwriting it', async () => {
    agents.push({ id: 'writer' })
    const writerRoot = resolveAgentSkillsRoot(skillsRoot, 'writer')
    const customRoot = writeSkill(writerRoot, 'custom', '# custom')
    const builtinRoot = writeSkill(skillsRoot, 'builtin-only', '# builtin')
    const builtinItem = toUnifiedItem('builtin-only', builtinRoot)
    vi.spyOn(service as any, 'discoverScopedSkills').mockResolvedValue([
      {
        name: 'custom',
        description: 'custom',
        path: path.join(customRoot, 'SKILL.md'),
        skillRoot: customRoot
      }
    ])
    const state = (service as any).getStoredManagementState() as SkillManagementState

    await (service as any).migrateLegacyAgentSkillScope(
      'writer',
      ['builtin-only'],
      undefined,
      [builtinItem],
      new Map([['builtin-only', builtinItem]]),
      state
    )

    expect(fs.readFileSync(path.join(customRoot, 'SKILL.md'), 'utf-8')).toContain('# custom')
    expect(fs.existsSync(path.join(writerRoot, 'builtin-only'))).toBe(false)
    expect(state.agents.writer.skills.custom.canonicalPath).toBe(customRoot)
  })

  it.skipIf(process.platform === 'win32')(
    'rejects nested symlinks without committing a partial migration root',
    async () => {
      agents.push({ id: 'writer' })
      const sourceRoot = writeSkill(skillsRoot, 'linked-skill', '# linked')
      const referencesRoot = path.join(sourceRoot, 'references')
      fs.mkdirSync(referencesRoot)
      fs.symlinkSync(
        path.join(sourceRoot, 'SKILL.md'),
        path.join(referencesRoot, 'linked.md'),
        'file'
      )
      const item = toUnifiedItem('linked-skill', sourceRoot)
      const state = (service as any).getStoredManagementState() as SkillManagementState

      await expect(
        (service as any).migrateLegacyAgentSkillScope(
          'writer',
          ['linked-skill'],
          ['linked-skill'],
          [item],
          new Map([['linked-skill', item]]),
          state
        )
      ).rejects.toThrow('Symbolic links are not allowed')

      const writerRoot = resolveAgentSkillsRoot(skillsRoot, 'writer')
      expect(fs.existsSync(writerRoot)).toBe(false)
      expect(fs.existsSync(path.join(path.dirname(writerRoot), '.migration-writer'))).toBe(false)
    }
  )

  it('passes the Session Agent scope into draft installation', async () => {
    agents.push({ id: 'writer' })
    sessionAgentIds.set('conversation-1', 'writer')
    const draftId = 'draft-1234'
    const draftPath = (service as any).getDraftPathForId('conversation-1', draftId)
    fs.mkdirSync(draftPath, { recursive: true })
    vi.spyOn(service, 'viewDraftSkill').mockResolvedValue({
      success: true,
      action: 'view',
      draftId,
      skillName: 'draft-skill',
      content: 'draft'
    })
    const install = vi.spyOn(service as any, 'installFromDirectory').mockResolvedValue({
      success: true,
      skillName: 'draft-skill'
    })

    await expect(service.installDraftSkill('conversation-1', draftId)).resolves.toMatchObject({
      success: true,
      installedSkillName: 'draft-skill'
    })
    expect(install).toHaveBeenCalledWith(
      draftPath,
      expect.objectContaining({
        sourceType: 'created',
        agentId: 'writer'
      })
    )
  })

  it('revalidates persisted selections against an explicit transfer target Agent', async () => {
    agents.push({ id: 'writer' })
    sessionAgentIds.set('conversation-1', 'deepchat')
    sessionState.getPersistedNewSessionSkills.mockReturnValue(['writer-skill', 'builtin-only'])
    vi.spyOn(service, 'getMetadataList').mockImplementation(async (agentId?: string) => {
      expect(agentId).toBe('writer')
      return [
        {
          name: 'writer-skill',
          description: 'writer',
          path: '/writer/writer-skill/SKILL.md',
          skillRoot: '/writer/writer-skill'
        }
      ]
    })

    await expect(
      service.revalidateActiveSkillsForAgent('conversation-1', 'writer')
    ).resolves.toEqual(['writer-skill'])
    expect(sessionState.setPersistedNewSessionSkills).toHaveBeenCalledWith('conversation-1', [
      'writer-skill'
    ])
  })

  it('removes an Agent private root, cache, management state, and migration references', async () => {
    agents.push({ id: 'writer' })
    const writerRoot = resolveAgentSkillsRoot(skillsRoot, 'writer')
    writeSkill(writerRoot, 'writer-skill', '# writer')
    settingsState = {
      version: 2,
      agents: {
        deepchat: { skills: {} },
        writer: { skills: {} }
      },
      migration: {
        targetAgentIds: ['writer'],
        completedAgentIds: ['writer'],
        completedAt: new Date().toISOString()
      }
    }
    ;(service as any).getScopedCatalog('writer').metadataCache.set('writer-skill', {
      name: 'writer-skill',
      description: 'writer',
      path: path.join(writerRoot, 'writer-skill', 'SKILL.md'),
      skillRoot: path.join(writerRoot, 'writer-skill')
    })

    await service.cleanupAgentSkills('writer')

    expect(fs.existsSync(writerRoot)).toBe(false)
    expect((service as any).scopedCatalogs.has('writer')).toBe(false)
    expect(settingsState?.agents.writer).toBeUndefined()
    expect(settingsState?.migration?.targetAgentIds).toEqual([])
    expect(settingsState?.migration?.completedAgentIds).toEqual([])
  })

  it('uninstalls the discovered Skill root when its directory name differs from the manifest', async () => {
    agents.push({ id: 'writer' })
    const writerRoot = resolveAgentSkillsRoot(skillsRoot, 'writer')
    const discoveredRoot = path.join(writerRoot, 'a-bundle', 'physical-directory')
    fs.mkdirSync(discoveredRoot, { recursive: true })
    fs.writeFileSync(
      path.join(discoveredRoot, 'SKILL.md'),
      '---\nname: logical-skill\ndescription: logical\n---\n\n# logical',
      'utf-8'
    )
    const decoyRoot = path.join(writerRoot, 'logical-skill')
    fs.mkdirSync(decoyRoot, { recursive: true })
    fs.writeFileSync(
      path.join(decoyRoot, 'SKILL.md'),
      '---\nname: decoy-skill\ndescription: decoy\n---\n\n# decoy',
      'utf-8'
    )

    await service.discoverSkills('writer')
    await expect(service.uninstallSkillForAgent('writer', 'logical-skill')).resolves.toMatchObject({
      success: true,
      skillName: 'logical-skill'
    })

    expect(fs.existsSync(discoveredRoot)).toBe(false)
    expect(fs.existsSync(path.join(decoyRoot, 'SKILL.md'))).toBe(true)
  })

  it('refuses to delete the builtin Agent Skill root', async () => {
    writeSkill(skillsRoot, 'builtin-skill', '# builtin')

    await expect(service.cleanupAgentSkills('deepchat')).rejects.toThrow('cannot be deleted')
    expect(fs.existsSync(path.join(skillsRoot, 'builtin-skill', 'SKILL.md'))).toBe(true)
  })

  it('expands SKILLS_DIR to the current Agent Skill root', async () => {
    agents.push({ id: 'writer' })
    const writerRoot = resolveAgentSkillsRoot(skillsRoot, 'writer')
    writeSkill(writerRoot, 'paths', 'Skills: ${SKILLS_DIR}')

    await service.discoverSkills('writer')
    const content = await service.loadSkillContent('writer', 'paths')

    expect(content?.content).toContain(`Skills: ${writerRoot}`)
  })

  it.skipIf(process.platform === 'win32')(
    'rejects linked files and script roots that escape the physical Skill root',
    async () => {
      agents.push({ id: 'writer' }, { id: 'reviewer' })
      const writerRoot = resolveAgentSkillsRoot(skillsRoot, 'writer')
      const reviewerRoot = resolveAgentSkillsRoot(skillsRoot, 'reviewer')
      const writerSkillRoot = writeSkill(writerRoot, 'writer-skill', '# writer')
      const reviewerSkillRoot = writeSkill(reviewerRoot, 'reviewer-skill', '# reviewer')
      const reviewerReferences = path.join(reviewerSkillRoot, 'references')
      const reviewerScripts = path.join(reviewerSkillRoot, 'scripts')
      fs.mkdirSync(reviewerReferences, { recursive: true })
      fs.mkdirSync(reviewerScripts, { recursive: true })
      fs.writeFileSync(path.join(reviewerReferences, 'secret.md'), 'secret', 'utf-8')
      fs.writeFileSync(path.join(reviewerScripts, 'run.sh'), 'echo secret', 'utf-8')
      fs.mkdirSync(path.join(writerSkillRoot, 'references'), { recursive: true })
      fs.symlinkSync(
        path.join(reviewerReferences, 'secret.md'),
        path.join(writerSkillRoot, 'references', 'secret.md'),
        'file'
      )
      fs.symlinkSync(reviewerScripts, path.join(writerSkillRoot, 'scripts'), 'dir')

      await service.discoverSkills('writer')

      await expect(
        service.viewSkillForAgent('writer', 'writer-skill', {
          filePath: 'references/secret.md'
        })
      ).resolves.toMatchObject({
        success: false,
        error: expect.stringContaining('physical skill root')
      })
      await expect(service.listSkillScriptsForAgent('writer', 'writer-skill')).resolves.toEqual([])
    }
  )

  it('does not recreate a deleted Agent cache from queued watcher events', async () => {
    agents.push({ id: 'writer' })
    const writerRoot = resolveAgentSkillsRoot(skillsRoot, 'writer')
    const skillRoot = writeSkill(writerRoot, 'writer-skill', '# writer')
    await service.discoverSkills('writer')
    agents = agents.filter((agent) => agent.id !== 'writer')

    await service.cleanupAgentSkills('writer')
    await (service as any).handleSkillWatchBatch({
      events: [{ type: 'delete', path: path.join(skillRoot, 'SKILL.md') }]
    })

    expect((service as any).scopedCatalogs.has('writer')).toBe(false)
  })

  it('drains in-flight discovery before deleting an Agent scope', async () => {
    agents.push({ id: 'writer' })
    const writerRoot = resolveAgentSkillsRoot(skillsRoot, 'writer')
    writeSkill(writerRoot, 'writer-skill', '# writer')
    let releasePluginDiscovery!: (skills: never[]) => void
    const pluginDiscoveryStarted = new Promise<void>((resolve) => {
      vi.spyOn(service as any, 'discoverPluginSkillsOnMainThread').mockImplementation(() => {
        resolve()
        return new Promise<never[]>((release) => {
          releasePluginDiscovery = release
        })
      })
    })

    const discovery = service.discoverSkills('writer')
    await pluginDiscoveryStarted
    const cleanup = service.cleanupAgentSkills('writer')
    await Promise.resolve()

    expect(fs.existsSync(writerRoot)).toBe(true)
    releasePluginDiscovery([])
    await expect(discovery).rejects.toThrow('being deleted')
    await cleanup

    expect(fs.existsSync(writerRoot)).toBe(false)
    expect((service as any).scopedCatalogs.has('writer')).toBe(false)
  })

  it('drains an in-flight install before removing its files and state', async () => {
    agents.push({ id: 'writer' })
    const writerRoot = resolveAgentSkillsRoot(skillsRoot, 'writer')
    const sourceRoot = writeSkill(path.join(temporaryRoot, 'source'), 'review', '# review')
    const parseSkillMetadata = (service as any).parseSkillMetadata.bind(service)
    let releaseMetadata!: () => void
    const metadataBlocked = new Promise<void>((resolve) => {
      vi.spyOn(service as any, 'parseSkillMetadata').mockImplementation(
        async (...args: unknown[]) => {
          resolve()
          await new Promise<void>((release) => {
            releaseMetadata = release
          })
          return await parseSkillMetadata(...args)
        }
      )
    })

    const install = service.installFromFolderForAgent('writer', sourceRoot)
    await metadataBlocked
    const cleanup = service.cleanupAgentSkills('writer')
    await Promise.resolve()

    expect(fs.existsSync(path.join(writerRoot, 'review'))).toBe(true)
    releaseMetadata()
    await expect(install).resolves.toMatchObject({ success: true, skillName: 'review' })
    await cleanup

    expect(fs.existsSync(writerRoot)).toBe(false)
    expect(settingsState?.agents.writer).toBeUndefined()
    expect((service as any).scopedCatalogs.has('writer')).toBe(false)
  })

  it('rejects an operation whose Agent validation finishes during shutdown', async () => {
    agents.push({ id: 'writer' })
    let releaseAgentValidation!: () => void
    let signalAgentValidationStarted!: () => void
    const agentValidationStarted = new Promise<void>((resolve) => {
      signalAgentValidationStarted = resolve
    })
    ;(service as any).agentScopePort.isDeepChatAgent = vi.fn(async () => {
      signalAgentValidationStarted()
      await new Promise<void>((resolve) => {
        releaseAgentValidation = resolve
      })
      return true
    })
    let releaseStopWatching!: () => void
    const stopWatchingStarted = new Promise<void>((resolve) => {
      vi.spyOn(service, 'stopWatching')
        .mockImplementationOnce(async () => {
          resolve()
          await new Promise<void>((release) => {
            releaseStopWatching = release
          })
        })
        .mockResolvedValue(undefined)
    })

    const openFolder = service.openSkillsFolderForAgent('writer')
    await agentValidationStarted
    const destruction = service.destroy()
    await stopWatchingStarted
    releaseAgentValidation()

    await expect(openFolder).rejects.toThrow('shutting down')
    expect(fs.existsSync(resolveAgentSkillsRoot(skillsRoot, 'writer'))).toBe(false)
    releaseStopWatching()
    await destruction
  })

  it('records snapshot provenance and applies the requested import name', async () => {
    agents.push({ id: 'writer' }, { id: 'source' })
    const sourceRoot = writeSkill(path.join(temporaryRoot, 'source'), 'review', '# imported')

    await expect(
      service.installImportedSkillForAgent(
        'writer',
        sourceRoot,
        { importedFrom: 'agent:source/review', sourceAgentId: 'source' },
        { targetName: 'review-copy' }
      )
    ).resolves.toMatchObject({ success: true, skillName: 'review-copy' })

    const writerRoot = resolveAgentSkillsRoot(skillsRoot, 'writer')
    expect(fs.existsSync(path.join(writerRoot, 'review-copy', 'SKILL.md'))).toBe(true)
    expect(settingsState?.agents.writer.skills['review-copy'].source).toMatchObject({
      type: 'imported',
      agentId: 'source',
      importedFrom: 'agent:source/review',
      importedAt: expect.any(String)
    })
  })

  it('rejects scoped content mutation for Plugin-owned and out-of-root Skills', async () => {
    agents.push({ id: 'writer' })
    const externalRoot = writeSkill(path.join(temporaryRoot, 'external'), 'external-skill', '# old')
    const catalog = (service as any).getScopedCatalog('writer')
    catalog.discovered = true
    catalog.metadataCache.set('external-skill', {
      name: 'external-skill',
      description: 'external',
      path: path.join(externalRoot, 'SKILL.md'),
      skillRoot: externalRoot,
      ownerPluginId: 'plugin-owner'
    })

    await expect(
      service.updateSkillFileForAgent('writer', 'external-skill', '# changed')
    ).resolves.toMatchObject({ success: false, error: expect.stringContaining('Plugin-owned') })
    expect(fs.readFileSync(path.join(externalRoot, 'SKILL.md'), 'utf-8')).toContain('# old')

    catalog.metadataCache.set('external-skill', {
      name: 'external-skill',
      description: 'external',
      path: path.join(externalRoot, 'SKILL.md'),
      skillRoot: externalRoot
    })
    await expect(
      service.updateSkillFileForAgent('writer', 'external-skill', '# changed')
    ).resolves.toMatchObject({ success: false, error: expect.stringContaining('outside') })
    expect(fs.readFileSync(path.join(externalRoot, 'SKILL.md'), 'utf-8')).toContain('# old')
  })
})
