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
    getPath: () => os.tmpdir()
  },
  nativeImage: {
    createFromPath: () => ({
      getSize: () => ({ width: 128, height: 96 })
    })
  }
}))

describe('AgentToolManager read routing', () => {
  let workspaceDir: string
  let configPresenter: any
  let manager: AgentToolManager
  let filePresenter: {
    getMimeType: ReturnType<typeof vi.fn>
    prepareFileCompletely: ReturnType<typeof vi.fn>
  }
  let llmProviderPresenter: {
    generateCompletionStandalone: ReturnType<typeof vi.fn>
  }
  let resolveConversationWorkdir: ReturnType<typeof vi.fn>
  let resolveConversationSessionInfo: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    vi.clearAllMocks()
    workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), 'deepchat-read-'))
    filePresenter = {
      getMimeType: vi.fn(),
      prepareFileCompletely: vi.fn()
    }
    llmProviderPresenter = {
      generateCompletionStandalone: vi.fn()
    }
    resolveConversationWorkdir = vi.fn().mockResolvedValue(null)
    resolveConversationSessionInfo = vi.fn().mockResolvedValue({
      agentId: 'deepchat',
      providerId: 'openai',
      modelId: 'gpt-4'
    })
    configPresenter = {
      getSkillsEnabled: () => false,
      getSkillsPath: () => workspaceDir,
      isKnownModel: vi.fn().mockReturnValue(true),
      getModelConfig: vi.fn().mockReturnValue({
        temperature: 0.2,
        maxTokens: 1200,
        vision: false
      }),
      resolveDeepChatAgentConfig: vi.fn().mockResolvedValue({})
    }
    manager = new AgentToolManager({
      agentWorkspacePath: workspaceDir,
      configPresenter,
      runtimePort: {
        resolveConversationWorkdir,
        resolveConversationSessionInfo,
        getSkillPresenter: () =>
          ({
            getActiveSkills: vi.fn().mockResolvedValue([]),
            getActiveSkillsAllowedTools: vi.fn().mockResolvedValue([]),
            listSkillScripts: vi.fn().mockResolvedValue([]),
            getSkillExtension: vi.fn().mockResolvedValue({
              version: 1,
              env: {},
              runtimePolicy: { python: 'auto', node: 'auto' },
              scriptOverrides: {}
            })
          }) as any,
        getYoBrowserToolHandler: () => ({
          getToolDefinitions: vi.fn().mockReturnValue([]),
          callTool: vi.fn()
        }),
        getFilePresenter: () => filePresenter,
        getLlmProviderPresenter: () => llmProviderPresenter,
        createSettingsWindow: vi.fn(),
        sendToWindow: vi.fn().mockReturnValue(true),
        getApprovedFilePaths: vi.fn().mockReturnValue([]),
        consumeSettingsApproval: vi.fn().mockReturnValue(false)
      }
    })
  })

  it('uses raw read for text/code files', async () => {
    const filePath = path.join(workspaceDir, 'note.txt')
    await fs.writeFile(filePath, 'hello text', 'utf-8')
    filePresenter.getMimeType.mockResolvedValue('text/plain')

    const result = (await manager.callTool('read', { path: 'note.txt' }, 'conv1')) as {
      content: string
    }

    expect(result.content).toContain('note.txt')
    expect(result.content).toContain('hello text')
    expect(filePresenter.prepareFileCompletely).not.toHaveBeenCalled()
  })

  it('uses filePresenter llm-friendly content for document files with offset/limit', async () => {
    const filePath = path.join(workspaceDir, 'report.pdf')
    await fs.writeFile(filePath, 'pdf-binary', 'utf-8')
    filePresenter.getMimeType.mockResolvedValue('application/pdf')
    filePresenter.prepareFileCompletely.mockResolvedValue({
      content: 'ABCDEFGH'
    })

    const result = (await manager.callTool(
      'read',
      { path: 'report.pdf', offset: 2, limit: 3 },
      'conv1'
    )) as {
      content: string
    }

    expect(result.content).toContain('chars 2-5')
    expect(result.content).toContain('CDE')
    expect(filePresenter.prepareFileCompletely).toHaveBeenCalled()
  })

  it('prefers the current session model for image files when it supports vision', async () => {
    const filePath = path.join(workspaceDir, 'image.png')
    await fs.writeFile(filePath, Buffer.from([0, 1, 2, 3]))
    filePresenter.getMimeType.mockResolvedValue('image/png')
    resolveConversationSessionInfo.mockResolvedValue({
      agentId: 'deepchat',
      providerId: 'openai',
      modelId: 'gpt-4o'
    })
    configPresenter.getModelConfig.mockImplementation((modelId: string, providerId?: string) => ({
      temperature: 0.2,
      maxTokens: 1200,
      vision: providerId === 'openai' && modelId === 'gpt-4o'
    }))
    llmProviderPresenter.generateCompletionStandalone.mockResolvedValue(
      'A detailed image description with visible text and layout.'
    )

    const result = (await manager.callTool('read', { path: 'image.png' }, 'conv1')) as {
      content: string
    }

    expect(result.content).toContain('detailed image description')
    expect(llmProviderPresenter.generateCompletionStandalone).toHaveBeenCalled()
    expect(llmProviderPresenter.generateCompletionStandalone).toHaveBeenCalledWith(
      'openai',
      expect.any(Array),
      'gpt-4o',
      expect.any(Number),
      expect.any(Number)
    )
    expect(configPresenter.resolveDeepChatAgentConfig).not.toHaveBeenCalled()
  })

  it('falls back to the agent vision model when the current model has no vision', async () => {
    const filePath = path.join(workspaceDir, 'image-agent-vision.png')
    await fs.writeFile(filePath, Buffer.from([3, 2, 1, 0]))
    filePresenter.getMimeType.mockResolvedValue('image/png')
    resolveConversationSessionInfo.mockResolvedValue({
      agentId: 'agent-vision',
      providerId: 'openai',
      modelId: 'gpt-4.1'
    })
    configPresenter.resolveDeepChatAgentConfig.mockResolvedValue({
      visionModel: { providerId: 'anthropic', modelId: 'claude-3-7-sonnet' }
    })
    llmProviderPresenter.generateCompletionStandalone.mockResolvedValue(
      'A fallback image description generated by the agent vision model.'
    )

    const result = (await manager.callTool(
      'read',
      { path: 'image-agent-vision.png' },
      'conv1'
    )) as {
      content: string
    }

    expect(result.content).toContain('fallback image description')
    expect(configPresenter.resolveDeepChatAgentConfig).toHaveBeenCalledWith('agent-vision')
    expect(llmProviderPresenter.generateCompletionStandalone).toHaveBeenCalledWith(
      'anthropic',
      expect.any(Array),
      'claude-3-7-sonnet',
      expect.any(Number),
      expect.any(Number)
    )
  })

  it('falls back to image metadata when neither the current model nor the agent can analyze images', async () => {
    const filePath = path.join(workspaceDir, 'image-no-vision.png')
    await fs.writeFile(filePath, Buffer.from([9, 8, 7, 6]))
    filePresenter.getMimeType.mockResolvedValue('image/png')
    resolveConversationSessionInfo.mockResolvedValue({
      agentId: 'deepchat',
      providerId: 'openai',
      modelId: 'gpt-4.1'
    })
    configPresenter.resolveDeepChatAgentConfig.mockResolvedValue({})

    const result = (await manager.callTool('read', { path: 'image-no-vision.png' }, 'conv1')) as {
      content: string
    }

    expect(result.content).toContain('[Image Metadata]')
    expect(result.content).toContain('neither the current session model nor the agent vision model')
  })

  it('falls back to image metadata when the conversation cannot be found', async () => {
    const filePath = path.join(workspaceDir, 'image-missing-conversation.png')
    await fs.writeFile(filePath, Buffer.from([6, 7, 8, 9]))
    filePresenter.getMimeType.mockResolvedValue('image/png')
    resolveConversationSessionInfo.mockRejectedValueOnce(new Error('Conversation conv1 not found'))

    const result = (await manager.callTool(
      'read',
      { path: 'image-missing-conversation.png' },
      'conv1'
    )) as {
      content: string
    }

    expect(result.content).toContain('[Image Metadata]')
    expect(result.content).toContain('neither the current session model nor the agent vision model')
  })

  it('surfaces runtime errors while resolving the conversation vision target', async () => {
    const filePath = path.join(workspaceDir, 'image-session-error.png')
    await fs.writeFile(filePath, Buffer.from([1, 2, 3, 4]))
    filePresenter.getMimeType.mockResolvedValue('image/png')
    resolveConversationSessionInfo.mockRejectedValueOnce(new Error('session store offline'))

    await expect(
      manager.callTool('read', { path: 'image-session-error.png' }, 'conv1')
    ).rejects.toThrow('session store offline')
  })

  it('rejects non-text binary reads without polluting prompt context', async () => {
    const filePath = path.join(workspaceDir, 'archive.zip')
    await fs.writeFile(filePath, Buffer.from([0x50, 0x4b, 0x03, 0x04]))
    filePresenter.getMimeType.mockResolvedValue('application/zip')

    const result = (await manager.callTool('read', { path: 'archive.zip' }, 'conv1')) as {
      content: string
    }

    expect(result.content).toContain('Cannot read "archive.zip" as plain text')
    expect(result.content).toContain('conversion/extraction tool or skill script')
    expect(filePresenter.prepareFileCompletely).not.toHaveBeenCalled()
  })
})
