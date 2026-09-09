import { beforeEach, describe, expect, it, vi } from 'vitest'
import os from 'os'
import { AgentToolManager } from '@/tool/agentTools/agentToolManager'
import { IMAGE_GENERATE_TOOL_NAME } from '@/tool/agentTools/agentImageGenerationTool'
import { ApiEndpointType, ModelType } from '@shared/model'
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

describe('Agent image generation tool', () => {
  let providerSettings: any
  let generateImageStandalone: ReturnType<typeof vi.fn>
  let resolveConversationSessionInfo: ReturnType<typeof vi.fn>
  let manager: AgentToolManager

  const buildManager = (cacheImage?: (data: string) => Promise<string>) =>
    new AgentToolManager({
      skillSettings: { isEnabled: () => false } as any,
      settings: { get: vi.fn() },
      commandPermissionHandler: new CommandPermissionService(),
      agentWorkspacePath: null,
      providerSettings,
      agentSettings: providerSettings,
      dependencies: createAgentToolDependencies({
        resolveConversationWorkdir: vi.fn().mockResolvedValue(null),
        resolveConversationSessionInfo,
        skillService: {
          getActiveSkills: vi.fn().mockResolvedValue([]),
          getActiveSkillsAllowedTools: vi.fn().mockResolvedValue([]),
          listSkillScripts: vi.fn().mockResolvedValue([]),
          getSkillExtension: vi.fn()
        } as any,
        browser: {
          getToolDefinitions: vi.fn().mockReturnValue([]),
          callTool: vi.fn()
        },
        fileService: {
          getMimeType: vi.fn(),
          prepareFileCompletely: vi.fn()
        },
        providerRuntime: {
          executeWithRateLimit: vi.fn().mockResolvedValue(undefined),
          generateCompletionStandalone: vi.fn(),
          generateImageStandalone
        },
        createSettingsWindow: vi.fn(),
        sendToWindow: vi.fn().mockReturnValue(true),
        getApprovedFilePaths: vi.fn().mockReturnValue([]),
        consumeSettingsApproval: vi.fn().mockReturnValue(false),
        ...(cacheImage ? { cacheImage } : {})
      })
    })

  beforeEach(() => {
    vi.clearAllMocks()
    generateImageStandalone = vi.fn()
    resolveConversationSessionInfo = vi.fn().mockResolvedValue({
      agentId: 'deepchat',
      agentType: 'deepchat'
    })
    providerSettings = {
      resolveDeepChatAgentConfig: vi.fn().mockResolvedValue({
        imageGenerationModel: { providerId: 'openai', modelId: 'gpt-image-1' }
      }),
      getModelConfig: vi.fn().mockReturnValue({
        type: ModelType.ImageGeneration,
        apiEndpoint: ApiEndpointType.Image,
        vision: false,
        functionCall: false,
        reasoning: false,
        maxTokens: 1024,
        contextLength: 4096
      })
    }
    manager = buildManager()
  })

  it('shows image_generate in settings context without a conversation', async () => {
    const defs = await manager.getAllToolDefinitions({
      chatMode: 'agent',
      supportsVision: false,
      agentWorkspacePath: null
    })

    expect(defs.some((tool) => tool.function.name === IMAGE_GENERATE_TOOL_NAME)).toBe(true)
  })

  it('only shows image_generate in a session with an image generation model', async () => {
    let defs = await manager.getAllToolDefinitions({
      chatMode: 'agent',
      supportsVision: false,
      agentWorkspacePath: null,
      conversationId: 'conv-1'
    })

    expect(defs.some((tool) => tool.function.name === IMAGE_GENERATE_TOOL_NAME)).toBe(true)

    providerSettings.resolveDeepChatAgentConfig.mockResolvedValueOnce({})
    defs = await manager.getAllToolDefinitions({
      chatMode: 'agent',
      supportsVision: false,
      agentWorkspacePath: null,
      conversationId: 'conv-2'
    })

    expect(defs.some((tool) => tool.function.name === IMAGE_GENERATE_TOOL_NAME)).toBe(false)
  })

  it('generates image previews without putting image data into tool content', async () => {
    generateImageStandalone.mockResolvedValue({
      providerId: 'openai',
      modelId: 'gpt-image-1',
      options: { size: '1024x1024' },
      images: [{ data: 'imgcache://generated.png', mimeType: 'image/png' }]
    })

    const result = (await manager.callTool(
      IMAGE_GENERATE_TOOL_NAME,
      { prompt: 'A warm sunset over the ocean', size: '1024x1024' },
      'conv-1'
    )) as any

    expect(generateImageStandalone).toHaveBeenCalledWith(
      'openai',
      'A warm sunset over the ocean',
      'gpt-image-1',
      { size: '1024x1024' },
      { signal: undefined }
    )
    expect(result.rawData.imagePreviews).toEqual([
      {
        id: 'generated-image-1',
        data: 'imgcache://generated.png',
        mimeType: 'image/png',
        title: 'Generated image 1',
        source: 'tool_output'
      }
    ])
    expect(result.content).not.toContain('imgcache://generated.png')
    expect(result.rawData.toolResult.ok).toBe(true)
  })

  it.each(['aGVsbG8=', 'DATA:IMAGE/PNG;BASE64,aGVsbG8='])(
    'caches generated image data without corrupting %s',
    async (data) => {
      const cacheImage = vi.fn().mockResolvedValue('imgcache://cached.png')
      manager = buildManager(cacheImage)
      generateImageStandalone.mockResolvedValue({
        providerId: 'openai',
        modelId: 'gpt-image-1',
        images: [{ data, mimeType: 'image/png' }]
      })

      const result = (await manager.callTool(
        IMAGE_GENERATE_TOOL_NAME,
        { prompt: 'A warm sunset over the ocean' },
        'conv-1'
      )) as any

      expect(cacheImage).toHaveBeenCalledWith(
        data.includes(':') ? data : `data:image/png;base64,${data}`,
        {
          signal: undefined,
          allowPrivateNetwork: false
        }
      )
      expect(result.rawData.imagePreviews).toEqual([
        {
          id: 'generated-image-1',
          data: 'imgcache://cached.png',
          mimeType: 'image/png',
          title: 'Generated image 1',
          source: 'tool_output'
        }
      ])
      expect(result.rawData.toolResult.ok).toBe(true)
    }
  )

  it('fails the tool call when a generated HTTP image URL cannot be cached', async () => {
    manager = buildManager(vi.fn(async (data: string) => data))
    generateImageStandalone.mockResolvedValue({
      providerId: 'openai',
      modelId: 'gpt-image-1',
      images: [{ data: 'https://example.com/generated.png', mimeType: 'image/png' }]
    })

    const result = (await manager.callTool(
      IMAGE_GENERATE_TOOL_NAME,
      { prompt: 'A warm sunset over the ocean' },
      'conv-1'
    )) as any

    expect(result.rawData.isError).toBe(true)
    expect(result.rawData.toolResult.error).toMatchObject({
      code: 'IMAGE_GENERATION_FAILED',
      recoverable: true
    })
  })

  it('caches generated HTTP image URLs with private-network access disabled', async () => {
    const cacheImage = vi.fn().mockResolvedValue('imgcache://cached.png')
    manager = buildManager(cacheImage)
    generateImageStandalone.mockResolvedValue({
      providerId: 'openai',
      modelId: 'gpt-image-1',
      images: [{ data: 'https://example.com/generated.png', mimeType: 'image/png' }]
    })

    const result = (await manager.callTool(
      IMAGE_GENERATE_TOOL_NAME,
      { prompt: 'A warm sunset over the ocean' },
      'conv-1'
    )) as any

    expect(cacheImage).toHaveBeenCalledWith('https://example.com/generated.png', {
      signal: undefined,
      allowPrivateNetwork: false
    })
    expect(result.rawData.imagePreviews).toEqual([
      {
        id: 'generated-image-1',
        data: 'imgcache://cached.png',
        mimeType: 'image/png',
        title: 'Generated image 1',
        source: 'tool_output'
      }
    ])
    expect(result.rawData.toolResult.ok).toBe(true)
  })

  it.each(['data:image/png;base64,', 'DATA:IMAGE/PNG;BASE64,'])(
    'rejects oversized encoded payloads with prefix %s',
    async (prefix) => {
      manager = buildManager(vi.fn(async (data: string) => data))
      // Encoded character length is just above the 2 MiB limit while the decoded payload is only
      // ~1.5 MiB — the limit is enforced on the encoded base64 payload, not decoded byte size.
      const payload = 'A'.repeat(2 * 1024 * 1024 + 1)
      generateImageStandalone.mockResolvedValue({
        providerId: 'openai',
        modelId: 'gpt-image-1',
        images: [{ data: `${prefix}${payload}`, mimeType: 'image/png' }]
      })

      const result = (await manager.callTool(
        IMAGE_GENERATE_TOOL_NAME,
        { prompt: 'A warm sunset over the ocean' },
        'conv-1'
      )) as any

      expect(result.rawData.isError).toBe(true)
      expect(result.rawData.toolResult.error).toMatchObject({
        code: 'IMAGE_GENERATION_FAILED',
        recoverable: true
      })
    }
  )

  it.each(['reject', 'pending', 'resolve'])(
    'fails promptly when an aborted cache write would %s',
    async (outcome) => {
      const controller = new AbortController()
      const cacheImage = vi.fn(async () => {
        controller.abort()
        if (outcome === 'pending') return new Promise<string>(() => {})
        if (outcome === 'resolve') return 'imgcache://late.png'
        throw new DOMException('The operation was aborted.', 'AbortError')
      })
      manager = buildManager(cacheImage)
      generateImageStandalone.mockResolvedValue({
        providerId: 'openai',
        modelId: 'gpt-image-1',
        images: [{ data: 'aGVsbG8=', mimeType: 'image/png' }]
      })

      const result = (await manager.callTool(
        IMAGE_GENERATE_TOOL_NAME,
        { prompt: 'A warm sunset over the ocean' },
        'conv-1',
        { signal: controller.signal }
      )) as any

      expect(cacheImage).toHaveBeenCalledWith('data:image/png;base64,aGVsbG8=', {
        signal: controller.signal,
        allowPrivateNetwork: false
      })
      expect(result.rawData.isError).toBe(true)
      expect(result.rawData.toolResult.error).toMatchObject({
        code: 'IMAGE_GENERATION_FAILED',
        recoverable: true
      })
    }
  )

  it('fails the tool call when a large image cannot be cached', async () => {
    manager = buildManager(vi.fn(async (data: string) => data))
    generateImageStandalone.mockResolvedValue({
      providerId: 'openai',
      modelId: 'gpt-image-1',
      images: [
        { data: `data:image/png;base64,${'A'.repeat(3 * 1024 * 1024)}`, mimeType: 'image/png' }
      ]
    })

    const result = (await manager.callTool(
      IMAGE_GENERATE_TOOL_NAME,
      { prompt: 'A warm sunset over the ocean' },
      'conv-1'
    )) as any

    expect(result.rawData.isError).toBe(true)
    expect(result.rawData.toolResult.error).toMatchObject({
      code: 'IMAGE_GENERATION_FAILED',
      recoverable: true
    })
    expect(result.rawData.imagePreviews).toBeUndefined()
  })

  it('returns a recoverable tool error when no image model is configured', async () => {
    providerSettings.resolveDeepChatAgentConfig.mockResolvedValueOnce({})

    const result = (await manager.callTool(
      IMAGE_GENERATE_TOOL_NAME,
      { prompt: 'A warm sunset over the ocean' },
      'conv-1'
    )) as any

    expect(generateImageStandalone).not.toHaveBeenCalled()
    expect(result.rawData.isError).toBe(true)
    expect(result.rawData.toolResult.error).toMatchObject({
      code: 'IMAGE_GENERATION_MODEL_UNAVAILABLE',
      recoverable: true
    })
  })

  it('propagates dispatch commit failure without invoking the image provider', async () => {
    const journalError = new Error('journal unavailable')
    const commitDispatch = vi.fn((input) => {
      expect(input).toEqual({
        toolName: IMAGE_GENERATE_TOOL_NAME,
        toolSource: 'agent',
        normalizedArguments: {
          prompt: 'A warm sunset over the ocean',
          providerId: 'openai',
          modelId: 'gpt-image-1'
        },
        target: {
          serverName: 'agent-image-generation',
          originalName: IMAGE_GENERATE_TOOL_NAME
        }
      })
      throw journalError
    })

    await expect(
      manager.callTool(
        IMAGE_GENERATE_TOOL_NAME,
        { prompt: '  A warm sunset over the ocean  ' },
        'conv-1',
        { commitDispatch }
      )
    ).rejects.toBe(journalError)

    expect(commitDispatch).toHaveBeenCalledOnce()
    expect(generateImageStandalone).not.toHaveBeenCalled()
  })

  it('returns a recoverable tool error when the provider fails', async () => {
    generateImageStandalone.mockRejectedValue(new Error('quota exceeded'))

    const result = (await manager.callTool(
      IMAGE_GENERATE_TOOL_NAME,
      { prompt: 'A warm sunset over the ocean' },
      'conv-1'
    )) as any

    expect(result.rawData.isError).toBe(true)
    expect(result.rawData.toolResult.error).toMatchObject({
      code: 'IMAGE_GENERATION_FAILED',
      message: 'quota exceeded',
      recoverable: true
    })
  })
})
