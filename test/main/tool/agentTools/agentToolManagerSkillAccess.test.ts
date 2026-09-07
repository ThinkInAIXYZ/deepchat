import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import { AgentToolManager } from '@/tool/agentTools/agentToolManager'
import { AgentBashHandler } from '@/tool/agentTools/agentBashHandler'
import { POSIX_COMMAND_SHELL } from '../../../helpers/commandShell'
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
  let workspaceDir: string
  let skillsDir: string
  let skillRoot: string
  let skillFilePath: string
  let inactiveSkillFilePath: string
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
    getAllSkills: ReturnType<typeof vi.fn>
    getActiveSkillsAllowedTools: ReturnType<typeof vi.fn>
    listSkillScripts: ReturnType<typeof vi.fn>
    getSkillExtension: ReturnType<typeof vi.fn>
  }

  const buildManager = () => {
    const manager = new AgentToolManager({
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
    const callTool = manager.callTool.bind(manager)
    const preCheckToolPermission = manager.preCheckToolPermission.bind(manager)
    vi.spyOn(manager, 'callTool').mockImplementation((toolName, args, conversationId, options) =>
      callTool(toolName, args, conversationId, {
        commandShell: POSIX_COMMAND_SHELL,
        ...options
      })
    )
    vi.spyOn(manager, 'preCheckToolPermission').mockImplementation(
      (toolName, args, conversationId, options) =>
        preCheckToolPermission(toolName, args, conversationId, {
          commandShell: POSIX_COMMAND_SHELL,
          ...options
        })
    )
    return manager
  }

  beforeEach(async () => {
    vi.clearAllMocks()

    workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), 'deepchat-skill-workspace-'))
    skillsDir = path.join(electronHome, '.deepchat', 'skills')
    skillRoot = path.join(skillsDir, 'skill-a')
    skillFilePath = path.join(skillRoot, 'guide.md')
    inactiveSkillFilePath = path.join(skillsDir, 'skill-b', 'guide.md')

    await fs.mkdir(skillRoot, { recursive: true })
    await fs.mkdir(path.dirname(inactiveSkillFilePath), { recursive: true })
    await fs.writeFile(skillFilePath, 'active skill file', 'utf-8')
    await fs.writeFile(inactiveSkillFilePath, 'inactive skill file', 'utf-8')

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
      getAllSkills: vi.fn().mockResolvedValue([
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

  it('keeps Run snapshot roots allowed after the Agent is unassigned', async () => {
    skillService.getMetadataList.mockResolvedValue([])
    const manager = buildManager()

    const rules = await (manager as any).buildProtectedSkillDirectoryRules('conv1', ['skill-a'])

    expect(skillService.getMetadataList).not.toHaveBeenCalled()
    expect(skillService.getAllSkills).toHaveBeenCalledOnce()
    expect(rules).toEqual([{ root: skillsDir, allowedDirectories: [skillRoot] }])
  })

  it('uses message-active Skill roots during permission pre-checks after unassignment', async () => {
    skillService.getActiveSkills.mockResolvedValue([])
    skillService.getMetadataList.mockResolvedValue([])
    const manager = buildManager()

    const permission = await manager.preCheckToolPermission(
      'read',
      { path: skillFilePath },
      'conv1',
      { activeSkillNames: ['skill-a'] }
    )

    expect(permission).toBeNull()
    expect(skillService.getAllSkills).toHaveBeenCalled()
  })

  it('fails closed when the protected Skill root cannot be resolved', async () => {
    const manager = buildManager()
    skillService.getSkillsDir.mockRejectedValue(new Error('skills root unavailable'))

    await expect((manager as any).buildProtectedSkillDirectoryRules('conv1')).rejects.toThrow(
      'Unable to resolve the protected Skills root'
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
      'conv1',
      { commandShell: POSIX_COMMAND_SHELL }
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
    ['read', { path: () => inactiveSkillFilePath }, 'read'],
    ['write', { path: () => inactiveSkillFilePath, content: 'overwritten' }, 'write'],
    [
      'edit',
      {
        path: () => inactiveSkillFilePath,
        oldText: 'inactive skill file',
        newText: 'edited'
      },
      'write'
    ]
  ] as const)(
    'requires permission for %s access to an inactive shared Skill package',
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
              paths: [await fs.realpath(inactiveSkillFilePath)],
              shellProfile: 'posix'
            })
          })
        })
      )
      await expect(fs.readFile(inactiveSkillFilePath, 'utf-8')).resolves.toBe('inactive skill file')
    }
  )

  it.each([
    ['read', { path: () => inactiveSkillFilePath }],
    ['write', { path: () => inactiveSkillFilePath, content: 'overwritten' }],
    [
      'edit',
      {
        path: () => inactiveSkillFilePath,
        oldText: 'inactive skill file',
        newText: 'edited'
      }
    ]
  ] as const)(
    'hard-denies %s access to an inactive shared Skill package in full access mode',
    async (toolName, args) => {
      const manager = buildManager()

      await expect(
        manager.callTool(toolName, { ...args, path: args.path() }, 'conv1', {
          allowExternalFileAccess: true
        })
      ).rejects.toThrow('inactive shared Skill package')
      await expect(fs.readFile(inactiveSkillFilePath, 'utf-8')).resolves.toBe('inactive skill file')
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
      'conv1',
      { commandShell: POSIX_COMMAND_SHELL }
    )

    expect(permission).toEqual(
      expect.objectContaining({
        needsPermission: true,
        permissionType: 'all',
        paths: [skillRoot],
        shellProfile: 'posix'
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
        'conv1',
        { commandShell: POSIX_COMMAND_SHELL }
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
        allowExternalFileAccess: true,
        commandShell: POSIX_COMMAND_SHELL
      }
    )

    expect(runShellProcess).toHaveBeenCalledWith(
      'pwd',
      skillRoot,
      120000,
      expect.objectContaining({ env: { PATH: '/bin' } })
    )
  })

  it('hard-denies an inactive shared Skill root as exec cwd in full access mode', async () => {
    const manager = buildManager()
    const otherSkillRoot = path.dirname(inactiveSkillFilePath)

    await expect(
      manager.callTool(
        'exec',
        {
          command: 'pwd',
          description: 'Print cwd',
          cwd: otherSkillRoot
        },
        'conv1',
        { allowExternalFileAccess: true, commandShell: POSIX_COMMAND_SHELL }
      )
    ).rejects.toThrow('inactive shared Skill package')
  })
})
