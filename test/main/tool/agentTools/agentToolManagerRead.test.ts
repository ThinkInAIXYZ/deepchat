import { beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync } from 'fs'
import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import { AgentToolManager } from '@/tool/agentTools/agentToolManager'
import { AgentBashHandler } from '@/tool/agentTools/agentBashHandler'
import { backgroundExecSessionManager } from '@/agent/shared/process/backgroundExecSessionManager'
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
          getSkillsDir: vi.fn().mockResolvedValue(path.join(os.tmpdir(), 'deepchat-skills')),
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

  it('declares filesystem execution contracts at the definition owner', async () => {
    const definitions = await manager.getAllToolDefinitions({
      chatMode: 'agent',
      supportsVision: false,
      agentWorkspacePath: workspaceDir,
      conversationId: 'conv1'
    })
    const filesystemContracts = Object.fromEntries(
      definitions
        .filter((definition) => definition.server.name === 'agent-filesystem')
        .map(({ function: { name }, execution }) => [name, execution])
    )

    expect(filesystemContracts).toEqual({
      read: { effect: 'read', mode: 'parallel' },
      write: { effect: 'write', mode: 'sequential' },
      edit: { effect: 'write', mode: 'sequential' },
      glob: { effect: 'read', mode: 'sequential' },
      grep: { effect: 'read', mode: 'sequential' },
      exec: { effect: 'write', mode: 'sequential' },
      process: { effect: 'write', mode: 'sequential' }
    })
  })

  it('commits process mutations after local validation and before the utility target', async () => {
    const order: string[] = []
    const write = vi
      .spyOn(backgroundExecSessionManager, 'write')
      .mockImplementation(async (_conversationId, _sessionId, _data, _eof, beforeMutation) => {
        beforeMutation?.()
        order.push('target')
      })
    const commitDispatch = vi.fn((input) => {
      order.push('commit')
      expect(input).toEqual({
        toolName: 'process',
        toolSource: 'agent',
        normalizedArguments: {
          action: 'write',
          sessionId: 'bg-session',
          data: 'continue',
          eof: true
        },
        target: { serverName: 'agent-filesystem', originalName: 'process' }
      })
    })

    try {
      await manager.callTool(
        'process',
        { action: 'write', sessionId: 'bg-session', data: 'continue', eof: true },
        'conv1',
        { commitDispatch }
      )

      expect(order).toEqual(['commit', 'target'])

      const invalidCommit = vi.fn()
      await expect(
        manager.callTool('process', { action: 'write' }, 'conv1', {
          commitDispatch: invalidCommit
        })
      ).rejects.toThrow('sessionId is required for write action')
      expect(invalidCommit).not.toHaveBeenCalled()

      write.mockClear()
      order.splice(0)
      const journalError = new Error('journal unavailable')
      await expect(
        manager.callTool(
          'process',
          { action: 'write', sessionId: 'bg-session', data: 'blocked' },
          'conv1',
          {
            commitDispatch: () => {
              throw journalError
            }
          }
        )
      ).rejects.toBe(journalError)
      expect(write).toHaveBeenCalledOnce()
      expect(order).toEqual([])
    } finally {
      write.mockRestore()
    }
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

  it.each([
    [
      'UTF-16LE',
      '.tmp-change-le.diff',
      Buffer.from(`\uFEFFdiff --git a/file.ts b/file.ts\n+const value = 1\n`, 'utf16le')
    ],
    [
      'UTF-16BE',
      '.tmp-change-be.diff',
      Buffer.from(`\uFEFFdiff --git a/file.ts b/file.ts\n+const value = 1\n`, 'utf16le').swap16()
    ],
    [
      'UTF-8 BOM',
      '.tmp-change-utf8.diff',
      Buffer.concat([
        Buffer.from([0xef, 0xbb, 0xbf]),
        Buffer.from(`diff --git a/file.ts b/file.ts\n+const value = 1\n`, 'utf8')
      ])
    ]
  ])('reads %s code files reported as application/octet-stream', async (_encoding, name, bytes) => {
    const filePath = path.join(workspaceDir, name)
    await fs.writeFile(filePath, bytes)
    fileService.getMimeType.mockResolvedValue('application/octet-stream')

    const result = (await manager.callTool('read', { path: name }, 'conv1')) as {
      content: string
    }

    expect(result.content).toContain('diff --git a/file.ts b/file.ts')
    expect(result.content).toContain('+const value = 1')
    expect(result.content).not.toContain('\uFEFF')
    expect(result.content).not.toContain('\u0000')
    expect(fileService.prepareFileCompletely).not.toHaveBeenCalled()
  })

  it('uses the Agent auto-truncate limit while preserving an explicit read limit', async () => {
    const filePath = path.join(workspaceDir, 'large-note.txt')
    await fs.writeFile(filePath, 'x'.repeat(1_500), 'utf-8')
    fileService.getMimeType.mockResolvedValue('text/plain')
    providerSettings.resolveDeepChatAgentConfig.mockResolvedValue({
      readFileAutoTruncateChars: 1_000
    })

    const automatic = (await manager.callTool('read', { path: 'large-note.txt' }, 'conv1')) as {
      content: string
    }
    const explicit = (await manager.callTool(
      'read',
      { path: 'large-note.txt', limit: 1_200 },
      'conv1'
    )) as { content: string }

    expect(automatic.content).toContain('chars 0-1000 of 1500')
    expect(automatic.content).toContain('auto-truncated')
    expect(explicit.content).toContain('chars 0-1200 of 1500')
    expect(explicit.content).not.toContain('auto-truncated')
  })

  it('passes the Agent command preview limit into exec', async () => {
    providerSettings.resolveDeepChatAgentConfig.mockResolvedValue({
      commandOutputInlineChars: 7_000
    })
    const executeCommand = vi
      .spyOn(AgentBashHandler.prototype, 'executeCommand')
      .mockResolvedValue({
        output: 'ok\nExit Code: 0',
        rtkApplied: false,
        rtkMode: 'bypass'
      })

    try {
      const result = (await manager.callTool(
        'exec',
        { command: 'printf ok', description: 'Print text' },
        'conv1'
      )) as { content: string }

      expect(executeCommand).toHaveBeenCalledWith(
        expect.objectContaining({ command: 'printf ok' }),
        expect.objectContaining({ conversationId: 'conv1', outputPreviewChars: 7_000 })
      )
      expect(result.content).toContain('ok')
    } finally {
      executeCommand.mockRestore()
    }
  })

  it('uses the current Agent command preview limit when polling a process', async () => {
    providerSettings.resolveDeepChatAgentConfig.mockResolvedValue({
      commandOutputInlineChars: 7_000
    })
    const poll = vi.spyOn(backgroundExecSessionManager, 'poll').mockResolvedValue({
      status: 'running',
      output: 'tail'
    })

    await manager.callTool('process', { action: 'poll', sessionId: 'bg_1' }, 'conv1')

    expect(poll).toHaveBeenCalledWith('conv1', 'bg_1', 7_000)
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

  it('commits a resolved write dispatch immediately before filesystem mutation', async () => {
    const targetPath = path.join(workspaceDir, 'journaled-write.txt')
    const commitDispatch = vi.fn((input) => {
      expect(existsSync(targetPath)).toBe(false)
      expect(input).toEqual({
        toolName: 'write',
        toolSource: 'agent',
        normalizedArguments: {
          path: 'journaled-write.txt',
          content: 'journaled content'
        },
        target: { serverName: 'agent-filesystem', originalName: 'write' }
      })
    })

    await manager.callTool(
      'write',
      { path: 'journaled-write.txt', content: 'journaled content' },
      'conv1',
      { commitDispatch }
    )

    expect(commitDispatch).toHaveBeenCalledOnce()
    await expect(fs.readFile(targetPath, 'utf-8')).resolves.toBe('journaled content')
  })

  it('prevents filesystem mutation when the dispatch commit fails', async () => {
    const targetPath = path.join(workspaceDir, 'blocked-write.txt')
    const journalError = new Error('journal unavailable')
    const commitDispatch = vi.fn(() => {
      throw journalError
    })

    await expect(
      manager.callTool(
        'write',
        { path: 'blocked-write.txt', content: 'must not be written' },
        'conv1',
        { commitDispatch }
      )
    ).rejects.toBe(journalError)

    expect(commitDispatch).toHaveBeenCalledOnce()
    expect(existsSync(targetPath)).toBe(false)
  })

  it('does not claim a dispatch for invalid writes or plain file reads', async () => {
    const filePath = path.join(workspaceDir, 'plain-read.txt')
    await fs.writeFile(filePath, 'read only', 'utf-8')
    fileService.getMimeType.mockResolvedValue('text/plain')
    const commitDispatch = vi.fn()

    await expect(
      manager.callTool('write', { path: 'missing-content.txt' }, 'conv1', { commitDispatch })
    ).rejects.toThrow('Invalid arguments')
    await manager.callTool('read', { path: 'plain-read.txt' }, 'conv1', { commitDispatch })

    expect(commitDispatch).not.toHaveBeenCalled()
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

  it('uses the Agent auto-truncate limit for prepared document content', async () => {
    const filePath = path.join(workspaceDir, 'large-report.pdf')
    await fs.writeFile(filePath, 'pdf-binary', 'utf-8')
    fileService.getMimeType.mockResolvedValue('application/pdf')
    fileService.prepareFileCompletely.mockResolvedValue({ content: 'x'.repeat(1_500) })
    providerSettings.resolveDeepChatAgentConfig.mockResolvedValue({
      readFileAutoTruncateChars: 1_100
    })

    const result = (await manager.callTool('read', { path: 'large-report.pdf' }, 'conv1')) as {
      content: string
    }

    expect(result.content).toContain('chars 0-1100 of 1500')
    expect(result.content).toContain('auto-truncated')
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

  it('propagates vision dispatch commit failure without invoking the provider', async () => {
    const filePath = path.join(workspaceDir, 'image-journal-failure.png')
    await fs.writeFile(filePath, Buffer.from([0, 1, 2, 3]))
    const resolvedFilePath = await fs.realpath(filePath)
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
    const journalError = new Error('journal unavailable')
    const commitDispatch = vi.fn((input) => {
      expect(input).toEqual({
        toolName: 'read',
        toolSource: 'agent',
        normalizedArguments: {
          path: resolvedFilePath,
          mimeType: 'image/png',
          providerId: 'openai',
          modelId: 'gpt-4o'
        },
        target: { serverName: 'agent-filesystem', originalName: 'read' }
      })
      throw journalError
    })

    await expect(
      manager.callTool('read', { path: 'image-journal-failure.png' }, 'conv1', {
        commitDispatch
      })
    ).rejects.toBe(journalError)

    expect(commitDispatch).toHaveBeenCalledOnce()
    expect(providerRuntime.generateCompletionStandalone).not.toHaveBeenCalled()
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
