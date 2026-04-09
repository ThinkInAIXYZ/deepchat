import { describe, expect, it, vi, beforeEach } from 'vitest'
import { AgentToolManager } from '@/presenter/toolPresenter/agentTools/agentToolManager'
import {
  CHAT_SETTINGS_SKILL_NAME,
  CHAT_SETTINGS_TOOL_NAMES
} from '@/presenter/toolPresenter/agentTools/chatSettingsTools'

vi.mock('electron', () => ({
  app: {
    getPath: () => '/tmp'
  }
}))

describe('AgentToolManager DeepChat settings tool gating', () => {
  const configPresenter = {
    getSkillsEnabled: () => true
  } as any
  const skillPresenter = {
    getActiveSkills: vi.fn(),
    getActiveSkillsAllowedTools: vi.fn(),
    listSkillScripts: vi.fn().mockResolvedValue([]),
    manageDraftSkill: vi.fn(),
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

  const buildManager = () =>
    new AgentToolManager({
      agentWorkspacePath: null,
      configPresenter,
      runtimePort: {
        resolveConversationWorkdir,
        resolveConversationSessionInfo,
        getSkillPresenter: () => skillPresenter,
        getYoBrowserToolHandler: () => ({
          getToolDefinitions,
          callTool: vi.fn()
        }),
        getFilePresenter: () => ({
          getMimeType: vi.fn(),
          prepareFileCompletely: vi.fn()
        }),
        getLlmProviderPresenter: () => ({
          executeWithRateLimit: vi.fn().mockResolvedValue(undefined),
          generateCompletionStandalone: vi.fn()
        }),
        createSettingsWindow: vi.fn(),
        sendToWindow: vi.fn().mockReturnValue(true),
        getApprovedFilePaths: vi.fn().mockReturnValue([]),
        consumeSettingsApproval: vi.fn().mockReturnValue(false)
      }
    })

  beforeEach(() => {
    vi.clearAllMocks()
    resolveConversationWorkdir.mockResolvedValue(null)
    resolveConversationSessionInfo.mockResolvedValue(null)
    skillPresenter.listSkillScripts.mockResolvedValue([])
    skillPresenter.manageDraftSkill.mockResolvedValue({ success: true, action: 'create' })
    getToolDefinitions.mockReturnValue([])
  })

  it('does not include settings tools when skill is inactive', async () => {
    skillPresenter.getActiveSkills.mockResolvedValue([])
    skillPresenter.getActiveSkillsAllowedTools.mockResolvedValue([])

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
    skillPresenter.getActiveSkills.mockResolvedValue([CHAT_SETTINGS_SKILL_NAME])
    skillPresenter.getActiveSkillsAllowedTools.mockResolvedValue([CHAT_SETTINGS_TOOL_NAMES.toggle])

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

  it('includes skill_run when an active skill exposes runnable scripts', async () => {
    skillPresenter.getActiveSkills.mockResolvedValue(['ocr'])
    skillPresenter.getActiveSkillsAllowedTools.mockResolvedValue([])
    skillPresenter.listSkillScripts.mockResolvedValue([
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
  })

  it('exposes skill inspection and draft tools without skill_control', async () => {
    skillPresenter.getActiveSkills.mockResolvedValue([])
    skillPresenter.getActiveSkillsAllowedTools.mockResolvedValue([])

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

  it('rejects skill_manage create requests without content before calling the presenter', async () => {
    skillPresenter.getActiveSkills.mockResolvedValue([])
    skillPresenter.getActiveSkillsAllowedTools.mockResolvedValue([])
    const manager = buildManager()

    await expect(manager.callTool('skill_manage', { action: 'create' }, 'conv-1')).rejects.toThrow(
      'Invalid arguments for skill_manage'
    )
    expect(skillPresenter.manageDraftSkill).not.toHaveBeenCalled()
  })

  it('rejects skill_manage edit requests without draftId before calling the presenter', async () => {
    skillPresenter.getActiveSkills.mockResolvedValue([])
    skillPresenter.getActiveSkillsAllowedTools.mockResolvedValue([])
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
    expect(skillPresenter.manageDraftSkill).not.toHaveBeenCalled()
  })

  it('rejects skill_manage write_file requests without fileContent before calling the presenter', async () => {
    skillPresenter.getActiveSkills.mockResolvedValue([])
    skillPresenter.getActiveSkillsAllowedTools.mockResolvedValue([])
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
    expect(skillPresenter.manageDraftSkill).not.toHaveBeenCalled()
  })

  it('passes valid skill_manage create requests to the presenter', async () => {
    skillPresenter.getActiveSkills.mockResolvedValue([])
    skillPresenter.getActiveSkillsAllowedTools.mockResolvedValue([])
    skillPresenter.manageDraftSkill.mockResolvedValue({
      success: true,
      action: 'create',
      draftId: 'draft-1'
    })
    const manager = buildManager()

    const result = (await manager.callTool(
      'skill_manage',
      {
        action: 'create',
        content: '---\nname: draft\ndescription: Draft\n---\n\nBody'
      },
      'conv-1'
    )) as { content: string }

    expect(skillPresenter.manageDraftSkill).toHaveBeenCalledWith('conv-1', {
      action: 'create',
      content: '---\nname: draft\ndescription: Draft\n---\n\nBody'
    })
    expect(result.content).toContain('"success":true')
  })

  it('resolves workdir from new session first', async () => {
    resolveConversationWorkdir.mockResolvedValue('/tmp/new-session-workdir')

    const manager = buildManager()

    const workdir = await (manager as any).getWorkdirForConversation('new-session-1')
    expect(workdir).toBe('/tmp/new-session-workdir')
    expect(resolveConversationWorkdir).toHaveBeenCalledWith('new-session-1')
  })

  it('builds a stable slotId enum for subagent_orchestrator from the session config', async () => {
    skillPresenter.getActiveSkills.mockResolvedValue([])
    skillPresenter.getActiveSkillsAllowedTools.mockResolvedValue([])
    resolveConversationSessionInfo.mockResolvedValue({
      sessionId: 'conv-1',
      agentId: 'deepchat',
      agentName: 'DeepChat',
      agentType: 'deepchat',
      providerId: 'openai',
      modelId: 'gpt-4.1',
      projectDir: '/tmp/workspace',
      permissionMode: 'full_access',
      generationSettings: null,
      disabledAgentTools: [],
      activeSkills: [],
      sessionKind: 'regular',
      parentSessionId: null,
      subagentEnabled: true,
      subagentMeta: null,
      availableSubagentSlots: [
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

    const manager = buildManager()
    const defs = await manager.getAllToolDefinitions({
      chatMode: 'agent',
      supportsVision: false,
      agentWorkspacePath: null,
      conversationId: 'conv-1'
    })

    const subagentDef = defs.find((def) => def.function.name === 'subagent_orchestrator')
    const slotIdSchema = (subagentDef?.function.parameters as any)?.properties?.tasks?.items
      ?.properties?.slotId
    const promptSchema = (subagentDef?.function.parameters as any)?.properties?.tasks?.items
      ?.properties?.prompt

    expect(slotIdSchema?.enum).toEqual(['reviewer', 'writer'])
    expect(slotIdSchema?.description).toContain('reviewer: ACP Reviewer | target=acp-reviewer')
    expect(slotIdSchema?.description).toContain('writer: Writer Clone | target=current agent')
    expect(subagentDef?.function.description).toContain(
      'inherits the same working directory as the parent session'
    )
    expect(promptSchema?.description).toContain(
      'The child session uses the same working directory as the parent session'
    )
  })
})
