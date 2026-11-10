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

    expect(skillService.manageDraftSkill).toHaveBeenCalledWith(
      'conv-1',
      {
        action: 'create',
        content: '---\nname: draft\ndescription: Draft\n---\n\nBody'
      },
      { beforeMutation: expect.any(Function) }
    )
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
})
