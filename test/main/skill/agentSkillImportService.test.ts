import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SKILL_NAME_MAX_LENGTH, type SkillInstallOptions } from '@shared/types/skill'
import type { UnifiedSkillItem } from '@shared/types/skillManagement'
import type { CanonicalSkill, ScanResult } from '@shared/types/skillSync'
import {
  AgentSkillImportService,
  type AgentSkillImportServiceDependencies
} from '@/skill/agentSkillImportService'
import { formatConverter } from '@/skill/sync/formatConverter'

vi.unmock('fs')
vi.unmock('node:fs')
vi.unmock('fs/promises')
vi.unmock('node:fs/promises')

const electronState = vi.hoisted(() => ({ tempPath: '/tmp' }))

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => electronState.tempPath)
  }
}))

const createExternalScan = (skills: ScanResult['skills']): ScanResult => ({
  toolId: 'codex',
  toolName: 'Codex',
  available: true,
  skillsDir: '/external/skills',
  skills
})

const createCanonicalSkill = (name: string, instructions = '# Instructions'): CanonicalSkill => ({
  name,
  description: `${name} description`,
  instructions
})

describe('AgentSkillImportService', () => {
  let tempRoot: string
  let allSkills: UnifiedSkillItem[]
  let scans: ScanResult[]
  let externalPreviews: Array<{ skill: CanonicalSkill; warnings: string[] }>
  let installImportedSkill: ReturnType<typeof vi.fn>
  let dependencies: AgentSkillImportServiceDependencies
  let service: AgentSkillImportService

  const addGlobalSkill = async (
    skill: CanonicalSkill,
    assignedAgentIds: string[] = [],
    instructions = skill.instructions
  ) => {
    const skillRoot = path.join(tempRoot, 'allSkills', skill.name)
    await mkdir(skillRoot, { recursive: true })
    await writeFile(
      path.join(skillRoot, 'SKILL.md'),
      formatConverter.serializeToSkillMd({ ...skill, instructions }),
      'utf-8'
    )
    allSkills.push({
      name: skill.name,
      description: skill.description,
      path: path.join(skillRoot, 'SKILL.md'),
      skillRoot,
      canonicalPath: skillRoot,
      sourceType: 'created',
      disabled: false,
      deepchatDisabled: false,
      agentLinks: {},
      mutable: true,
      assigned: assignedAgentIds.length > 0,
      assignedAgentIds
    })
  }

  const useExternalSkills = (skills: CanonicalSkill[]) => {
    scans = [
      createExternalScan(
        skills.map((skill) => ({
          name: skill.name,
          description: skill.description,
          path: `/external/skills/${skill.name}`,
          format: 'codex',
          lastModified: new Date()
        }))
      )
    ]
    externalPreviews = skills.map((skill) => ({ skill, warnings: [] }))
  }

  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'deepchat-agent-import-test-'))
    electronState.tempPath = tempRoot
    await mkdir(path.join(tempRoot, 'allSkills'), { recursive: true })
    allSkills = []
    scans = []
    externalPreviews = []
    installImportedSkill = vi
      .fn()
      .mockResolvedValue({ success: true, skillName: 'installed-skill' })
    dependencies = {
      skills: {
        getAllSkills: vi.fn(async () => allSkills),
        installImportedSkill
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

  it('lists only external Agent sources', async () => {
    scans = [
      createExternalScan([
        {
          name: 'external-skill',
          path: '/external/skills/external-skill',
          format: 'codex',
          lastModified: new Date()
        }
      ]),
      {
        toolId: 'cursor',
        toolName: 'Cursor',
        available: false,
        skillsDir: '/external/cursor',
        skills: []
      }
    ]

    await expect(service.listSources()).resolves.toEqual([
      {
        id: 'external:codex',
        source: { kind: 'external', toolId: 'codex' },
        name: 'Codex',
        available: true,
        skillCount: 1
      },
      {
        id: 'external:cursor',
        source: { kind: 'external', toolId: 'cursor' },
        name: 'Cursor',
        available: false,
        skillCount: 0
      }
    ])
  })

  it('previews identical packages as reusable and reports shared overwrite impact', async () => {
    const sameSkill = createCanonicalSkill('same-skill')
    const conflictSkill = createCanonicalSkill('conflict-skill')
    await addGlobalSkill(sameSkill, ['target-a'])
    await addGlobalSkill(conflictSkill, ['target-a', 'target-b'], '# Existing content')
    useExternalSkills([sameSkill, conflictSkill])

    await expect(
      service.preview({
        source: { kind: 'external', toolId: 'codex' }
      })
    ).resolves.toEqual({
      source: { kind: 'external', toolId: 'codex' },
      items: [
        {
          name: 'conflict-skill',
          description: 'conflict-skill description',
          status: 'conflict',
          suggestedTargetName: 'conflict-skill-copy',
          affectedAgentIds: ['target-a', 'target-b'],
          warning: undefined
        },
        {
          name: 'same-skill',
          description: 'same-skill description',
          status: 'same',
          suggestedTargetName: undefined,
          affectedAgentIds: undefined,
          warning: undefined
        }
      ]
    })
  })

  it('reserves incoming names when suggesting conflict renames', async () => {
    const conflictSkill = createCanonicalSkill('review')
    const incomingCopy = createCanonicalSkill('review-copy')
    await addGlobalSkill(conflictSkill, [], '# Existing content')
    useExternalSkills([conflictSkill, incomingCopy])

    const preview = await service.preview({
      source: { kind: 'external', toolId: 'codex' }
    })

    expect(preview.items).toEqual([
      expect.objectContaining({
        name: 'review',
        status: 'conflict',
        suggestedTargetName: 'review-copy-2'
      }),
      expect.objectContaining({ name: 'review-copy', status: 'ready' })
    ])
  })

  it('keeps suggested global names within the shared Skill name limit', async () => {
    const name = `a${'b'.repeat(SKILL_NAME_MAX_LENGTH - 1)}`
    const conflictSkill = createCanonicalSkill(name)
    await addGlobalSkill(conflictSkill, [], '# Existing content')
    useExternalSkills([conflictSkill])

    const preview = await service.preview({
      source: { kind: 'external', toolId: 'codex' }
    })

    expect(preview.items[0].suggestedTargetName).toBe(
      `${name.slice(0, SKILL_NAME_MAX_LENGTH - '-copy'.length)}-copy`
    )
    expect(preview.items[0].suggestedTargetName).toHaveLength(SKILL_NAME_MAX_LENGTH)
  })

  it('rejects selections beyond the shared Skill name limit', async () => {
    const name = `a${'b'.repeat(SKILL_NAME_MAX_LENGTH)}`

    await expect(
      service.execute({
        source: { kind: 'external', toolId: 'codex' },
        items: [{ skillName: name, strategy: 'skip' }]
      })
    ).rejects.toThrow('Invalid Skill name in import request')
    expect(installImportedSkill).not.toHaveBeenCalled()
  })

  it('materializes an external snapshot without enabling it for an Agent', async () => {
    const skill: CanonicalSkill = {
      ...createCanonicalSkill('external-skill'),
      references: [
        { name: 'guide.md', relativePath: 'references/nested/guide.md', content: '# Guide' }
      ],
      scripts: [{ name: 'run.sh', relativePath: 'scripts/run.sh', content: 'echo ok' }]
    }
    useExternalSkills([skill])
    installImportedSkill.mockImplementation(
      async (
        agentIds: string[],
        folderPath: string,
        provenance: { importedFrom: string },
        options?: SkillInstallOptions
      ) => {
        expect(agentIds).toEqual([])
        expect(provenance).toEqual({ importedFrom: 'external:codex/external-skill' })
        expect(options).toEqual({
          overwrite: false,
          acknowledgedAgentIds: undefined,
          targetName: 'external-skill'
        })
        await expect(
          readFile(path.join(folderPath, 'references/nested/guide.md'), 'utf-8')
        ).resolves.toBe('# Guide')
        await expect(readFile(path.join(folderPath, 'scripts/run.sh'), 'utf-8')).resolves.toBe(
          'echo ok'
        )
        return { success: true, skillName: 'external-skill' }
      }
    )

    await expect(
      service.execute({
        source: { kind: 'external', toolId: 'codex' },
        items: [{ skillName: 'external-skill', strategy: 'skip' }]
      })
    ).resolves.toEqual({
      success: true,
      imported: ['external-skill'],
      reused: [],
      skipped: [],
      failed: []
    })
  })

  it('reuses identical content without changing enabled Agents', async () => {
    const skill = createCanonicalSkill('shared-skill')
    await addGlobalSkill(skill, ['target-a'])
    useExternalSkills([skill])

    await expect(
      service.execute({
        source: { kind: 'external', toolId: 'codex' },
        items: [{ skillName: 'shared-skill', strategy: 'skip' }]
      })
    ).resolves.toEqual({
      success: true,
      imported: [],
      reused: ['shared-skill'],
      skipped: [],
      failed: []
    })
    expect(installImportedSkill).not.toHaveBeenCalled()
  })

  it('rejects stale overwrite impact and unsafe canonical paths', async () => {
    const conflictSkill = createCanonicalSkill('conflict-skill')
    const unsafeSkill: CanonicalSkill = {
      ...createCanonicalSkill('unsafe-skill'),
      references: [{ name: 'escape.md', relativePath: 'scripts/escape.md', content: 'nope' }]
    }
    await addGlobalSkill(conflictSkill, ['target-a'], '# Existing content')
    useExternalSkills([conflictSkill, unsafeSkill])

    const result = await service.execute({
      source: { kind: 'external', toolId: 'codex' },
      items: [
        { skillName: 'conflict-skill', strategy: 'overwrite', acknowledgedAgentIds: [] },
        { skillName: 'unsafe-skill', strategy: 'skip' }
      ]
    })

    expect(result).toEqual({
      success: false,
      imported: [],
      reused: [],
      skipped: [],
      failed: [
        {
          skillName: 'conflict-skill',
          reason: 'Enabled Agent impact changed; preview the import again.'
        },
        {
          skillName: 'unsafe-skill',
          reason: 'Unsafe imported Skill path: scripts/escape.md'
        }
      ]
    })
    expect(installImportedSkill).not.toHaveBeenCalled()
  })
})
