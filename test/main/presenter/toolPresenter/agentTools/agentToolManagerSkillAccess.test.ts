import { beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import { AgentToolManager } from '@/presenter/toolPresenter/agentTools/agentToolManager'

vi.mock('fs', async (importOriginal) => {
  const actual = (await importOriginal()) as typeof import('fs')
  return {
    __esModule: true,
    ...actual,
    default: actual
  }
})

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => {
      if (name === 'temp') {
        return path.join(os.tmpdir(), 'deepchat-electron-temp')
      }
      if (name === 'home') {
        return path.join(os.tmpdir(), 'deepchat-electron-home')
      }
      return os.tmpdir()
    }
  },
  nativeImage: {
    createFromPath: () => ({
      getSize: () => ({ width: 128, height: 96 })
    })
  }
}))

describe('AgentToolManager skill file access', () => {
  let workspaceDir: string
  let skillsDir: string
  let skillRoot: string
  let skillFilePath: string
  let configPresenter: any
  let filePresenter: {
    getMimeType: ReturnType<typeof vi.fn>
    prepareFileCompletely: ReturnType<typeof vi.fn>
  }
  let resolveConversationWorkdir: ReturnType<typeof vi.fn>
  let skillPresenter: {
    getActiveSkills: ReturnType<typeof vi.fn>
    getMetadataList: ReturnType<typeof vi.fn>
    getActiveSkillsAllowedTools: ReturnType<typeof vi.fn>
    listSkillScripts: ReturnType<typeof vi.fn>
    getSkillExtension: ReturnType<typeof vi.fn>
  }

  const buildManager = () =>
    new AgentToolManager({
      agentWorkspacePath: workspaceDir,
      configPresenter,
      runtimePort: {
        resolveConversationWorkdir,
        resolveConversationSessionInfo: vi.fn().mockResolvedValue(null),
        getSkillPresenter: () => skillPresenter as any,
        getYoBrowserToolHandler: () => ({
          getToolDefinitions: vi.fn().mockReturnValue([]),
          callTool: vi.fn()
        }),
        getFilePresenter: () => filePresenter,
        getLlmProviderPresenter: () => ({
          generateCompletionStandalone: vi.fn()
        }),
        createSettingsWindow: vi.fn(),
        sendToWindow: vi.fn().mockReturnValue(true),
        getApprovedFilePaths: vi.fn().mockReturnValue([]),
        consumeSettingsApproval: vi.fn().mockReturnValue(false)
      }
    })

  beforeEach(async () => {
    vi.clearAllMocks()

    workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), 'deepchat-skill-workspace-'))
    skillsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'deepchat-custom-skills-'))
    skillRoot = path.join(skillsDir, 'skill-a')
    skillFilePath = path.join(skillRoot, 'guide.md')

    await fs.mkdir(skillRoot, { recursive: true })
    await fs.writeFile(skillFilePath, 'active skill file', 'utf-8')

    filePresenter = {
      getMimeType: vi.fn().mockResolvedValue('text/plain'),
      prepareFileCompletely: vi.fn()
    }
    resolveConversationWorkdir = vi.fn().mockResolvedValue(null)
    skillPresenter = {
      getActiveSkills: vi.fn().mockResolvedValue(['skill-a']),
      getMetadataList: vi.fn().mockResolvedValue([
        {
          name: 'skill-a',
          description: 'Skill A',
          path: path.join(skillRoot, 'SKILL.md'),
          skillRoot
        }
      ]),
      getActiveSkillsAllowedTools: vi.fn().mockResolvedValue([]),
      listSkillScripts: vi.fn().mockResolvedValue([]),
      getSkillExtension: vi.fn().mockResolvedValue({
        version: 1,
        env: {},
        runtimePolicy: { python: 'auto', node: 'auto' },
        scriptOverrides: {}
      })
    }
    configPresenter = {
      getSkillsEnabled: () => true,
      getSkillsPath: () => skillsDir
    }
  })

  it('allows reading files under active skill roots', async () => {
    const manager = buildManager()

    const result = (await manager.callTool('read', { path: skillFilePath }, 'conv1')) as {
      content: string
    }

    expect(result.content).toContain('guide.md')
    expect(result.content).toContain('active skill file')
  })

  it('allows relative writes when base_directory points at an active skill root', async () => {
    const manager = buildManager()

    const permission = await manager.preCheckToolPermission(
      'write',
      {
        path: 'guide.md',
        content: 'updated',
        base_directory: skillRoot
      },
      'conv1'
    )

    expect(permission).toBeNull()
  })

  it('requires permission for writes under inactive skill roots', async () => {
    skillPresenter.getActiveSkills.mockResolvedValue([])
    const manager = buildManager()

    const permission = await manager.preCheckToolPermission(
      'write',
      {
        path: skillFilePath,
        content: 'updated'
      },
      'conv1'
    )

    expect(permission).toEqual(
      expect.objectContaining({
        needsPermission: true,
        permissionType: 'write',
        paths: [skillFilePath]
      })
    )
  })

  it('does not relax exec cwd rules for active skill roots', async () => {
    const manager = buildManager()

    await expect(
      manager.callTool(
        'exec',
        {
          command: 'pwd',
          description: 'Print cwd',
          cwd: skillRoot
        },
        'conv1'
      )
    ).rejects.toThrow(`Working directory is not allowed: ${skillRoot}`)
  })
})
