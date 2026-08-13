import { describe, expect, it, vi, beforeEach } from 'vitest'
import { AgentToolManager } from '@/tool/agentTools/agentToolManager'
import {
  CHAT_SETTINGS_SKILL_NAME,
  CHAT_SETTINGS_TOOL_NAMES
} from '@/tool/agentTools/chatSettingsTools'
import { createAgentToolDependencies } from './agentToolDependencies'
import { CommandPermissionService } from '@/tool/permission'
import {
  DEEPCHAT_SUBAGENT_MODEL_GUIDANCE,
  resolveDeepChatSubagentCapability
} from '@shared/lib/deepchatSubagents'
import { LIVE_DELEGATION_AGENT_TOOL_NAME } from '@shared/agentTools'
import { SkillExecutionService } from '@/skill/skillExecutionService'
import { POSIX_COMMAND_SHELL } from '../../../helpers/commandShell'
import {
  SKILL_EXECUTION_PACKAGE_MAX_PATH_BYTES,
  SKILL_RUN_MAX_ARGUMENTS,
  SKILL_RUN_MAX_ARGUMENT_CHARS,
  SKILL_RUN_MAX_STDIN_CHARS,
  SKILL_RUN_MAX_TOTAL_ARGUMENT_CHARS
} from '@shared/types/skill'
import { SKILL_LIST_CURSOR_MAX_BYTES, SKILL_LIST_QUERY_MAX_BYTES } from '@/skill/routingCatalog'

const SKILL_EVIDENCE_HASH = 'a'.repeat(64)

function makeSkillResolution(name: string, content: string, agentId = 'agent-a') {
  return {
    identity: {
      agentId,
      sourceType: 'created' as const,
      sourceId: `/skills/${name}`,
      skillName: name
    },
    effectiveContent: content,
    builderVersion: 'builder-1',
    renderedManifestHash: SKILL_EVIDENCE_HASH,
    scriptInventoryHash: SKILL_EVIDENCE_HASH,
    executionPackage: {
      files: [],
      executables: [],
      runtimePolicy: { python: 'auto' as const, node: 'auto' as const },
      environmentBindingId: null
    }
  }
}

vi.mock('electron', () => ({
  app: {
    getPath: () => '/tmp',
    getAppPath: () => '/mock/app'
  }
}))

describe('AgentToolManager DeepChat settings tool gating', () => {
  const providerSettings = {} as any
  const skillService = {
    getActiveSkills: vi.fn(),
    getActiveSkillsAllowedTools: vi.fn(),
    getMetadataList: vi.fn(),
    getAllSkills: vi.fn(),
    viewSkill: vi.fn(),
    viewSkillForAgent: vi.fn(),
    listSkillScripts: vi.fn().mockResolvedValue([]),
    listSkillScriptsForAgent: vi.fn().mockResolvedValue([]),
    resolveSessionAgentId: vi.fn().mockResolvedValue('agent-a'),
    manageDraftSkill: vi.fn(),
    setActiveSkills: vi.fn(),
    getSkillExtension: vi.fn().mockResolvedValue({
      version: 1,
      env: {},
      runtimePolicy: { python: 'auto', node: 'auto' },
      scriptOverrides: {}
    })
  } as any
  const resolveConversationWorkdir = vi.fn()
  const resolveConversationSessionInfo = vi.fn()
  const getToolDefinitions = vi.fn().mockReturnValue([])
  const resolveSkillExecutionAuthority = vi.fn()
  const assertSkillExecutionAuthorityCurrent = vi.fn()

  const buildManager = () =>
    new AgentToolManager({
      skillSettings: { isEnabled: () => true } as any,
      settings: { get: vi.fn() },
      commandPermissionHandler: new CommandPermissionService(),
      desktopSettings: {
        getCopyWithCotEnabled: vi.fn(() => true),
        setCopyWithCotEnabled: vi.fn()
      } as any,
      agentWorkspacePath: null,
      providerSettings,
      agentSettings: providerSettings,
      dependencies: createAgentToolDependencies({
        resolveConversationWorkdir,
        resolveConversationSessionInfo,
        skillService: skillService,
        skillExecutionAuthority: {
          resolve: resolveSkillExecutionAuthority,
          assertCurrent: assertSkillExecutionAuthorityCurrent
        } as any,
        browser: {
          getToolDefinitions,
          callTool: vi.fn()
        },
        fileService: {
          getMimeType: vi.fn(),
          prepareFileCompletely: vi.fn()
        },
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

  beforeEach(() => {
    vi.clearAllMocks()
    resolveConversationWorkdir.mockResolvedValue(null)
    resolveConversationSessionInfo.mockResolvedValue(null)
    skillService.listSkillScripts.mockResolvedValue([])
    skillService.listSkillScriptsForAgent.mockResolvedValue([])
    skillService.resolveSessionAgentId.mockResolvedValue('agent-a')
    skillService.getMetadataList.mockResolvedValue([
      {
        name: 'code-review',
        description: 'Code Review',
        category: 'engineering',
        platforms: [],
        metadata: {}
      }
    ])
    skillService.getAllSkills.mockResolvedValue([
      {
        name: 'code-review',
        description: 'Code Review',
        category: 'engineering',
        platforms: [],
        metadata: {}
      }
    ])
    const contentResolution = makeSkillResolution('code-review', '# Code Review')
    const viewResult = {
      success: true,
      name: 'code-review',
      filePath: null,
      content: '# Code Review',
      isPinned: false,
      contentIdentity: contentResolution.identity,
      contentResolution
    }
    skillService.viewSkill.mockResolvedValue(viewResult)
    skillService.viewSkillForAgent.mockResolvedValue(viewResult)
    skillService.manageDraftSkill.mockResolvedValue({ success: true, action: 'create' })
    assertSkillExecutionAuthorityCurrent.mockResolvedValue(undefined)
    getToolDefinitions.mockReturnValue([])
  })

  it('does not include settings tools when skill is inactive', async () => {
    skillService.getActiveSkills.mockResolvedValue([])
    skillService.getActiveSkillsAllowedTools.mockResolvedValue([])

    const manager = buildManager()

    const defs = await manager.getAllToolDefinitions({
      chatMode: 'agent',
      supportsVision: false,
      agentWorkspacePath: null,
      conversationId: 'conv-1'
    })

    const names = defs.map((def) => def.function.name)
    expect(names).not.toContain(CHAT_SETTINGS_TOOL_NAMES.toggle)
    expect(names).not.toContain(CHAT_SETTINGS_TOOL_NAMES.open)
  })

  it('includes settings tools when skill is active and allowed', async () => {
    skillService.getActiveSkills.mockResolvedValue([CHAT_SETTINGS_SKILL_NAME])
    skillService.getActiveSkillsAllowedTools.mockResolvedValue([CHAT_SETTINGS_TOOL_NAMES.toggle])

    const manager = buildManager()

    const defs = await manager.getAllToolDefinitions({
      chatMode: 'agent',
      supportsVision: false,
      agentWorkspacePath: null,
      conversationId: 'conv-1'
    })

    const names = defs.map((def) => def.function.name)
    expect(names).toContain(CHAT_SETTINGS_TOOL_NAMES.toggle)
    expect(names).not.toContain(CHAT_SETTINGS_TOOL_NAMES.open)
  })

  it('includes settings tools for message-scoped active skills', async () => {
    skillService.getActiveSkills.mockResolvedValue([])
    skillService.getActiveSkillsAllowedTools.mockResolvedValue([CHAT_SETTINGS_TOOL_NAMES.toggle])

    const manager = buildManager()

    const defs = await manager.getAllToolDefinitions({
      chatMode: 'agent',
      supportsVision: false,
      agentWorkspacePath: null,
      conversationId: 'conv-1',
      activeSkillNames: [CHAT_SETTINGS_SKILL_NAME]
    })

    const names = defs.map((def) => def.function.name)
    expect(names).toContain(CHAT_SETTINGS_TOOL_NAMES.toggle)
    expect(skillService.getActiveSkills).not.toHaveBeenCalled()
  })

  it('propagates settings catalog failures only for fail-closed refreshes', async () => {
    skillService.getActiveSkillsAllowedTools.mockRejectedValue(
      new Error('Skill policy unavailable')
    )
    const manager = buildManager()
    const context = {
      chatMode: 'agent' as const,
      supportsVision: false,
      agentWorkspacePath: null,
      conversationId: 'conv-1',
      activeSkillNames: [CHAT_SETTINGS_SKILL_NAME]
    }

    await expect(manager.getAllToolDefinitions(context)).resolves.not.toContainEqual(
      expect.objectContaining({
        function: expect.objectContaining({ name: CHAT_SETTINGS_TOOL_NAMES.toggle })
      })
    )
    await expect(
      manager.getAllToolDefinitions({ ...context, requireCompleteCatalog: true })
    ).rejects.toThrow('Skill policy unavailable')
  })

  it('includes skill_run when an active skill exposes runnable scripts', async () => {
    skillService.getActiveSkills.mockResolvedValue(['ocr'])
    skillService.getActiveSkillsAllowedTools.mockResolvedValue([])
    skillService.listSkillScriptsForAgent.mockResolvedValue([
      {
        name: 'run.py',
        relativePath: 'scripts/run.py',
        absolutePath: '/tmp/skills/ocr/scripts/run.py',
        runtime: 'python',
        enabled: true
      }
    ])

    const manager = buildManager()

    const defs = await manager.getAllToolDefinitions({
      chatMode: 'agent',
      supportsVision: false,
      agentWorkspacePath: null,
      conversationId: 'conv-1'
    })

    expect(defs.map((def) => def.function.name)).toContain('skill_run')
    expect(skillService.listSkillScriptsForAgent).toHaveBeenCalledWith('agent-a', 'ocr')
    expect(skillService.listSkillScripts).not.toHaveBeenCalled()
  })

  it('executes skill_run only through its exact provider-request authority', async () => {
    const authority = { identity: { skillName: 'ocr' }, executionPackage: {} }
    resolveSkillExecutionAuthority.mockResolvedValue(authority)
    const execute = vi
      .spyOn(SkillExecutionService.prototype, 'execute')
      .mockResolvedValue({ output: 'ok', rtkApplied: false, rtkMode: 'bypass' } as any)
    const manager = buildManager()
    const commitDispatch = vi.fn()

    const result = await manager.callTool(
      'skill_run',
      { skill: 'ocr', script: 'scripts/run.py' },
      'conv-1',
      {
        runId: 'run-1',
        requestSeq: 3,
        manifestHash: 'a'.repeat(64),
        tapeIncarnationId: 'incarnation-1',
        commandShell: POSIX_COMMAND_SHELL,
        commitDispatch
      }
    )

    expect(resolveSkillExecutionAuthority).toHaveBeenCalledWith({
      sessionId: 'conv-1',
      runId: 'run-1',
      requestSeq: 3,
      manifestHash: 'a'.repeat(64),
      tapeIncarnationId: 'incarnation-1',
      skillName: 'ocr'
    })
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({ skill: 'ocr', script: 'scripts/run.py' }),
      authority,
      expect.objectContaining({
        conversationId: 'conv-1',
        assertAuthorityCurrent: expect.any(Function)
      })
    )
    const executeOptions = execute.mock.calls[0]?.[2]
    await executeOptions?.assertAuthorityCurrent()
    expect(assertSkillExecutionAuthorityCurrent).toHaveBeenCalledWith(authority)
    expect(result.content).toBe('ok')
    expect(result.rawData?.isError).toBe(false)
  })

  it('marks output-limited skill runs as tool errors', async () => {
    const authority = { identity: { skillName: 'ocr' }, executionPackage: {} }
    resolveSkillExecutionAuthority.mockResolvedValue(authority)
    vi.spyOn(SkillExecutionService.prototype, 'execute').mockResolvedValue({
      output: '[Process terminated: output exceeded 8 bytes.]',
      outputLimited: true,
      rtkApplied: false,
      rtkMode: 'bypass'
    } as never)
    const manager = buildManager()

    const result = await manager.callTool(
      'skill_run',
      { skill: 'ocr', script: 'scripts/run.py' },
      'conv-1',
      {
        runId: 'run-1',
        requestSeq: 3,
        manifestHash: 'a'.repeat(64),
        tapeIncarnationId: 'incarnation-1',
        commandShell: POSIX_COMMAND_SHELL
      }
    )

    expect(result.rawData?.isError).toBe(true)
  })

  it('rejects skill_run without a physical provider-request binding', async () => {
    const execute = vi.spyOn(SkillExecutionService.prototype, 'execute')
    const manager = buildManager()

    await expect(
      manager.callTool('skill_run', { skill: 'ocr', script: 'scripts/run.py' }, 'conv-1', {
        commandShell: POSIX_COMMAND_SHELL
      })
    ).rejects.toThrow(/exact request-bound/)

    expect(resolveSkillExecutionAuthority).not.toHaveBeenCalled()
    expect(execute).not.toHaveBeenCalled()
  })

  it.each([
    {
      label: 'argument count',
      input: { args: Array.from({ length: SKILL_RUN_MAX_ARGUMENTS + 1 }, () => '') }
    },
    {
      label: 'single argument size',
      input: { args: ['x'.repeat(SKILL_RUN_MAX_ARGUMENT_CHARS + 1)] }
    },
    {
      label: 'total argument size',
      input: {
        args: [
          'x'.repeat(SKILL_RUN_MAX_ARGUMENT_CHARS),
          'y'.repeat(SKILL_RUN_MAX_ARGUMENT_CHARS),
          'z'.repeat(SKILL_RUN_MAX_ARGUMENT_CHARS),
          'overflow'
        ]
      }
    },
    {
      label: 'stdin size',
      input: { stdin: 'x'.repeat(SKILL_RUN_MAX_STDIN_CHARS + 1) }
    }
  ])(
    'rejects skill_run input beyond its $label limit before authority lookup',
    async ({ input }) => {
      const manager = buildManager()

      await expect(
        manager.callTool(
          'skill_run',
          { skill: 'ocr', script: 'scripts/run.py', ...input },
          'conv-1',
          {
            runId: 'run-1',
            requestSeq: 3,
            manifestHash: 'a'.repeat(64),
            tapeIncarnationId: 'incarnation-1',
            commandShell: POSIX_COMMAND_SHELL
          }
        )
      ).rejects.toThrow('Invalid arguments for skill_run')

      expect(resolveSkillExecutionAuthority).not.toHaveBeenCalled()
    }
  )

  it.each([
    {
      toolName: 'skill_list',
      args: { query: '界'.repeat(Math.floor(SKILL_LIST_QUERY_MAX_BYTES / 3) + 1) }
    },
    {
      toolName: 'skill_list',
      args: { cursor: '界'.repeat(Math.floor(SKILL_LIST_CURSOR_MAX_BYTES / 3) + 1) }
    },
    {
      toolName: 'skill_run',
      args: {
        skill: 'ocr',
        script: '界'.repeat(Math.floor(SKILL_EXECUTION_PACKAGE_MAX_PATH_BYTES / 3) + 1)
      }
    }
  ])(
    'rejects multibyte $toolName input beyond its UTF-8 byte limit',
    async ({ toolName, args }) => {
      const manager = buildManager()

      await expect(manager.callTool(toolName, args, 'conv-1')).rejects.toThrow(
        `Invalid arguments for ${toolName}`
      )
    }
  )

  it('resolves file-tool skill roots from the conversation agent catalog only', async () => {
    skillService.getActiveSkills.mockResolvedValue(['scoped-skill'])
    skillService.getMetadataList.mockResolvedValue([
      {
        name: 'scoped-skill',
        skillRoot: process.cwd()
      }
    ])

    const manager = buildManager()
    const roots = await (manager as any).resolveActiveSkillRoots('conv-1')

    expect(skillService.resolveSessionAgentId).toHaveBeenCalledWith('conv-1')
    expect(skillService.getMetadataList).toHaveBeenCalledWith('agent-a')
    expect(roots).toEqual([])
  })

  it('exposes skill inspection and draft tools without skill_control', async () => {
    skillService.getActiveSkills.mockResolvedValue([])
    skillService.getActiveSkillsAllowedTools.mockResolvedValue([])

    const manager = buildManager()

    const defs = await manager.getAllToolDefinitions({
      chatMode: 'agent',
      supportsVision: false,
      agentWorkspacePath: null,
      conversationId: 'conv-1'
    })

    const names = defs.map((def) => def.function.name)
    expect(names).toContain('skill_list')
    expect(names).toContain('skill_view')
    expect(names).toContain('skill_manage')
    expect(names).not.toContain('skill_control')
  })

  it('keeps skill_list unrestricted when active skill override is omitted', async () => {
    skillService.getActiveSkills.mockResolvedValue(['code-review'])
    skillService.getActiveSkillsAllowedTools.mockResolvedValue([])

    const manager = buildManager()
    const result = (await manager.callTool('skill_list', {}, 'conv-1')) as { content: string }
    const content = JSON.parse(result.content) as {
      skills: Array<{ name: string; active: boolean }>
    }

    expect(content.skills).toEqual([
      expect.objectContaining({
        name: 'code-review',
        active: true
      })
    ])
  })

  it('does not use active skills as the skill_list allowlist', async () => {
    skillService.getActiveSkills.mockResolvedValue([])
    skillService.getActiveSkillsAllowedTools.mockResolvedValue([])

    const manager = buildManager()
    const result = (await manager.callTool('skill_list', {}, 'conv-1', {
      activeSkillNames: []
    })) as { content: string }
    const content = JSON.parse(result.content) as {
      skills: Array<{ name: string; active: boolean }>
      totalCount: number
    }

    expect(content.totalCount).toBe(1)
    expect(content.skills).toEqual([
      expect.objectContaining({
        name: 'code-review',
        active: false
      })
    ])
  })

  it('returns runtime skill_view activation metadata without persisting session skills', async () => {
    skillService.getActiveSkills.mockResolvedValue([])
    skillService.getActiveSkillsAllowedTools.mockResolvedValue([])
    const contentResolution = makeSkillResolution('deepchat-settings', '# Skill')
    skillService.viewSkillForAgent.mockResolvedValue({
      success: true,
      name: 'deepchat-settings',
      filePath: null,
      content: '# Skill',
      isPinned: false,
      contentIdentity: contentResolution.identity,
      contentResolution
    })

    const manager = buildManager()
    const commitDispatch = vi.fn()
    const result = (await manager.callTool('skill_view', { name: 'deepchat-settings' }, 'conv-1', {
      activeSkillNames: [],
      commitDispatch
    })) as { content: string; rawData?: { toolResult?: unknown } }

    const content = JSON.parse(result.content) as Record<string, unknown>
    expect(content.isPinned).toBe(false)
    expect(content.activeForCurrentMessage).toBe(true)
    expect(content.activatedForMessage).toBe(true)
    expect(content.activationScope).toBe('message')
    expect(content.contentIdentity).toBeUndefined()
    expect(content.contentResolution).toBeUndefined()
    expect(JSON.stringify(content)).not.toContain('executionPackage')
    expect(skillService.setActiveSkills).not.toHaveBeenCalled()
    expect(commitDispatch).toHaveBeenCalledOnce()
    expect(commitDispatch).toHaveBeenCalledWith({
      toolName: 'skill_view',
      toolSource: 'agent',
      normalizedArguments: { name: 'deepchat-settings' },
      target: { serverName: 'agent-skills', originalName: 'skill_view' }
    })
    expect(result.rawData?.toolResult).toEqual({
      activationApplied: true,
      activationSource: 'skill_md',
      activatedSkill: 'deepchat-settings',
      skillContext: {
        agentId: 'agent-a',
        sourceType: 'created',
        sourceId: '/skills/deepchat-settings',
        skillName: 'deepchat-settings'
      },
      skillResolution: contentResolution
    })
  })

  it('confirms an already-active root view without returning or dispatching its body again', async () => {
    skillService.getActiveSkills.mockResolvedValue(['deepchat-settings'])
    const manager = buildManager()
    const commitDispatch = vi.fn()

    const result = (await manager.callTool('skill_view', { name: 'deepchat-settings' }, 'conv-1', {
      activeSkillNames: ['deepchat-settings'],
      commitDispatch
    })) as { content: string; rawData?: { toolResult?: unknown } }

    expect(JSON.parse(result.content)).toEqual({
      success: true,
      name: 'deepchat-settings',
      isPinned: true,
      activeForCurrentMessage: true,
      activatedForMessage: false,
      activationScope: 'none',
      message: 'Skill is already active for the current message.'
    })
    expect(result.content).not.toContain('# Skill')
    expect(result.rawData?.toolResult).toEqual({
      activationApplied: false,
      activationSource: 'none'
    })
    expect(skillService.viewSkillForAgent).not.toHaveBeenCalled()
    expect(commitDispatch).not.toHaveBeenCalled()
  })

  it('does not mark linked file views as skill activations', async () => {
    skillService.getActiveSkills.mockResolvedValue([])
    skillService.getActiveSkillsAllowedTools.mockResolvedValue([])
    skillService.viewSkillForAgent.mockResolvedValue({
      success: true,
      name: 'deepchat-settings',
      filePath: 'references/guide.md',
      content: '# Guide',
      isPinned: false
    })

    const manager = buildManager()
    const commitDispatch = vi.fn()
    const result = (await manager.callTool(
      'skill_view',
      { name: 'deepchat-settings', file_path: 'references/guide.md' },
      'conv-1',
      { activeSkillNames: ['deepchat-settings'], commitDispatch }
    )) as { rawData?: { toolResult?: unknown } }

    expect(result.rawData?.toolResult).toEqual({
      activationApplied: false,
      activationSource: 'file'
    })
    expect(skillService.viewSkillForAgent).toHaveBeenCalledWith('agent-a', 'deepchat-settings', {
      filePath: 'references/guide.md',
      conversationId: 'conv-1',
      activeSkillNames: ['deepchat-settings']
    })
    expect(commitDispatch).not.toHaveBeenCalled()
  })

  it('rejects skill_manage create requests without content before calling the presenter', async () => {
    skillService.getActiveSkills.mockResolvedValue([])
    skillService.getActiveSkillsAllowedTools.mockResolvedValue([])
    const manager = buildManager()

    await expect(manager.callTool('skill_manage', { action: 'create' }, 'conv-1')).rejects.toThrow(
      'Invalid arguments for skill_manage'
    )
    expect(skillService.manageDraftSkill).not.toHaveBeenCalled()
  })

  it('rejects skill_manage edit requests without draftId before calling the presenter', async () => {
    skillService.getActiveSkills.mockResolvedValue([])
    skillService.getActiveSkillsAllowedTools.mockResolvedValue([])
    const manager = buildManager()

    await expect(
      manager.callTool(
        'skill_manage',
        {
          action: 'edit',
          content: '---\nname: draft\ndescription: Draft\n---\n\nBody'
        },
        'conv-1'
      )
    ).rejects.toThrow('Invalid arguments for skill_manage')
    expect(skillService.manageDraftSkill).not.toHaveBeenCalled()
  })

  it('rejects skill_manage write_file requests without fileContent before calling the presenter', async () => {
    skillService.getActiveSkills.mockResolvedValue([])
    skillService.getActiveSkillsAllowedTools.mockResolvedValue([])
    const manager = buildManager()

    await expect(
      manager.callTool(
        'skill_manage',
        {
          action: 'write_file',
          draftId: 'draft-1',
          filePath: 'references/guide.md'
        },
        'conv-1'
      )
    ).rejects.toThrow('Invalid arguments for skill_manage')
    expect(skillService.manageDraftSkill).not.toHaveBeenCalled()
  })

  it('passes valid skill_manage create requests to the presenter', async () => {
    skillService.getActiveSkills.mockResolvedValue([])
    skillService.getActiveSkillsAllowedTools.mockResolvedValue([])
    skillService.manageDraftSkill.mockResolvedValue({
      success: true,
      action: 'create',
      draftId: 'draft-1',
      skillName: 'draft'
    })
    const manager = buildManager()

    const result = (await manager.callTool(
      'skill_manage',
      {
        action: 'create',
        content: '---\nname: draft\ndescription: Draft\n---\n\nBody'
      },
      'conv-1'
    )) as { content: string; rawData?: { toolResult?: unknown } }

    expect(skillService.manageDraftSkill).toHaveBeenCalledWith('conv-1', {
      action: 'create',
      content: '---\nname: draft\ndescription: Draft\n---\n\nBody'
    })
    expect(result.content).toContain('"success":true')
    expect(result.rawData?.toolResult).toEqual(
      expect.objectContaining({
        toolName: 'skill_manage',
        success: true,
        action: 'create',
        draftId: 'draft-1',
        skillName: 'draft',
        skillDraft: {
          status: 'created',
          draftId: 'draft-1',
          skillName: 'draft'
        }
      })
    )
  })

  it('resolves workdir from new session first', async () => {
    resolveConversationWorkdir.mockResolvedValue('/tmp/new-session-workdir')

    const manager = buildManager()

    const workdir = await (manager as any).getWorkdirForConversation('new-session-1')
    expect(workdir).toBe('/tmp/new-session-workdir')
    expect(resolveConversationWorkdir).toHaveBeenCalledWith('new-session-1')
  })

  it('builds a stable slotId enum for persistent live delegation', async () => {
    skillService.getActiveSkills.mockResolvedValue([])
    skillService.getActiveSkillsAllowedTools.mockResolvedValue([])
    const subagentCapability = resolveDeepChatSubagentCapability({
      agentType: 'deepchat',
      sessionKind: 'regular',
      agentPolicyEnabled: true,
      slots: [
        {
          id: 'writer',
          targetType: 'self',
          displayName: 'Writer Clone',
          description: 'Handle drafting tasks.'
        },
        {
          id: 'reviewer',
          targetType: 'agent',
          targetAgentId: 'acp-reviewer',
          displayName: 'ACP Reviewer',
          description: 'Review code changes.'
        }
      ]
    })
    resolveConversationSessionInfo.mockResolvedValue({
      sessionId: 'conv-1',
      agentId: 'deepchat',
      agentName: 'DeepChat',
      agentType: 'deepchat',
      sessionKind: 'regular',
      subagentCapability
    })

    const manager = buildManager()
    const defs = await manager.getAllToolDefinitions({
      chatMode: 'agent',
      supportsVision: false,
      agentWorkspacePath: null,
      conversationId: 'conv-1',
      subagentCapability
    })

    const subagentDef = defs.find((def) => def.function.name === LIVE_DELEGATION_AGENT_TOOL_NAME)
    const slotIdSchema = (subagentDef?.function.parameters as any)?.properties?.slotId
    const promptSchema = (subagentDef?.function.parameters as any)?.properties?.prompt

    expect(slotIdSchema?.enum).toEqual(['reviewer', 'writer'])
    expect(slotIdSchema?.description).toContain('reviewer: ACP Reviewer — Review code changes.')
    expect(slotIdSchema?.description).toContain('writer: Writer Clone — Handle drafting tasks.')
    expect(subagentDef?.function.description).toContain(DEEPCHAT_SUBAGENT_MODEL_GUIDANCE)
    expect(subagentDef?.function.description).toContain('send to leave a message without starting')
    expect(promptSchema?.description).toContain('Bounded child task')
    expect(defs.some((def) => def.function.name === 'subagent_orchestrator')).toBe(false)
  })

  it('requires confirmation only when explicit policy starts child work', async () => {
    skillService.getActiveSkills.mockResolvedValue([])
    skillService.getActiveSkillsAllowedTools.mockResolvedValue([])
    const manager = buildManager()
    resolveConversationSessionInfo.mockResolvedValue({ orchestrationPolicy: 'explicit' })

    await expect(
      manager.preCheckToolPermission(
        LIVE_DELEGATION_AGENT_TOOL_NAME,
        { operation: 'spawn' },
        'conv-1'
      )
    ).resolves.toMatchObject({
      needsPermission: true,
      permissionType: 'write',
      description: 'components.messageBlockPermissionRequest.description.subagentStart',
      rememberable: false,
      requiresUserConfirmation: true
    })
    await expect(
      manager.preCheckToolPermission(
        LIVE_DELEGATION_AGENT_TOOL_NAME,
        { operation: 'send' },
        'conv-1'
      )
    ).resolves.toBeNull()

    resolveConversationSessionInfo.mockResolvedValue({ orchestrationPolicy: 'proactive' })
    await expect(
      manager.preCheckToolPermission(
        LIVE_DELEGATION_AGENT_TOOL_NAME,
        { operation: 'follow_up' },
        'conv-1'
      )
    ).resolves.toBeNull()
  })
})
