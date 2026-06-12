import { beforeEach, describe, expect, it, vi } from 'vitest'
import os from 'os'
import { AgentToolManager } from '@/presenter/toolPresenter/agentTools/agentToolManager'
import {
  YoBrowserUnavailableError,
  buildYoBrowserUnavailablePayload
} from '@/presenter/browser/YoBrowserErrors'

vi.mock('electron', () => ({
  app: {
    getPath: () => os.tmpdir()
  },
  nativeImage: {
    createFromPath: () => ({
      getSize: () => ({ width: 128, height: 96 })
    })
  }
}))

describe('AgentToolManager YoBrowser routing', () => {
  let manager: AgentToolManager
  let yoBrowserCallTool: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    yoBrowserCallTool = vi.fn()
    manager = new AgentToolManager({
      agentWorkspacePath: null,
      configPresenter: {
        getSkillsEnabled: () => false,
        getSkillsPath: () => os.tmpdir(),
        getModelConfig: vi.fn(),
        resolveDeepChatAgentConfig: vi.fn().mockResolvedValue({})
      } as any,
      runtimePort: {
        resolveConversationWorkdir: vi.fn().mockResolvedValue(null),
        resolveConversationSessionInfo: vi.fn().mockResolvedValue(null),
        getSkillPresenter: () =>
          ({
            getActiveSkills: vi.fn().mockResolvedValue([]),
            getActiveSkillsAllowedTools: vi.fn().mockResolvedValue([]),
            listSkillScripts: vi.fn().mockResolvedValue([]),
            getSkillExtension: vi.fn()
          }) as any,
        getYoBrowserToolHandler: () => ({
          getToolDefinitions: vi.fn().mockReturnValue([]),
          callTool: yoBrowserCallTool
        }),
        getFilePresenter: () => ({
          getMimeType: vi.fn(),
          prepareFileCompletely: vi.fn()
        }),
        getLlmProviderPresenter: () => ({
          executeWithRateLimit: vi.fn().mockResolvedValue(undefined),
          generateCompletionStandalone: vi.fn(),
          generateImageStandalone: vi.fn()
        }),
        createSettingsWindow: vi.fn(),
        sendToWindow: vi.fn().mockReturnValue(true),
        getApprovedFilePaths: vi.fn().mockReturnValue([]),
        consumeSettingsApproval: vi.fn().mockReturnValue(false)
      } as any
    })
  })

  it('returns recoverable YoBrowser CDP failures as errored structured tool results', async () => {
    const browserStatus = {
      initialized: false,
      page: null,
      canGoBack: false,
      canGoForward: false,
      visible: false,
      loading: false
    }
    yoBrowserCallTool.mockRejectedValue(
      new YoBrowserUnavailableError(
        buildYoBrowserUnavailablePayload('session-a', 'Page.reload', browserStatus)
      )
    )

    const result = (await manager.callTool(
      'cdp_send',
      { method: 'Page.reload' },
      'session-a'
    )) as any
    const payload = JSON.parse(result.content)

    expect(result.rawData.isError).toBe(true)
    expect(payload).toMatchObject({
      ok: false,
      error: {
        code: 'yobrowser_unavailable',
        recoverable: true,
        sessionId: 'session-a',
        method: 'Page.reload',
        browserStatus
      }
    })
    expect(result.rawData.toolResult).toMatchObject({
      ok: false,
      data: payload,
      error: {
        code: 'yobrowser_unavailable',
        recoverable: true
      }
    })
  })
})
