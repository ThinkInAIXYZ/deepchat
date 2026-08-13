import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { app } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SkillService, type SkillAgentScopePort } from '@/skill'
import type { SkillSettingsPort } from '@/skill/settings'
import type { IFileWatcherService } from '@/platform/fileWatcher'
import type { SkillExtensionConfig } from '@shared/types/skill'
import type {
  LegacySkillManagementStateV2,
  SkillManagementItem,
  SkillManagementState,
  StoredSkillManagementState
} from '@shared/types/skillManagement'
import { resolveAgentSkillsRoot } from '@/skill/agentSkillRoots'

vi.unmock('fs')
vi.unmock('node:fs')
vi.unmock('path')
vi.unmock('node:path')

const defaultExtension = (): SkillExtensionConfig => ({
  version: 1,
  env: {},
  runtimePolicy: { python: 'auto', node: 'auto' },
  scriptOverrides: {}
})

describe('SkillService shared Skills', () => {
  let temporaryRoot: string
  let skillsRoot: string
  let storedState: StoredSkillManagementState | null
  let agents: Array<{ id: string; enabledSkillNames?: string[] | null; protected?: boolean }>
  let sessions: Array<{ id: string; agentId: string }>
  let activeSkills: Map<string, string[]>
  let stateWriteFailuresRemaining: number
  let service: SkillService
  let getPathSpy: ReturnType<typeof vi.spyOn>
  let getAppPathSpy: ReturnType<typeof vi.spyOn>

  const watcherService = {
    watch: vi.fn(async () => ({ close: vi.fn(async () => undefined) })),
    destroy: vi.fn(async () => undefined)
  } as unknown as IFileWatcherService

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

  const managementItem = (
    root: string,
    name: string,
    extension: SkillExtensionConfig = defaultExtension(),
    disabled = false
  ): SkillManagementItem => ({
    name,
    canonicalPath: path.join(root, name),
    disabled,
    extension,
    source: { type: 'created' }
  })

  const createService = (): SkillService => {
    const settings = {
      getPath: () => skillsRoot,
      getManagementState: () => storedState,
      setManagementState: (state: SkillManagementState) => {
        if (stateWriteFailuresRemaining > 0) {
          stateWriteFailuresRemaining -= 1
          throw new Error('Simulated settings write failure')
        }
        storedState = structuredClone(state)
      }
    } as unknown as SkillSettingsPort
    const sessionState = {
      hasNewSession: vi.fn(async () => true),
      getPersistedNewSessionSkills: vi.fn(
        (conversationId: string) => activeSkills.get(conversationId) ?? []
      ),
      setPersistedNewSessionSkills: vi.fn((conversationId: string, names: string[]) => {
        activeSkills.set(conversationId, [...names])
      }),
      repairImportedLegacySessionSkills: vi.fn(async () => [])
    }
    const agentScope: SkillAgentScopePort = {
      isDeepChatAgent: async (agentId) => agents.some((agent) => agent.id === agentId),
      listDeepChatAgents: async () => structuredClone(agents),
      getSessionAgentId: async (sessionId) =>
        sessions.find((session) => session.id === sessionId)?.agentId ?? null,
      listSessions: async () => structuredClone(sessions)
    }
    return new SkillService(settings, sessionState, watcherService, vi.fn(), agentScope)
  }

  const migrate = async () => {
    await service.initialize()
  }

  beforeEach(() => {
    temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'deepchat-shared-skills-'))
    skillsRoot = path.join(temporaryRoot, 'skills')
    fs.mkdirSync(skillsRoot, { recursive: true })
    storedState = null
    agents = [{ id: 'deepchat', protected: true }, { id: 'writer' }, { id: 'coder' }]
    sessions = []
    activeSkills = new Map()
    stateWriteFailuresRemaining = 0
    getPathSpy = vi.spyOn(app, 'getPath').mockImplementation((name: string) => {
      if (name === 'home') return temporaryRoot
      if (name === 'temp') return path.join(temporaryRoot, 'temp')
      return temporaryRoot
    })
    getAppPathSpy = vi.spyOn(app, 'getAppPath').mockReturnValue(temporaryRoot)
    service = createService()
  })

  afterEach(async () => {
    await service.destroy()
    getPathSpy.mockRestore()
    getAppPathSpy.mockRestore()
    fs.rmSync(temporaryRoot, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  it('deduplicates equal private packages and renames different variants during v2 migration', async () => {
    const globalRoot = writeSkill(skillsRoot, 'review', '# shared')
    const writerRoot = resolveAgentSkillsRoot(skillsRoot, 'writer')
    const coderRoot = resolveAgentSkillsRoot(skillsRoot, 'coder')
    writeSkill(writerRoot, 'review', '# shared')
    writeSkill(coderRoot, 'review', '# coder')
    const writerExtension = { ...defaultExtension(), env: { WRITER_TOKEN: 'writer' } }
    const coderExtension = { ...defaultExtension(), env: { CODER_TOKEN: 'coder' } }
    storedState = {
      version: 2,
      agents: {
        deepchat: { skills: { review: managementItem(skillsRoot, 'review') } },
        writer: { skills: { review: managementItem(writerRoot, 'review', writerExtension) } },
        coder: { skills: { review: managementItem(coderRoot, 'review', coderExtension) } }
      }
    } satisfies LegacySkillManagementStateV2
    sessions = [
      { id: 'writer-session', agentId: 'writer' },
      { id: 'coder-session', agentId: 'coder' }
    ]
    activeSkills.set('writer-session', ['review'])
    activeSkills.set('coder-session', ['review'])

    const renameSpy = vi.spyOn(fs, 'renameSync')
    await migrate()

    const journalPath = path.join(skillsRoot, '.library-migration-v3', 'journal.json')
    const journalRename = renameSpy.mock.calls.find(([, target]) => target === journalPath)
    expect(journalRename?.[0]).toMatch(/\.journal\.json\..+\.tmp$/)

    expect(storedState?.version).toBe(3)
    const state = storedState as SkillManagementState
    const coderName = state.migration?.agentSkillNames.coder.review
    expect(coderName).toMatch(/^review-coder(?:-\d+)?$/)
    expect(state.migration?.agentSkillNames.writer.review).toBe('review')
    expect(state.skills.review.canonicalPath).toBe(globalRoot)
    expect(state.skills[coderName!].canonicalPath).toBe(path.join(skillsRoot, coderName!))
    expect(fs.readFileSync(path.join(skillsRoot, coderName!, 'SKILL.md'), 'utf-8')).toContain(
      '# coder'
    )
    expect(state.agents.writer.bindings.review.extension.env).toEqual({ WRITER_TOKEN: 'writer' })
    expect(state.agents.coder.bindings[coderName!].extension.env).toEqual({ CODER_TOKEN: 'coder' })
    expect(activeSkills.get('writer-session')).toEqual(['review'])
    expect(activeSkills.get('coder-session')).toEqual([coderName])
    expect(fs.existsSync(writerRoot)).toBe(true)
    expect(fs.existsSync(coderRoot)).toBe(true)

    await service.destroy()
    ;(storedState as SkillManagementState).migration!.status = 'committing'
    activeSkills.set('coder-session', ['review'])
    service = createService()
    await migrate()
    expect(Object.keys((storedState as SkillManagementState).skills).sort()).toEqual(
      [coderName!, 'review'].sort()
    )
    expect(activeSkills.get('coder-session')).toEqual([coderName])

    await service.setSkillAssignment('coder', 'review', true)
    activeSkills.set('coder-session', ['review'])
    await service.destroy()
    service = createService()
    await migrate()
    expect(activeSkills.get('coder-session')).toEqual(['review'])
  })

  it('installs packaged Skills without replacing legacy state before migration', async () => {
    const packagedRoot = path.join(temporaryRoot, 'resources', 'skills')
    writeSkill(packagedRoot, 'new-builtin', '# packaged')
    storedState = {
      version: 2,
      agents: {
        deepchat: { skills: {} },
        writer: { skills: {} }
      }
    } satisfies LegacySkillManagementStateV2
    await service.installBuiltinSkills()

    expect(storedState?.version).toBe(2)
    expect(fs.existsSync(path.join(skillsRoot, 'new-builtin', 'SKILL.md'))).toBe(true)

    await migrate()
    expect(
      (storedState as SkillManagementState).agents.deepchat.bindings['new-builtin'].assigned
    ).toBe(true)
  })

  it('decodes the former version 3 library field and writes the skills field', async () => {
    const reviewRoot = writeSkill(skillsRoot, 'review', '# shared')
    storedState = {
      version: 3,
      library: {
        review: {
          name: 'review',
          canonicalPath: reviewRoot,
          source: { type: 'created' }
        }
      },
      agents: {
        deepchat: { bindings: {} },
        writer: { bindings: {} }
      }
    } as unknown as StoredSkillManagementState

    await service.discoverSkills('deepchat')
    expect((await service.getSkillManagementState()).skills.review.canonicalPath).toBe(reviewRoot)

    await service.setSkillAssignment('writer', 'review', true)
    expect(storedState).toMatchObject({
      version: 3,
      skills: { review: { canonicalPath: reviewRoot } },
      agents: { writer: { bindings: { review: { assigned: true } } } }
    })
    expect(Object.hasOwn(storedState as object, 'library')).toBe(false)
  })

  it('removes ACP and orphaned bindings from version 3 state', async () => {
    const reviewRoot = writeSkill(skillsRoot, 'review', '# shared')
    const binding = { assigned: true, extension: defaultExtension() }
    storedState = {
      version: 3,
      skills: {
        review: {
          name: 'review',
          canonicalPath: reviewRoot,
          source: { type: 'created' }
        }
      },
      agents: {
        deepchat: { bindings: { review: structuredClone(binding) } },
        writer: { bindings: { review: structuredClone(binding) } },
        dimcode: { bindings: { review: structuredClone(binding) } },
        'deleted-agent': { bindings: { review: structuredClone(binding) } }
      }
    }

    await migrate()

    expect(Object.keys((storedState as SkillManagementState).agents).sort()).toEqual([
      'deepchat',
      'writer'
    ])
    expect((await service.getAllSkills())[0].assignedAgentIds).toEqual(['deepchat', 'writer'])
  })

  it('honors frozen pre-scope Agent allowlists during v2 migration', async () => {
    writeSkill(skillsRoot, 'review', '# shared')
    storedState = {
      version: 2,
      agents: { deepchat: { skills: {} }, writer: { skills: {} } },
      migration: {
        targetAgentIds: ['writer'],
        completedAgentIds: [],
        legacySkillAllowLists: { writer: ['review'] }
      }
    } satisfies LegacySkillManagementStateV2

    await migrate()

    expect((storedState as SkillManagementState).agents.writer.bindings.review.assigned).toBe(true)
  })

  it('leaves ACP and orphaned Session selections outside the migration', async () => {
    writeSkill(skillsRoot, 'review', '# shared')
    storedState = {
      version: 2,
      agents: {
        deepchat: { skills: { review: managementItem(skillsRoot, 'review') } },
        writer: { skills: { review: managementItem(skillsRoot, 'review') } }
      }
    } satisfies LegacySkillManagementStateV2
    sessions = [
      { id: 'writer-session', agentId: 'writer' },
      { id: 'acp-session', agentId: 'dimcode' },
      { id: 'orphaned-session', agentId: 'deleted-agent' }
    ]
    activeSkills.set('writer-session', ['review', 'missing'])
    activeSkills.set('acp-session', ['external-skill'])
    activeSkills.set('orphaned-session', ['legacy-skill'])

    await migrate()

    expect(storedState?.version).toBe(3)
    expect(activeSkills.get('writer-session')).toEqual(['review'])
    expect(activeSkills.get('acp-session')).toEqual(['external-skill'])
    expect(activeSkills.get('orphaned-session')).toEqual(['legacy-skill'])

    await service.destroy()
    ;(storedState as SkillManagementState).migration!.status = 'committing'
    service = createService()
    await migrate()

    expect((storedState as SkillManagementState).migration?.status).toBe('completed')
    expect(activeSkills.get('acp-session')).toEqual(['external-skill'])
    expect(activeSkills.get('orphaned-session')).toEqual(['legacy-skill'])
  })

  it('resumes a journaled package rename without creating a second variant', async () => {
    writeSkill(skillsRoot, 'review', '# shared')
    const coderRoot = resolveAgentSkillsRoot(skillsRoot, 'coder')
    const privateSkillRoot = writeSkill(coderRoot, 'review', '# coder')
    storedState = {
      version: 2,
      agents: {
        deepchat: { skills: { review: managementItem(skillsRoot, 'review') } },
        coder: { skills: { review: managementItem(coderRoot, 'review') } }
      }
    } satisfies LegacySkillManagementStateV2

    const committedTarget = path.join(skillsRoot, 'review-coder')
    fs.cpSync(privateSkillRoot, committedTarget, { recursive: true })
    const committedManifestPath = path.join(committedTarget, 'SKILL.md')
    fs.writeFileSync(
      committedManifestPath,
      fs.readFileSync(committedManifestPath, 'utf-8').replace('name: review', 'name: review-coder'),
      'utf-8'
    )
    const migrationRoot = path.join(skillsRoot, '.library-migration-v3')
    fs.mkdirSync(migrationRoot, { recursive: true })
    fs.writeFileSync(
      path.join(migrationRoot, 'journal.json'),
      JSON.stringify({
        sourceVersion: 2,
        plannedCopies: [
          {
            sourcePath: privateSkillRoot,
            targetPath: committedTarget,
            targetName: 'review-coder',
            agentId: 'coder',
            originalName: 'review',
            source: { type: 'created' }
          }
        ]
      }),
      'utf-8'
    )

    await migrate()

    const state = storedState as SkillManagementState
    expect(state.migration?.agentSkillNames.coder.review).toBe('review-coder')
    expect(Object.keys(state.skills).sort()).toEqual(['review', 'review-coder'])
    expect(fs.existsSync(path.join(skillsRoot, 'review-coder-2'))).toBe(false)
    expect(fs.existsSync(migrationRoot)).toBe(false)
  })

  it('shares one package root while retaining independent Agent extension settings', async () => {
    const reviewRoot = writeSkill(skillsRoot, 'review', '# shared')
    await migrate()

    await service.setSkillAssignment('writer', 'review', true)
    await service.setSkillAssignment('coder', 'review', true)
    await service.saveSkillExtensionForAgent('writer', 'review', {
      ...defaultExtension(),
      env: { TOKEN: 'writer' }
    })

    const writerCatalog = await service.getUnifiedSkillCatalog('writer')
    const coderCatalog = await service.getUnifiedSkillCatalog('coder')
    expect(writerCatalog[0].skillRoot).toBe(reviewRoot)
    expect(coderCatalog[0].skillRoot).toBe(reviewRoot)
    expect((await service.getSkillExtensionForAgent('writer', 'review')).env).toEqual({
      TOKEN: 'writer'
    })
    expect((await service.getSkillExtensionForAgent('coder', 'review')).env).toEqual({})
  })

  it('installs an imported package and Agent bindings as one recoverable mutation', async () => {
    const reviewRoot = writeSkill(skillsRoot, 'review', '# original')
    const importRoot = path.join(temporaryRoot, 'external')
    writeSkill(importRoot, 'review', '# imported')
    await migrate()
    await service.setSkillAssignment('writer', 'review', false)
    await service.setSkillAssignment('coder', 'review', false)
    const previousState = structuredClone(storedState)

    stateWriteFailuresRemaining = 1
    const failed = await service.installImportedSkill(
      ['writer', 'coder'],
      path.join(importRoot, 'review'),
      { importedFrom: 'external:codex/review' },
      { overwrite: true, acknowledgedAgentIds: ['deepchat'] }
    )

    expect(failed).toMatchObject({ success: false, skillName: 'review' })
    expect(fs.readFileSync(path.join(reviewRoot, 'SKILL.md'), 'utf-8')).toContain('# original')
    expect(storedState).toEqual(previousState)

    await expect(
      service.installImportedSkill(
        ['writer', 'coder'],
        path.join(importRoot, 'review'),
        { importedFrom: 'external:codex/review' },
        { overwrite: true, acknowledgedAgentIds: ['deepchat'] }
      )
    ).resolves.toMatchObject({ success: true, skillName: 'review' })
    expect(fs.readFileSync(path.join(reviewRoot, 'SKILL.md'), 'utf-8')).toContain('# imported')
    expect((storedState as SkillManagementState).agents.writer.bindings.review.assigned).toBe(true)
    expect((storedState as SkillManagementState).agents.coder.bindings.review.assigned).toBe(true)
  })

  it('preserves legacy sidecar configuration for Agents that shared the v1 package', async () => {
    writeSkill(skillsRoot, 'review', '# shared')
    const extension = {
      ...defaultExtension(),
      env: { API_KEY: 'legacy-secret' },
      runtimePolicy: { python: 'builtin' as const, node: 'system' as const }
    }
    const sidecarRoot = path.join(skillsRoot, '.deepchat-meta')
    fs.mkdirSync(sidecarRoot, { recursive: true })
    fs.writeFileSync(path.join(sidecarRoot, 'review.json'), JSON.stringify(extension), 'utf-8')

    await migrate()

    expect((storedState as SkillManagementState).agents.deepchat.bindings.review.extension).toEqual(
      extension
    )
    expect((storedState as SkillManagementState).agents.writer.bindings.review).toEqual({
      assigned: true,
      extension
    })
  })

  it('keeps rendered content caches isolated by Agent extension settings', async () => {
    const reviewRoot = writeSkill(skillsRoot, 'review', '# shared')
    const scriptsRoot = path.join(reviewRoot, 'scripts')
    fs.mkdirSync(scriptsRoot, { recursive: true })
    fs.writeFileSync(path.join(scriptsRoot, 'run.sh'), '#!/bin/sh\necho ok\n', 'utf-8')
    await migrate()
    await service.setSkillAssignment('writer', 'review', true)
    await service.setSkillAssignment('coder', 'review', true)
    await service.saveSkillExtensionForAgent('writer', 'review', {
      ...defaultExtension(),
      scriptOverrides: { 'scripts/run.sh': { enabled: false } }
    })
    await service.saveSkillExtensionForAgent('coder', 'review', {
      ...defaultExtension(),
      scriptOverrides: { 'scripts/run.sh': { enabled: true } }
    })

    const writerContent = await service.loadSkillContent('writer', 'review')
    const coderContent = await service.loadSkillContent('coder', 'review')

    expect(writerContent?.content).toContain('No bundled scripts detected')
    expect(writerContent?.content).not.toContain('scripts/run.sh (shell)')
    expect(coderContent?.content).toContain('scripts/run.sh (shell)')
  })

  it('unassigns without deleting content and removes invalid Session selections', async () => {
    const reviewRoot = writeSkill(skillsRoot, 'review', '# shared')
    sessions = [{ id: 'writer-session', agentId: 'writer' }]
    activeSkills.set('writer-session', ['review'])
    await migrate()
    await service.setSkillAssignment('writer', 'review', true)

    await expect(service.uninstallSkillForAgent('writer', 'review')).resolves.toMatchObject({
      success: true,
      skillName: 'review'
    })

    expect(fs.existsSync(reviewRoot)).toBe(true)
    expect(await service.getUnifiedSkillCatalog('writer')).toEqual([])
    expect(activeSkills.get('writer-session')).toEqual([])
  })

  it('drops only deleted Agent bindings and permits the same Agent ID after recreation', async () => {
    writeSkill(skillsRoot, 'review', '# shared')
    await migrate()
    await service.setSkillAssignment('writer', 'review', true)

    await service.cleanupAgentSkills('writer')

    expect((storedState as SkillManagementState).agents.writer).toBeUndefined()
    expect(fs.existsSync(path.join(skillsRoot, 'review'))).toBe(true)

    await expect(service.setSkillAssignment('writer', 'review', true)).resolves.toBeUndefined()
    expect((storedState as SkillManagementState).agents.writer.bindings.review.assigned).toBe(true)
  })

  it('revalidates shared deletion impact', async () => {
    writeSkill(skillsRoot, 'review', '# shared')
    await migrate()
    await service.setSkillAssignment('writer', 'review', true)
    await service.setSkillAssignment('coder', 'review', true)

    await expect(service.deleteSkill('review', ['writer'])).resolves.toMatchObject({
      success: false,
      errorCode: 'stale_impact',
      affectedAgentIds: ['coder', 'deepchat', 'writer']
    })
    await expect(
      service.deleteSkill('review', ['coder', 'deepchat', 'writer'])
    ).resolves.toMatchObject({
      success: true,
      affectedAgentIds: ['coder', 'deepchat', 'writer']
    })
    expect(fs.existsSync(path.join(skillsRoot, 'review'))).toBe(false)
  })
})
