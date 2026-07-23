import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Agent } from '@shared/types/agent-interface'
import type { SkillInstallOptions } from '@shared/types/skill'
import type { UnifiedSkillItem } from '@shared/types/skillManagement'
import type { CanonicalSkill, ScanResult } from '@shared/types/skillSync'
import {
  AgentSkillImportService,
  type AgentSkillImportServiceDependencies
} from '@/skill/agentSkillImportService'

const electronState = vi.hoisted(() => ({ tempPath: '/tmp' }))

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs')
  return { ...actual, default: actual }
})

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => electronState.tempPath)
  }
}))

const createAgent = (id: string, enabled = true): Agent =>
  ({ id, name: id, type: 'deepchat', source: 'manual', enabled }) as Agent

const createCatalogItem = (
  name: string,
  skillRoot: string,
  overrides: Partial<UnifiedSkillItem> = {}
): UnifiedSkillItem =>
  ({
    name,
    description: `${name} description`,
    path: path.join(skillRoot, 'SKILL.md'),
    skillRoot,
    agentId: 'source',
    canonicalPath: skillRoot,
    sourceType: 'created',
    disabled: false,
    deepchatDisabled: false,
    agentLinks: {},
    mutable: true,
    ...overrides
  }) as UnifiedSkillItem

const createExternalScan = (skills: ScanResult['skills']): ScanResult => ({
  toolId: 'codex',
  toolName: 'Codex',
  available: true,
  skillsDir: '/external/skills',
  skills
})

describe('AgentSkillImportService', () => {
  let tempRoot: string
  let sourceRoot: string
  let targetRoot: string
  let agents: Agent[]
  let catalogs: Map<string, UnifiedSkillItem[]>
  let scans: ScanResult[]
  let externalPreviews: Array<{ skill: CanonicalSkill; warnings: string[] }>
  let installImportedSkillForAgent: ReturnType<typeof vi.fn>
  let refreshAgentCatalog: ReturnType<typeof vi.fn>
  let dependencies: AgentSkillImportServiceDependencies
  let service: AgentSkillImportService

  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'deepchat-agent-import-test-'))
    electronState.tempPath = tempRoot
    sourceRoot = path.join(tempRoot, 'source')
    targetRoot = path.join(tempRoot, 'target')
    await Promise.all([
      mkdir(sourceRoot, { recursive: true }),
      mkdir(targetRoot, { recursive: true })
    ])

    agents = [createAgent('source'), createAgent('target')]
    catalogs = new Map([
      ['source', []],
      ['target', []]
    ])
    scans = []
    externalPreviews = []
    installImportedSkillForAgent = vi
      .fn()
      .mockResolvedValue({ success: true, skillName: 'installed-skill' })
    refreshAgentCatalog = vi.fn().mockResolvedValue([])
    dependencies = {
      agents: {
        listAgents: vi.fn(async () => agents),
        getAgent: vi.fn(async (agentId) => agents.find((agent) => agent.id === agentId) ?? null)
      },
      skills: {
        getSkillsDir: vi.fn(async (agentId) => (agentId === 'source' ? sourceRoot : targetRoot)),
        getUnifiedSkillCatalog: vi.fn(async (agentId) => catalogs.get(agentId) ?? []),
        installImportedSkillForAgent,
        refreshAgentCatalog
      },
      external: {
        scanExternalTools: vi.fn(async () => scans),
        previewImport: vi.fn(async () => externalPreviews)
      }
    }
    service = new AgentSkillImportService(dependencies)
  })

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true })
  })

  it('lists peer Agents and excludes plugin-owned Skills from the source count', async () => {
    const internalRoot = path.join(sourceRoot, 'owned')
    agents.push(createAgent('disabled-source', false))
    catalogs.set('disabled-source', [])
    catalogs.set('source', [
      createCatalogItem('owned', internalRoot),
      createCatalogItem('plugin-skill', '/plugin/skill', { ownerPluginId: 'plugin-a' })
    ])
    scans = [
      createExternalScan([
        {
          name: 'external-skill',
          path: '/external/skills/external-skill',
          format: 'codex',
          lastModified: new Date()
        }
      ])
    ]

    await expect(service.listSources('target')).resolves.toEqual([
      expect.objectContaining({ id: 'internal:disabled-source', skillCount: 0 }),
      expect.objectContaining({ id: 'internal:source', skillCount: 1 }),
      expect.objectContaining({ id: 'external:codex', skillCount: 1 })
    ])
  })

  it('rejects duplicate selections instead of silently choosing one strategy', async () => {
    await expect(
      service.execute({
        targetAgentId: 'target',
        source: { kind: 'internal', agentId: 'source' },
        items: [
          { skillName: 'same-skill', strategy: 'skip' },
          { skillName: ' same-skill ', strategy: 'overwrite' }
        ]
      })
    ).rejects.toThrow('Duplicate Skill selection')
    expect(dependencies.skills.installImportedSkillForAgent).not.toHaveBeenCalled()
  })

  it('materializes external references and scripts before installing the snapshot', async () => {
    const canonicalSkill: CanonicalSkill = {
      name: 'external-skill',
      description: 'External skill',
      instructions: '# Instructions',
      references: [
        { name: 'guide.md', relativePath: 'references/nested/guide.md', content: '# Guide' }
      ],
      scripts: [{ name: 'run.sh', relativePath: 'scripts/run.sh', content: 'echo ok' }]
    }
    scans = [
      createExternalScan([
        {
          name: canonicalSkill.name,
          description: canonicalSkill.description,
          path: '/external/skills/external-skill',
          format: 'codex',
          lastModified: new Date()
        }
      ])
    ]
    externalPreviews = [{ skill: canonicalSkill, warnings: [] }]
    installImportedSkillForAgent.mockImplementation(
      async (
        _agentId: string,
        folderPath: string,
        provenance: { importedFrom: string; sourceAgentId?: string },
        options?: SkillInstallOptions
      ) => {
        expect(provenance).toEqual({ importedFrom: 'external:codex/external-skill' })
        expect(options).toEqual({ overwrite: false, targetName: 'external-skill' })
        await expect(
          readFile(path.join(folderPath, 'references/nested/guide.md'), 'utf-8')
        ).resolves.toBe('# Guide')
        await expect(readFile(path.join(folderPath, 'scripts/run.sh'), 'utf-8')).resolves.toBe(
          'echo ok'
        )
        return { success: true, skillName: canonicalSkill.name }
      }
    )

    await expect(
      service.execute({
        targetAgentId: 'target',
        source: { kind: 'external', toolId: 'codex' },
        items: [{ skillName: canonicalSkill.name, strategy: 'skip' }]
      })
    ).resolves.toEqual({
      success: true,
      imported: ['external-skill'],
      skipped: [],
      failed: []
    })
    expect(refreshAgentCatalog).toHaveBeenCalledWith('target')
  })

  it('rejects canonical files outside their declared top-level folder', async () => {
    const canonicalSkill: CanonicalSkill = {
      name: 'external-skill',
      description: 'External skill',
      instructions: '# Instructions',
      references: [{ name: 'escape.md', relativePath: 'scripts/escape.md', content: 'nope' }]
    }
    scans = [
      createExternalScan([
        {
          name: canonicalSkill.name,
          path: '/external/skills/external-skill',
          format: 'codex',
          lastModified: new Date()
        }
      ])
    ]
    externalPreviews = [{ skill: canonicalSkill, warnings: [] }]

    const result = await service.execute({
      targetAgentId: 'target',
      source: { kind: 'external', toolId: 'codex' },
      items: [{ skillName: canonicalSkill.name, strategy: 'skip' }]
    })

    expect(result.success).toBe(false)
    expect(result.failed).toEqual([
      expect.objectContaining({
        skillName: canonicalSkill.name,
        reason: expect.stringContaining('Unsafe')
      })
    ])
    expect(installImportedSkillForAgent).not.toHaveBeenCalled()
  })

  it('re-resolves target conflicts at execution time', async () => {
    const skillRoot = path.join(sourceRoot, 'shared-skill')
    await mkdir(skillRoot, { recursive: true })
    await writeFile(
      path.join(skillRoot, 'SKILL.md'),
      '---\nname: shared-skill\ndescription: Shared\n---\n',
      'utf-8'
    )
    catalogs.set('source', [createCatalogItem('shared-skill', skillRoot)])

    await expect(
      service.preview({
        targetAgentId: 'target',
        source: { kind: 'internal', agentId: 'source' }
      })
    ).resolves.toMatchObject({ items: [{ name: 'shared-skill', status: 'ready' }] })

    catalogs.set('target', [
      createCatalogItem('shared-skill', path.join(targetRoot, 'shared-skill'))
    ])
    await expect(
      service.execute({
        targetAgentId: 'target',
        source: { kind: 'internal', agentId: 'source' },
        items: [{ skillName: 'shared-skill', strategy: 'skip' }]
      })
    ).resolves.toEqual({ success: true, imported: [], skipped: ['shared-skill'], failed: [] })
    expect(installImportedSkillForAgent).not.toHaveBeenCalled()
  })

  it('marks symlinked internal Skill roots unavailable', async () => {
    const outsideRoot = path.join(tempRoot, 'outside-skill')
    const linkedRoot = path.join(sourceRoot, 'linked-skill')
    await mkdir(outsideRoot, { recursive: true })
    await writeFile(
      path.join(outsideRoot, 'SKILL.md'),
      '---\nname: linked-skill\ndescription: Linked\n---\n',
      'utf-8'
    )
    await symlink(outsideRoot, linkedRoot)
    catalogs.set('source', [createCatalogItem('linked-skill', linkedRoot)])

    await expect(
      service.preview({
        targetAgentId: 'target',
        source: { kind: 'internal', agentId: 'source' }
      })
    ).resolves.toMatchObject({
      items: [{ name: 'linked-skill', status: 'unavailable' }]
    })
  })

  it('reports per-Skill failures and refreshes after partial success', async () => {
    const firstRoot = path.join(sourceRoot, 'first-skill')
    const secondRoot = path.join(sourceRoot, 'second-skill')
    await Promise.all([mkdir(firstRoot), mkdir(secondRoot)])
    await Promise.all([
      writeFile(
        path.join(firstRoot, 'SKILL.md'),
        '---\nname: first-skill\ndescription: First\n---\n',
        'utf-8'
      ),
      writeFile(
        path.join(secondRoot, 'SKILL.md'),
        '---\nname: second-skill\ndescription: Second\n---\n',
        'utf-8'
      )
    ])
    catalogs.set('source', [
      createCatalogItem('first-skill', firstRoot),
      createCatalogItem('second-skill', secondRoot)
    ])
    installImportedSkillForAgent.mockImplementation(
      async (_agentId, _folderPath, _provenance, options) =>
        options?.targetName === 'first-skill'
          ? { success: true, skillName: 'first-skill' }
          : { success: false, error: 'disk full' }
    )

    const result = await service.execute({
      targetAgentId: 'target',
      source: { kind: 'internal', agentId: 'source' },
      items: [
        { skillName: 'first-skill', strategy: 'skip' },
        { skillName: 'second-skill', strategy: 'skip' }
      ]
    })

    expect(result).toEqual({
      success: false,
      imported: ['first-skill'],
      skipped: [],
      failed: [{ skillName: 'second-skill', reason: 'disk full' }]
    })
    expect(refreshAgentCatalog).toHaveBeenCalledWith('target')
  })
})
