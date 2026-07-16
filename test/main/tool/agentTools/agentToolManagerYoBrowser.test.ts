import { beforeEach, describe, expect, it, vi } from 'vitest'
import os from 'os'
import { AgentToolManager } from '@/tool/agentTools/agentToolManager'
import { YoBrowserUnavailableError, buildYoBrowserUnavailablePayload } from '@/tool/browser/errors'
import { createAgentToolDependencies } from './agentToolDependencies'
import { CommandPermissionService } from '@/tool/permission'

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
      skillSettings: { isEnabled: () => false } as any,
      settings: { get: vi.fn() },
      commandPermissionHandler: new CommandPermissionService(),
      agentWorkspacePath: null,
      agentSettings: {
        resolveDeepChatAgentConfig: vi.fn().mockResolvedValue({})
      } as any,
      providerSettings: {
        getModelConfig: vi.fn(),
        resolveDeepChatAgentConfig: vi.fn().mockResolvedValue({})
      } as any,
      dependencies: createAgentToolDependencies({
        resolveConversationWorkdir: vi.fn().mockResolvedValue(null),
        resolveConversationSessionInfo: vi.fn().mockResolvedValue(null),
        skillService: {
          getActiveSkills: vi.fn().mockResolvedValue([]),
          getActiveSkillsAllowedTools: vi.fn().mockResolvedValue([]),
          listSkillScripts: vi.fn().mockResolvedValue([]),
          getSkillExtension: vi.fn()
        } as any,
        browser: {
          getToolDefinitions: vi.fn().mockReturnValue([]),
          callTool: yoBrowserCallTool
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
