import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import { AgentToolManager } from '@/tool/agentTools/agentToolManager'
import { AgentBashHandler } from '@/tool/agentTools/agentBashHandler'
import { createAgentToolDependencies } from './agentToolDependencies'
import { CommandPermissionService } from '@/tool/permission'

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
  const electronHome = path.join(os.tmpdir(), 'deepchat-electron-home')
  const agentId = `agent-a-${process.pid}`
  const otherAgentId = `agent-b-${process.pid}`
  let workspaceDir: string
  let skillsDir: string
  let skillRoot: string
  let skillFilePath: string
  let otherAgentSkillFilePath: string
  let providerSettings: any
  let fileService: {
    getMimeType: ReturnType<typeof vi.fn>
    prepareFileCompletely: ReturnType<typeof vi.fn>
  }
  let resolveConversationWorkdir: ReturnType<typeof vi.fn>
  let skillService: {
    getActiveSkills: ReturnType<typeof vi.fn>
    getSkillsDir: ReturnType<typeof vi.fn>
    resolveSessionAgentId: ReturnType<typeof vi.fn>
    getMetadataList: ReturnType<typeof vi.fn>
    getActiveSkillsAllowedTools: ReturnType<typeof vi.fn>
    listSkillScripts: ReturnType<typeof vi.fn>
    getSkillExtension: ReturnType<typeof vi.fn>
  }

  const buildManager = () =>
    new AgentToolManager({
      skillSettings: { isEnabled: () => true } as any,
      settings: { get: vi.fn() },
      commandPermissionHandler: new CommandPermissionService(),
      agentWorkspacePath: workspaceDir,
      providerSettings,
      agentSettings: providerSettings,
      dependencies: createAgentToolDependencies({
        resolveConversationWorkdir,
        resolveConversationSessionInfo: vi.fn().mockResolvedValue(null),
        skillService: skillService as any,
        browser: {
          getToolDefinitions: vi.fn().mockReturnValue([]),
          callTool: vi.fn()
        },
        fileService: fileService,
        providerRuntime: {
          executeWithRateLimit: vi.fn().mockResolvedValue(undefined),
          generateCompletionStandalone: vi.fn(),
          generateImageStandalone: vi.fn()
        },
        createSettingsWindow: vi.fn(),
        sendToWindow: vi.fn().mockReturnValue(true),
        getApprovedFilePaths: vi.fn().mockReturnValue([]),
        consumeSettingsApproval: vi.fn().mockReturnValue(false)
      })
    })

  beforeEach(async () => {
    vi.clearAllMocks()

    workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), 'deepchat-skill-workspace-'))
    skillsDir = path.join(electronHome, '.deepchat', 'skills')
    skillRoot = path.join(skillsDir, '.agent-scopes', agentId, 'skill-a')
    skillFilePath = path.join(skillRoot, 'guide.md')
    otherAgentSkillFilePath = path.join(
      skillsDir,
      '.agent-scopes',
      otherAgentId,
      'skill-b',
      'guide.md'
    )

    await fs.mkdir(skillRoot, { recursive: true })
    await fs.mkdir(path.dirname(otherAgentSkillFilePath), { recursive: true })
    await fs.writeFile(skillFilePath, 'active skill file', 'utf-8')
    await fs.writeFile(otherAgentSkillFilePath, 'other agent skill file', 'utf-8')

    fileService = {
      getMimeType: vi.fn().mockResolvedValue('text/plain'),
      prepareFileCompletely: vi.fn()
    }
    resolveConversationWorkdir = vi.fn().mockResolvedValue(null)
    skillService = {
      getActiveSkills: vi.fn().mockResolvedValue(['skill-a']),
      getSkillsDir: vi.fn().mockResolvedValue(skillsDir),
      resolveSessionAgentId: vi.fn().mockResolvedValue(agentId),
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
    providerSettings = {}
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('allows reading files under active skill roots', async () => {
    const manager = buildManager()

    const result = (await manager.callTool('read', { path: skillFilePath }, 'conv1')) as {
      content: string
    }

    expect(result.content).toContain('guide.md')
    expect(result.content).toContain('active skill file')
  })

  it('fails closed when the protected Skill root cannot be resolved', async () => {
    const manager = buildManager()
    skillService.getSkillsDir.mockRejectedValue(new Error('skills root unavailable'))

    await expect((manager as any).buildProtectedSkillDirectoryRules('conv1')).rejects.toThrow(
      'Unable to resolve protected Agent Skill scopes'
    )
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
    skillService.getActiveSkills.mockResolvedValue([])
    const manager = buildManager()

    const permission = await manager.preCheckToolPermission(
      'write',
      {
        path: skillFilePath,
        content: 'updated'
      },
      'conv1'
    )

    const realSkillFilePath = await fs.realpath(skillFilePath)
    expect(permission).toEqual(
      expect.objectContaining({
        needsPermission: true,
        permissionType: 'write',
        paths: [realSkillFilePath]
      })
    )
  })

  it.each([
    ['read', { path: () => otherAgentSkillFilePath }, 'read'],
    ['write', { path: () => otherAgentSkillFilePath, content: 'overwritten' }, 'write'],
    [
      'edit',
      {
        path: () => otherAgentSkillFilePath,
        oldText: 'other agent skill file',
        newText: 'edited'
      },
      'write'
    ]
  ] as const)(
    'requires permission for %s access to another Agent default Skill scope',
    async (toolName, args, permissionType) => {
      const manager = buildManager()
      const toolArgs = { ...args, path: args.path() }

      const result = await manager.callTool(toolName, toolArgs, 'conv1')

      expect(result).toEqual(
        expect.objectContaining({
          rawData: expect.objectContaining({
            requiresPermission: true,
            permissionRequest: expect.objectContaining({
              toolName,
              permissionType,
              paths: [await fs.realpath(otherAgentSkillFilePath)]
            })
          })
        })
      )
      await expect(fs.readFile(otherAgentSkillFilePath, 'utf-8')).resolves.toBe(
        'other agent skill file'
      )
    }
  )

  it.each([
    ['read', { path: () => otherAgentSkillFilePath }],
    ['write', { path: () => otherAgentSkillFilePath, content: 'overwritten' }],
    [
      'edit',
      {
        path: () => otherAgentSkillFilePath,
        oldText: 'other agent skill file',
        newText: 'edited'
      }
    ]
  ] as const)(
    'hard-denies %s access to another Agent scope in full access mode',
    async (toolName, args) => {
      const manager = buildManager()

      await expect(
        manager.callTool(toolName, { ...args, path: args.path() }, 'conv1', {
          allowExternalFileAccess: true
        })
      ).rejects.toThrow('another Agent Skill scope')
      await expect(fs.readFile(otherAgentSkillFilePath, 'utf-8')).resolves.toBe(
        'other agent skill file'
      )
    }
  )

  it('does not relax exec cwd rules for active skill roots', async () => {
    const manager = buildManager()

    const permission = await manager.preCheckToolPermission(
      'exec',
      {
        command: 'pwd',
        description: 'Print cwd',
        cwd: skillRoot
      },
      'conv1'
    )

    expect(permission).toEqual(
      expect.objectContaining({
        needsPermission: true,
        permissionType: 'all',
        paths: [skillRoot]
      })
    )

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

  it('allows exec cwd under active skill roots in full access mode', async () => {
    const manager = buildManager()
    vi.spyOn(AgentBashHandler.prototype as never, 'prepareCommand' as never).mockResolvedValue({
      originalCommand: 'pwd',
      command: 'pwd',
      env: { PATH: '/bin' },
      rewritten: false,
      rtkApplied: false,
      rtkMode: 'bypass'
    })
    const runShellProcess = vi
      .spyOn(AgentBashHandler.prototype as never, 'runShellProcess' as never)
      .mockResolvedValue({
        kind: 'completed',
        output: skillRoot,
        exitCode: 0,
        timedOut: false,
        offloaded: false
      })

    await manager.callTool(
      'exec',
      {
        command: 'pwd',
        description: 'Print cwd',
        cwd: skillRoot
      },
      'conv1',
      {
        allowExternalFileAccess: true
      }
    )

    expect(runShellProcess).toHaveBeenCalledWith(
      'pwd',
      skillRoot,
      120000,
      expect.objectContaining({ env: { PATH: '/bin' } })
    )
  })

  it('hard-denies another Agent Skill root as exec cwd in full access mode', async () => {
    const manager = buildManager()
    const otherSkillRoot = path.dirname(otherAgentSkillFilePath)

    await expect(
      manager.callTool(
        'exec',
        {
          command: 'pwd',
          description: 'Print cwd',
          cwd: otherSkillRoot
        },
        'conv1',
        { allowExternalFileAccess: true }
      )
    ).rejects.toThrow('another Agent Skill scope')
  })
})
