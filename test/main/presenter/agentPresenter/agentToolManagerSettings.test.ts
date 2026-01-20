import { describe, expect, it, vi, beforeEach } from 'vitest'
import { AgentToolManager } from '@/presenter/agentPresenter/acp/agentToolManager'
import {
  CHAT_SETTINGS_SKILL_NAME,
  CHAT_SETTINGS_TOOL_NAMES
} from '@/presenter/agentPresenter/acp/chatSettingsTools'
import { presenter } from '@/presenter'

vi.mock('electron', () => ({
  app: {
    getPath: () => '/tmp'
  }
}))

vi.mock('@/presenter', () => ({
  presenter: {
    skillPresenter: {
      getActiveSkills: vi.fn(),
      getActiveSkillsAllowedTools: vi.fn()
    },
    yoBrowserPresenter: {
      toolHandler: {
        getToolDefinitions: vi.fn().mockReturnValue([])
      }
    },
    sessionPresenter: {},
    windowPresenter: {}
  }
}))

describe('AgentToolManager DeepChat settings tool gating', () => {
  const configPresenter = {
    getSkillsEnabled: () => true
  } as any

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('does not include settings tools when skill is inactive', async () => {
    ;(presenter.skillPresenter.getActiveSkills as any).mockResolvedValue([])
    ;(presenter.skillPresenter.getActiveSkillsAllowedTools as any).mockResolvedValue([])

    const manager = new AgentToolManager({
      agentWorkspacePath: null,
      configPresenter
    })

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
    ;(presenter.skillPresenter.getActiveSkills as any).mockResolvedValue([CHAT_SETTINGS_SKILL_NAME])
    ;(presenter.skillPresenter.getActiveSkillsAllowedTools as any).mockResolvedValue([
      CHAT_SETTINGS_TOOL_NAMES.toggle
    ])

    const manager = new AgentToolManager({
      agentWorkspacePath: null,
      configPresenter
    })

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
})
