import { beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import { AgentToolManager } from '@/tool/agentTools/agentToolManager'
import * as sessionVisionResolverModule from '@/agent/vision/sessionVisionResolver'
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
      if (name === 'userData') {
        return path.join(os.tmpdir(), 'deepchat-electron-user-data')
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

describe('AgentToolManager read routing', () => {
  let workspaceDir: string
  let providerSettings: any
  let manager: AgentToolManager
  let fileService: {
    getMimeType: ReturnType<typeof vi.fn>
    prepareFileCompletely: ReturnType<typeof vi.fn>
  }
  let providerRuntime: {
    executeWithRateLimit: ReturnType<typeof vi.fn>
    generateCompletionStandalone: ReturnType<typeof vi.fn>
    generateImageStandalone: ReturnType<typeof vi.fn>
  }
  let resolveConversationWorkdir: ReturnType<typeof vi.fn>
  let resolveConversationSessionInfo: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    vi.clearAllMocks()
    workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), 'deepchat-read-'))
    fileService = {
      getMimeType: vi.fn(),
      prepareFileCompletely: vi.fn()
    }
    providerRuntime = {
      executeWithRateLimit: vi.fn().mockResolvedValue(undefined),
      generateCompletionStandalone: vi.fn(),
      generateImageStandalone: vi.fn()
    }
    resolveConversationWorkdir = vi.fn().mockResolvedValue(workspaceDir)
    resolveConversationSessionInfo = vi.fn().mockResolvedValue({
      agentId: 'deepchat',
      providerId: 'openai',
      modelId: 'gpt-4'
    })
    providerSettings = {
      isKnownModel: vi.fn().mockReturnValue(true),
      getModelConfig: vi.fn().mockReturnValue({
        temperature: 0.2,
        maxTokens: 1200,
        vision: false
      }),
      resolveDeepChatAgentConfig: vi.fn().mockResolvedValue({})
    }
    manager = new AgentToolManager({
      skillSettings: { isEnabled: () => false } as any,
      settings: { get: vi.fn() },
      commandPermissionHandler: new CommandPermissionService(),
      agentWorkspacePath: workspaceDir,
      providerSettings,
      agentSettings: providerSettings,
      dependencies: createAgentToolDependencies({
        resolveConversationWorkdir,
        resolveConversationSessionInfo,
        skillService: {
          getActiveSkills: vi.fn().mockResolvedValue([]),
          getActiveSkillsAllowedTools: vi.fn().mockResolvedValue([]),
          listSkillScripts: vi.fn().mockResolvedValue([]),
          getSkillExtension: vi.fn().mockResolvedValue({
            version: 1,
            env: {},
            runtimePolicy: { python: 'auto', node: 'auto' },
            scriptOverrides: {}
          })
        } as any,
        browser: {
          getToolDefinitions: vi.fn().mockReturnValue([]),
          callTool: vi.fn()
        },
        fileService: fileService,
        providerRuntime: providerRuntime,
        createSettingsWindow: vi.fn(),
        sendToWindow: vi.fn().mockReturnValue(true),
        getApprovedFilePaths: vi.fn().mockReturnValue([]),
        consumeSettingsApproval: vi.fn().mockReturnValue(false)
      })
    })
  })

  it('uses raw read for text/code files', async () => {
    const filePath = path.join(workspaceDir, 'note.txt')
    await fs.writeFile(filePath, 'hello text', 'utf-8')
    fileService.getMimeType.mockResolvedValue('text/plain')

    const result = (await manager.callTool('read', { path: 'note.txt' }, 'conv1')) as {
      content: string
    }

    expect(result.content).toContain('note.txt')
    expect(result.content).toContain('hello text')
    expect(fileService.prepareFileCompletely).not.toHaveBeenCalled()
  })

  it('allows reading outside the workspace when external file access is enabled', async () => {
    const externalDir = await fs.mkdtemp(path.join(os.tmpdir(), 'deepchat-read-external-'))
    const externalFile = path.join(externalDir, 'outside.txt')
    await fs.writeFile(externalFile, 'external text', 'utf-8')
    fileService.getMimeType.mockResolvedValue('text/plain')

    const result = (await manager.callTool('read', { path: externalFile }, 'conv1', {
      allowExternalFileAccess: true
    })) as {
      content: string
    }

    expect(result.content).toContain('outside.txt')
    expect(result.content).toContain('external text')
  })

  it('requests permission for external reads in default access mode', async () => {
    const externalFile = path.join(path.parse(workspaceDir).root, 'deepchat-outside-default.txt')

    const permission = await manager.preCheckToolPermission('read', { path: externalFile }, 'conv1')

    expect(permission).toEqual(
      expect.objectContaining({
        needsPermission: true,
        permissionType: 'read',
        paths: [externalFile]
      })
    )
  })

  it('does not inherit the last synchronized workspace when session workdir lookup is empty', async () => {
    const otherWorkspace = await fs.mkdtemp(path.join(os.tmpdir(), 'deepchat-read-other-'))
    const otherFile = path.join(otherWorkspace, 'other-session.txt')
    await fs.writeFile(otherFile, 'other session', 'utf-8')
    manager.syncContext({ chatMode: 'agent', agentWorkspacePath: otherWorkspace })
    resolveConversationWorkdir.mockImplementation(async (conversationId: string) =>
      conversationId === 'session-a' ? null : otherWorkspace
    )

    const permission = await manager.preCheckToolPermission(
      'read',
      { path: otherFile },
      'session-a'
    )
    const resolvedOtherFile = await fs.realpath(otherFile)

    expect(permission).toEqual(
      expect.objectContaining({
        needsPermission: true,
        permissionType: 'read',
        paths: [resolvedOtherFile]
      })
    )
  })

  it('requests permission for workspace symlinks that point outside', async () => {
    const externalDir = await fs.mkdtemp(path.join(os.tmpdir(), 'deepchat-read-link-target-'))
    const externalFile = path.join(externalDir, 'outside.txt')
    const symlinkPath = path.join(workspaceDir, 'linked-outside.txt')
    await fs.writeFile(externalFile, 'external text', 'utf-8')

    try {
      await fs.symlink(externalFile, symlinkPath, 'file')
    } catch (error) {
      const errorCode =
        error instanceof Error && 'code' in error
          ? String((error as Error & { code?: string }).code)
          : ''
      if (['EPERM', 'EACCES', 'ENOTSUP', 'EINVAL'].includes(errorCode)) {
        return
      }
      throw error
    }

    const realExternalFile = await fs.realpath(externalFile)
    const permission = await manager.preCheckToolPermission(
      'read',
      { path: 'linked-outside.txt' },
      'conv1'
    )

    expect(permission).toEqual(
      expect.objectContaining({
        needsPermission: true,
        permissionType: 'read',
        paths: [realExternalFile]
      })
    )
  })

  it('does not request external read permission when full access is enabled', async () => {
    const externalFile = path.join(
      path.parse(workspaceDir).root,
      'deepchat-outside-full-access.txt'
    )

    const permission = await manager.preCheckToolPermission(
      'read',
      { path: externalFile },
      'conv1',
      {
        allowExternalFileAccess: true
      }
    )

    expect(permission).toBeNull()
  })

  it('allows writing outside the workspace when external file access is enabled', async () => {
    const externalDir = await fs.mkdtemp(path.join(os.tmpdir(), 'deepchat-write-external-'))
    const externalFile = path.join(externalDir, 'created.txt')

    const result = (await manager.callTool(
      'write',
      {
        path: externalFile,
        content: 'created outside'
      },
      'conv1',
      {
        allowExternalFileAccess: true
      }
    )) as {
      content: string
    }

    await expect(fs.readFile(externalFile, 'utf-8')).resolves.toBe('created outside')
    expect(result.content).toContain('Successfully wrote')
  })

  it('requests permission for new external writes without broadening to the parent directory', async () => {
    const externalFile = path.join(
      path.parse(workspaceDir).root,
      `deepchat-write-target-${Date.now()}.txt`
    )

    const permission = await manager.preCheckToolPermission(
      'write',
      {
        path: externalFile,
        content: 'created outside'
      },
      'conv1'
    )

    expect(permission).toEqual(
      expect.objectContaining({
        needsPermission: true,
        permissionType: 'write',
        paths: [externalFile]
      })
    )
  })

  it('uses fileService llm-friendly content for document files with offset/limit', async () => {
    const filePath = path.join(workspaceDir, 'report.pdf')
    await fs.writeFile(filePath, 'pdf-binary', 'utf-8')
    fileService.getMimeType.mockResolvedValue('application/pdf')
    fileService.prepareFileCompletely.mockResolvedValue({
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
    expect(fileService.prepareFileCompletely).toHaveBeenCalled()
  })

  it('prefers the current session model for image files when it supports vision', async () => {
    const filePath = path.join(workspaceDir, 'image.png')
    await fs.writeFile(filePath, Buffer.from([0, 1, 2, 3]))
    fileService.getMimeType.mockResolvedValue('image/png')
    resolveConversationSessionInfo.mockResolvedValue({
      agentId: 'deepchat',
      providerId: 'openai',
      modelId: 'gpt-4o'
    })
    providerSettings.getModelConfig.mockImplementation((modelId: string, providerId?: string) => ({
      temperature: 0.2,
      maxTokens: 1200,
      vision: providerId === 'openai' && modelId === 'gpt-4o'
    }))
    providerRuntime.generateCompletionStandalone.mockResolvedValue(
      'A detailed image description with visible text and layout.'
    )

    const result = (await manager.callTool('read', { path: 'image.png' }, 'conv1')) as {
      content: string
    }

    expect(result.content).toContain('detailed image description')
    expect(providerRuntime.executeWithRateLimit).toHaveBeenCalledWith('openai')
    expect(providerRuntime.generateCompletionStandalone).toHaveBeenCalled()
    expect(providerRuntime.generateCompletionStandalone).toHaveBeenCalledWith(
      'openai',
      expect.any(Array),
      'gpt-4o',
      expect.any(Number),
      expect.any(Number)
    )
    expect(providerSettings.resolveDeepChatAgentConfig).not.toHaveBeenCalled()
  })

  it('falls back to the agent vision model when the current model has no vision', async () => {
    const filePath = path.join(workspaceDir, 'image-agent-vision.png')
    await fs.writeFile(filePath, Buffer.from([3, 2, 1, 0]))
    fileService.getMimeType.mockResolvedValue('image/png')
    resolveConversationSessionInfo.mockResolvedValue({
      agentId: 'agent-vision',
      providerId: 'openai',
      modelId: 'gpt-4.1'
    })
    providerSettings.resolveDeepChatAgentConfig.mockResolvedValue({
      visionModel: { providerId: 'anthropic', modelId: 'claude-3-7-sonnet' }
    })
    providerRuntime.generateCompletionStandalone.mockResolvedValue(
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
    expect(providerSettings.resolveDeepChatAgentConfig).toHaveBeenCalledWith('agent-vision')
    expect(providerRuntime.executeWithRateLimit).toHaveBeenCalledWith('anthropic')
    expect(providerRuntime.generateCompletionStandalone).toHaveBeenCalledWith(
      'anthropic',
      expect.any(Array),
      'claude-3-7-sonnet',
      expect.any(Number),
      expect.any(Number)
    )
  })

  it('propagates abort signals to queued image analysis waits', async () => {
    const filePath = path.join(workspaceDir, 'image-abort.png')
    await fs.writeFile(filePath, Buffer.from([4, 3, 2, 1]))
    fileService.getMimeType.mockResolvedValue('image/png')
    resolveConversationSessionInfo.mockResolvedValue({
      agentId: 'deepchat',
      providerId: 'openai',
      modelId: 'gpt-4o'
    })
    providerSettings.getModelConfig.mockImplementation((modelId: string, providerId?: string) => ({
      temperature: 0.2,
      maxTokens: 1200,
      vision: providerId === 'openai' && modelId === 'gpt-4o'
    }))

    const abortController = new AbortController()
    const abortError = new Error('Aborted')
    abortError.name = 'AbortError'
    let queuedResolve!: () => void
    const queued = new Promise<void>((resolve) => {
      queuedResolve = resolve
    })

    providerRuntime.executeWithRateLimit.mockImplementation(
      async (_providerId: string, options?: { signal?: AbortSignal }) =>
        await new Promise<void>((_resolve, reject) => {
          queuedResolve()

          if (options?.signal?.aborted) {
            reject(abortError)
            return
          }

          options?.signal?.addEventListener(
            'abort',
            () => {
              reject(abortError)
            },
            { once: true }
          )
        })
    )

    const resultPromise = manager.callTool('read', { path: 'image-abort.png' }, 'conv1', {
      signal: abortController.signal
    })
    await queued
    abortController.abort()

    await expect(resultPromise).rejects.toMatchObject({ name: 'AbortError' })
    expect(providerRuntime.executeWithRateLimit).toHaveBeenCalledWith(
      'openai',
      expect.objectContaining({
        signal: abortController.signal
      })
    )
    expect(providerRuntime.generateCompletionStandalone).not.toHaveBeenCalled()
  })

  it('passes abort signals into vision target resolution', async () => {
    const filePath = path.join(workspaceDir, 'image-resolver-signal.png')
    await fs.writeFile(filePath, Buffer.from([4, 5, 6, 7]))
    fileService.getMimeType.mockResolvedValue('image/png')
    resolveConversationSessionInfo.mockResolvedValue({
      agentId: 'deepchat',
      providerId: 'openai',
      modelId: 'gpt-4o'
    })
    providerSettings.getModelConfig.mockImplementation((modelId: string, providerId?: string) => ({
      temperature: 0.2,
      maxTokens: 1200,
      vision: providerId === 'openai' && modelId === 'gpt-4o'
    }))
    providerRuntime.generateCompletionStandalone.mockResolvedValue('visible image description')
    const resolveVisionTargetSpy = vi.spyOn(
      sessionVisionResolverModule,
      'resolveSessionVisionTarget'
    )
    const abortController = new AbortController()

    await manager.callTool('read', { path: 'image-resolver-signal.png' }, 'conv1', {
      signal: abortController.signal
    })

    expect(resolveVisionTargetSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        signal: abortController.signal,
        logLabel: 'read:conv1'
      })
    )
  })

  it('falls back to image metadata when neither the current model nor the agent can analyze images', async () => {
    const filePath = path.join(workspaceDir, 'image-no-vision.png')
    await fs.writeFile(filePath, Buffer.from([9, 8, 7, 6]))
    fileService.getMimeType.mockResolvedValue('image/png')
    resolveConversationSessionInfo.mockResolvedValue({
      agentId: 'deepchat',
      providerId: 'openai',
      modelId: 'gpt-4.1'
    })
    providerSettings.resolveDeepChatAgentConfig.mockResolvedValue({})

    const result = (await manager.callTool('read', { path: 'image-no-vision.png' }, 'conv1')) as {
      content: string
    }

    expect(result.content).toContain('[Image Metadata]')
    expect(result.content).toContain('neither the current session model nor the agent vision model')
    expect(providerRuntime.executeWithRateLimit).not.toHaveBeenCalled()
  })

  it('falls back to image metadata when the conversation cannot be found', async () => {
    const filePath = path.join(workspaceDir, 'image-missing-conversation.png')
    await fs.writeFile(filePath, Buffer.from([6, 7, 8, 9]))
    fileService.getMimeType.mockResolvedValue('image/png')
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
    expect(providerRuntime.executeWithRateLimit).not.toHaveBeenCalled()
  })

  it('surfaces runtime errors while resolving the conversation vision target', async () => {
    const filePath = path.join(workspaceDir, 'image-session-error.png')
    await fs.writeFile(filePath, Buffer.from([1, 2, 3, 4]))
    fileService.getMimeType.mockResolvedValue('image/png')
    resolveConversationSessionInfo.mockRejectedValueOnce(new Error('session store offline'))

    await expect(
      manager.callTool('read', { path: 'image-session-error.png' }, 'conv1')
    ).rejects.toThrow('session store offline')
  })

  it('rejects non-text binary reads without polluting prompt context', async () => {
    const filePath = path.join(workspaceDir, 'archive.zip')
    await fs.writeFile(filePath, Buffer.from([0x50, 0x4b, 0x03, 0x04]))
    fileService.getMimeType.mockResolvedValue('application/zip')

    const result = (await manager.callTool('read', { path: 'archive.zip' }, 'conv1')) as {
      content: string
    }

    expect(result.content).toContain('Cannot read "archive.zip" as plain text')
    expect(result.content).toContain('conversion/extraction tool or skill script')
    expect(fileService.prepareFileCompletely).not.toHaveBeenCalled()
  })
})
