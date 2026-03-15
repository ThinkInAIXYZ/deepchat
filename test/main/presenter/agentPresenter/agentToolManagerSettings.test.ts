import { describe, expect, it, vi, beforeEach } from 'vitest'
import { AgentToolManager } from '@/presenter/agentPresenter/acp/agentToolManager'
import {
  CHAT_SETTINGS_SKILL_NAME,
  CHAT_SETTINGS_TOOL_NAMES
} from '@/presenter/agentPresenter/acp/chatSettingsTools'

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
    getSkillExtension: vi.fn().mockResolvedValue({
      version: 1,
      env: {},
      runtimePolicy: { python: 'auto', node: 'auto' },
      scriptOverrides: {}
    })
  } as any
  const resolveConversationWorkdir = vi.fn()
  const getToolDefinitions = vi.fn().mockReturnValue([])

  const buildManager = () =>
    new AgentToolManager({
      agentWorkspacePath: null,
      configPresenter,
      runtimePort: {
        resolveConversationWorkdir,
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
    skillPresenter.listSkillScripts.mockResolvedValue([])
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

  it('resolves workdir from new session first', async () => {
    resolveConversationWorkdir.mockResolvedValue('/tmp/new-session-workdir')

    const manager = buildManager()

    const workdir = await (manager as any).getWorkdirForConversation('new-session-1')
    expect(workdir).toBe('/tmp/new-session-workdir')
    expect(resolveConversationWorkdir).toHaveBeenCalledWith('new-session-1')
  })
})
