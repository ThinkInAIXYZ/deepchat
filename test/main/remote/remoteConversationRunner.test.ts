import { afterEach, describe, expect, it, vi } from 'vitest'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { app } from 'electron'
import { RemoteConversationRunner } from '@/remote/conversation/runner'
import type {
  RemoteSessionAssignmentPort,
  RemoteCatalogPort,
  RemoteDesktopPort,
  RemoteSessionLifecyclePort,
  RemoteSessionProjectionPort,
  RemoteSessionTurnPort,
  RemoteWorkspacePort
} from '@/remote/ports'
import type { SessionWithState } from '@shared/types/agent-interface'

const createSession = (overrides: Partial<SessionWithState> = {}): SessionWithState => ({
  id: 'session-1',
  agentId: 'deepchat',
  title: 'Remote Session',
  projectDir: null,
  isPinned: false,
  isDraft: false,
  sessionKind: 'regular',
  createdAt: 1,
  updatedAt: 1,
  status: 'idle',
  providerId: 'openai',
  modelId: 'gpt-5',
  ...overrides
})

type RemoteSessionPorts = {
  lifecycle: RemoteSessionLifecyclePort
  turn: RemoteSessionTurnPort
  assignment: RemoteSessionAssignmentPort
  projection: RemoteSessionProjectionPort
  desktop: RemoteDesktopPort
}

const createRemoteSessionPorts = (
  overrides: {
    lifecycle?: Partial<RemoteSessionLifecyclePort>
    turn?: Partial<RemoteSessionTurnPort>
    assignment?: Partial<RemoteSessionAssignmentPort>
    projection?: Partial<RemoteSessionProjectionPort>
    desktop?: Partial<RemoteDesktopPort>
  } = {}
): RemoteSessionPorts => {
  const assistantMessage = {
    id: 'assistant-default',
    role: 'assistant' as const,
    orderSeq: 1,
    status: 'success',
    content: '[]'
  }
  return {
    lifecycle: {
      createDetachedSession: vi.fn(async () => createSession()),
      ...overrides.lifecycle
    },
    turn: {
      sendMessage: vi.fn(async () => ({ requestId: null, messageId: null })),
      respondToolInteraction: vi.fn(async () => ({})),
      cancelGeneration: vi.fn(async () => undefined),
      ...overrides.turn
    },
    assignment: {
      setSessionModel: vi.fn(async () => createSession()),
      ...overrides.assignment
    },
    projection: {
      getSession: vi.fn(async () => null),
      listSessions: vi.fn(async () => []),
      getMessages: vi.fn().mockResolvedValueOnce([]).mockResolvedValue([assistantMessage]),
      getMessage: vi.fn(async () => null),
      getSearchResults: vi.fn(async () => []),
      ...overrides.projection
    },
    desktop: {
      openSession: vi.fn(async () => false),
      ...overrides.desktop
    }
  }
}

const createCatalog = (overrides: Partial<RemoteCatalogPort> = {}): RemoteCatalogPort => ({
  getAgentType: vi.fn(async (agentId: string) => (agentId === 'acp-agent' ? 'acp' : 'deepchat')),
  listAgents: vi.fn(async () => [
    {
      agentId: 'deepchat',
      agentName: 'DeepChat',
      agentType: 'deepchat'
    },
    {
      agentId: 'acp-agent',
      agentName: 'ACP Agent',
      agentType: 'acp',
      source: 'manual'
    }
  ]),
  listModelProviders: vi.fn(async () => []),
  ...overrides
})

const createWorkspace = (
  defaultProjectPath: string | null = null,
  prepareFile: RemoteWorkspacePort['prepareFile'] = vi.fn(async () => {
    throw new Error('unused')
  })
): RemoteWorkspacePort => ({
  getDefaultProjectPath: vi.fn(() => defaultProjectPath),
  prepareFile
})

const createRunner = (
  deps: ConstructorParameters<typeof RemoteConversationRunner>[0],
  bindingStore: ConstructorParameters<typeof RemoteConversationRunner>[1]
) =>
  new RemoteConversationRunner(deps, {
    getActiveEvent: vi.fn().mockReturnValue(null),
    ...bindingStore
  } as ConstructorParameters<typeof RemoteConversationRunner>[1])

const encryptAes128Ecb = (content: Buffer, key: Buffer): Buffer => {
  const cipher = crypto.createCipheriv('aes-128-ecb', key, null)
  return Buffer.concat([cipher.update(content), cipher.final()])
}

describe('RemoteConversationRunner', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.mocked(app.getPath).mockImplementation(() => '/mock/path')
  })

  it('cancels an active generation through the Session turn port', async () => {
    const cancelGeneration = vi.fn(async () => undefined)
    const bindingStore = {
      getBinding: vi.fn().mockReturnValue({ sessionId: 'session-1', updatedAt: 1 }),
      getActiveEvent: vi.fn().mockReturnValue(null),
      clearActiveEvent: vi.fn()
    }
    const runner = createRunner(
      {
        catalog: createCatalog(),
        workspace: createWorkspace(),
        ...createRemoteSessionPorts({
          turn: { cancelGeneration },
          projection: {
            getSession: vi.fn().mockResolvedValue(
              createSession({
                agentId: 'acp-agent',
                providerId: 'acp',
                modelId: 'acp-agent',
                status: 'generating'
              })
            )
          }
        }),
        resolveDefaultAgentId: vi.fn().mockResolvedValue('acp-agent')
      },
      bindingStore as any
    )

    await expect(runner.stop('telegram:100:0')).resolves.toBe(true)
    expect(cancelGeneration).toHaveBeenCalledWith('session-1')
    expect(bindingStore.clearActiveEvent).toHaveBeenCalledWith('telegram:100:0')
  })

  it('creates new sessions with the current default deepchat agent', async () => {
    const bindingStore = {
      setBinding: vi.fn()
    }
    const runner = createRunner(
      {
        catalog: createCatalog(),
        workspace: createWorkspace(),
        ...createRemoteSessionPorts({
          lifecycle: {
            createDetachedSession: vi
              .fn()
              .mockResolvedValue(createSession({ agentId: 'deepchat-alt' }))
          }
        }),
        resolveDefaultAgentId: vi.fn().mockResolvedValue('deepchat-alt')
      },
      bindingStore as any
    )

    const session = await runner.createNewSession('telegram:100:0', 'Remote Session')

    expect(session.agentId).toBe('deepchat-alt')
    expect(bindingStore.setBinding).toHaveBeenCalledWith('telegram:100:0', session.id)
  })

  it('creates a new bound session after the default agent changes', async () => {
    const sessionPorts = createRemoteSessionPorts({
      lifecycle: {
        createDetachedSession: vi.fn().mockResolvedValue(
          createSession({
            id: 'session-new',
            agentId: 'deepchat-new'
          })
        )
      },
      projection: {
        getSession: vi.fn().mockResolvedValue(
          createSession({
            id: 'session-legacy',
            agentId: 'deepchat-legacy'
          })
        ),
        getMessage: vi.fn().mockResolvedValue({
          id: 'msg-1',
          role: 'assistant',
          content: 'hello from legacy',
          status: 'success',
          orderSeq: 2
        })
      }
    })
    const bindingStore = {
      getBinding: vi.fn().mockReturnValue({
        sessionId: 'session-legacy',
        updatedAt: 1
      }),
      clearBinding: vi.fn(),
      clearActiveEvent: vi.fn(),
      rememberActiveEvent: vi.fn(),
      setBinding: vi.fn()
    }
    const runner = createRunner(
      {
        catalog: createCatalog(),
        workspace: createWorkspace(),
        ...sessionPorts,
        resolveDefaultAgentId: vi.fn().mockResolvedValue('deepchat-new')
      },
      bindingStore as any
    )

    const execution = await runner.sendText('telegram:100:0', 'hello')

    expect(execution.sessionId).toBe('session-new')
    expect(sessionPorts.turn.sendMessage).toHaveBeenCalledWith('session-new', 'hello')
    expect(sessionPorts.lifecycle.createDetachedSession).toHaveBeenCalledWith({
      title: 'New Chat',
      agentId: 'deepchat-new'
    })
    expect(bindingStore.setBinding).toHaveBeenCalledWith('telegram:100:0', 'session-new')
  })

  it('downloads inbound remote files into the session workspace before sending', async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'deepchat-remote-runner-'))
    const preparedFile = {
      name: 'note.txt',
      path: path.join(workspace, '.deepchat/remote-assets/telegram/hash/message/note.txt'),
      mimeType: 'text/plain',
      content: 'hello file',
      metadata: {
        fileName: 'note.txt',
        fileSize: 10,
        fileCreated: new Date('2024-01-01T00:00:00Z'),
        fileModified: new Date('2024-01-01T00:00:00Z')
      }
    }
    const session = createSession({
      id: 'session-bound',
      projectDir: workspace
    })
    const sessionPorts = createRemoteSessionPorts({
      projection: {
        getSession: vi.fn().mockResolvedValue(session)
      }
    })
    const fileService = {
      prepareFile: vi.fn(async (filePath: string, mimeType: string) => ({
        ...preparedFile,
        path: filePath,
        mimeType
      }))
    }
    const runner = createRunner(
      {
        catalog: createCatalog(),
        workspace: createWorkspace(null, fileService.prepareFile),
        ...sessionPorts,
        resolveDefaultAgentId: vi.fn().mockResolvedValue('deepchat')
      },
      {
        getBinding: vi.fn().mockReturnValue({
          sessionId: 'session-bound',
          updatedAt: 1
        }),
        clearBinding: vi.fn(),
        clearActiveEvent: vi.fn(),
        rememberActiveEvent: vi.fn()
      } as any
    )

    await runner.sendInput('telegram:100:0', {
      text: 'read this',
      sourceMessageId: 'telegram-message-1',
      attachments: [
        {
          id: 'file-1',
          filename: 'note.txt',
          mediaType: 'text/plain',
          data: Buffer.from('hello file').toString('base64'),
          size: 10
        }
      ]
    })

    const preparedPath = fileService.prepareFile.mock.calls[0][0] as string
    expect(preparedPath).toContain(path.join('.deepchat', 'remote-assets', 'telegram'))
    expect(preparedPath).toContain('telegram-message-1')
    expect(path.basename(preparedPath)).toBe('note-1.txt')
    await expect(fs.readFile(preparedPath, 'utf8')).resolves.toBe('hello file')
    expect(sessionPorts.turn.sendMessage).toHaveBeenCalledWith('session-bound', {
      text: 'read this',
      files: [
        expect.objectContaining({
          name: 'note.txt',
          path: preparedPath,
          size: 10,
          metadata: expect.objectContaining({
            fileName: 'note.txt',
            fileSize: 10
          })
        })
      ]
    })
  })

  it('stores same-named remote attachments at unique local paths', async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'deepchat-remote-runner-'))
    const session = createSession({
      id: 'session-bound',
      projectDir: workspace
    })
    const sessionPorts = createRemoteSessionPorts({
      projection: {
        getSession: vi.fn().mockResolvedValue(session)
      }
    })
    const fileService = {
      prepareFile: vi.fn(async (filePath: string, mimeType: string) => ({
        name: path.basename(filePath),
        path: filePath,
        mimeType,
        content: '',
        metadata: {
          fileName: path.basename(filePath),
          fileSize: 0,
          fileCreated: new Date('2024-01-01T00:00:00Z'),
          fileModified: new Date('2024-01-01T00:00:00Z')
        }
      }))
    }
    const runner = createRunner(
      {
        catalog: createCatalog(),
        workspace: createWorkspace(null, fileService.prepareFile),
        ...sessionPorts,
        resolveDefaultAgentId: vi.fn().mockResolvedValue('deepchat')
      },
      {
        getBinding: vi.fn().mockReturnValue({
          sessionId: 'session-bound',
          updatedAt: 1
        }),
        clearBinding: vi.fn(),
        clearActiveEvent: vi.fn(),
        rememberActiveEvent: vi.fn()
      } as any
    )

    await runner.sendInput('telegram:100:0', {
      text: 'read these',
      sourceMessageId: 'telegram-message-duplicates',
      attachments: [
        {
          id: 'file-1',
          filename: 'duplicate.txt',
          mediaType: 'text/plain',
          data: Buffer.from('first file').toString('base64')
        },
        {
          id: 'file-2',
          filename: 'duplicate.txt',
          mediaType: 'text/plain',
          data: Buffer.from('second file').toString('base64')
        }
      ]
    })

    expect(fileService.prepareFile).toHaveBeenCalledTimes(2)
    const firstPath = fileService.prepareFile.mock.calls[0][0] as string
    const secondPath = fileService.prepareFile.mock.calls[1][0] as string
    expect(path.basename(firstPath)).toBe('duplicate-1.txt')
    expect(path.basename(secondPath)).toBe('duplicate-2.txt')
    expect(firstPath).not.toBe(secondPath)
    await expect(fs.readFile(firstPath, 'utf8')).resolves.toBe('first file')
    await expect(fs.readFile(secondPath, 'utf8')).resolves.toBe('second file')

    const sentInput = vi.mocked(sessionPorts.turn.sendMessage).mock.calls[0][1] as {
      files: Array<{
        name: string
        path: string
        metadata?: {
          fileName?: string
          fileSize?: number
        }
      }>
    }
    expect(sentInput.files).toHaveLength(2)
    expect(sentInput.files.map((file) => file.name)).toEqual(['duplicate.txt', 'duplicate.txt'])
    expect(sentInput.files.map((file) => file.path)).toEqual([firstPath, secondPath])
    expect(sentInput.files.map((file) => file.metadata?.fileName)).toEqual([
      'duplicate.txt',
      'duplicate.txt'
    ])
  })

  it('skips remote attachments that have no downloadable data', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'deepchat-remote-runner-'))
    const preparedFile = {
      name: 'note.txt',
      path: path.join(workspace, '.deepchat/remote-assets/telegram/hash/message/note.txt'),
      mimeType: 'text/plain',
      content: 'hello file',
      metadata: {
        fileName: 'note.txt',
        fileSize: 10,
        fileCreated: new Date('2024-01-01T00:00:00Z'),
        fileModified: new Date('2024-01-01T00:00:00Z')
      }
    }
    const session = createSession({
      id: 'session-bound',
      projectDir: workspace
    })
    const sessionPorts = createRemoteSessionPorts({
      projection: {
        getSession: vi.fn().mockResolvedValue(session)
      }
    })
    const fileService = {
      prepareFile: vi.fn(async (filePath: string, mimeType: string) => ({
        ...preparedFile,
        path: filePath,
        mimeType
      }))
    }
    const runner = createRunner(
      {
        catalog: createCatalog(),
        workspace: createWorkspace(null, fileService.prepareFile),
        ...sessionPorts,
        resolveDefaultAgentId: vi.fn().mockResolvedValue('deepchat')
      },
      {
        getBinding: vi.fn().mockReturnValue({
          sessionId: 'session-bound',
          updatedAt: 1
        }),
        clearBinding: vi.fn(),
        clearActiveEvent: vi.fn(),
        rememberActiveEvent: vi.fn()
      } as any
    )

    try {
      await runner.sendInput('telegram:100:0', {
        text: 'read this',
        sourceMessageId: 'telegram-message-2',
        attachments: [
          {
            id: 'failed-file',
            filename: 'failed.txt',
            mediaType: 'text/plain',
            failedDownload: true
          },
          {
            id: 'empty-file',
            filename: 'empty.txt',
            mediaType: 'text/plain'
          },
          {
            id: 'file-1',
            filename: 'note.txt',
            mediaType: 'text/plain',
            data: Buffer.from('hello file').toString('base64')
          }
        ]
      })

      expect(fileService.prepareFile).toHaveBeenCalledTimes(1)
      const preparedPath = fileService.prepareFile.mock.calls[0][0] as string
      expect(preparedPath).toContain('telegram-message-2')
      expect(path.basename(preparedPath)).toBe('note-1.txt')
      await expect(fs.readFile(preparedPath, 'utf8')).resolves.toBe('hello file')
      expect(sessionPorts.turn.sendMessage).toHaveBeenCalledWith('session-bound', {
        text: 'read this',
        files: [
          expect.objectContaining({
            name: 'note.txt',
            path: preparedPath,
            size: 10,
            metadata: expect.objectContaining({
              fileName: 'note.txt',
              fileSize: 10
            })
          })
        ]
      })
      expect(warnSpy).toHaveBeenCalledTimes(2)
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('rejects empty text turns when all remote attachments are skipped', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'deepchat-remote-runner-'))
    const session = createSession({
      id: 'session-bound',
      projectDir: workspace
    })
    const sessionPorts = createRemoteSessionPorts({
      projection: {
        getSession: vi.fn().mockResolvedValue(session)
      }
    })
    const runner = createRunner(
      {
        catalog: createCatalog(),
        workspace: createWorkspace(),
        ...sessionPorts,
        resolveDefaultAgentId: vi.fn().mockResolvedValue('deepchat')
      },
      {
        getBinding: vi.fn().mockReturnValue({
          sessionId: 'session-bound',
          updatedAt: 1
        }),
        clearBinding: vi.fn(),
        clearActiveEvent: vi.fn(),
        rememberActiveEvent: vi.fn()
      } as any
    )

    try {
      await expect(
        runner.sendInput('telegram:100:0', {
          text: '   ',
          sourceMessageId: 'telegram-message-empty-attachments',
          attachments: [
            {
              id: 'failed-file',
              filename: 'failed.txt',
              mediaType: 'text/plain',
              failedDownload: true
            },
            {
              id: 'empty-file',
              filename: 'empty.txt',
              mediaType: 'text/plain'
            }
          ]
        })
      ).rejects.toThrow('All attachments failed validation/download.')
      expect(sessionPorts.turn.sendMessage).not.toHaveBeenCalled()
      expect(warnSpy).toHaveBeenCalledTimes(2)
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('downloads and decrypts inbound encrypted remote media before sending', async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'deepchat-remote-runner-'))
    const plainContent = Buffer.from('weixin image bytes')
    const key = Buffer.from('00112233445566778899aabbccddeeff', 'hex')
    const encryptedContent = encryptAes128Ecb(plainContent, key)
    const fetchMock = vi.fn(async () => ({
      ok: true,
      arrayBuffer: async () =>
        encryptedContent.buffer.slice(
          encryptedContent.byteOffset,
          encryptedContent.byteOffset + encryptedContent.byteLength
        )
    }))
    vi.stubGlobal('fetch', fetchMock)

    const preparedFile = {
      name: 'image-1.png',
      path: path.join(workspace, '.deepchat/remote-assets/weixin-ilink/hash/message/image-1.png'),
      mimeType: 'image/png',
      content: '',
      metadata: {
        fileName: 'image-1.png',
        fileSize: plainContent.length,
        fileCreated: new Date('2024-01-01T00:00:00Z'),
        fileModified: new Date('2024-01-01T00:00:00Z')
      }
    }
    const session = createSession({
      id: 'session-bound',
      projectDir: workspace
    })
    const sessionPorts = createRemoteSessionPorts({
      projection: {
        getSession: vi.fn().mockResolvedValue(session)
      }
    })
    const fileService = {
      prepareFile: vi.fn(async (filePath: string, mimeType: string) => ({
        ...preparedFile,
        path: filePath,
        mimeType
      }))
    }
    const runner = createRunner(
      {
        catalog: createCatalog(),
        workspace: createWorkspace(null, fileService.prepareFile),
        ...sessionPorts,
        resolveDefaultAgentId: vi.fn().mockResolvedValue('deepchat')
      },
      {
        getBinding: vi.fn().mockReturnValue({
          sessionId: 'session-bound',
          updatedAt: 1
        }),
        clearBinding: vi.fn(),
        clearActiveEvent: vi.fn(),
        rememberActiveEvent: vi.fn()
      } as any
    )

    await runner.sendInput('weixin-ilink:account:user', {
      text: 'read this image',
      sourceMessageId: 'weixin-message-1',
      attachments: [
        {
          id: 'image-1',
          filename: 'image-1.png',
          mediaType: 'image/png',
          encryptedMedia: {
            encryptedQueryParam: 'encrypted query',
            aesKey: key.toString('hex'),
            aesKeyEncoding: 'hex',
            cdnBaseUrl: 'https://novac2c.cdn.weixin.qq.com/c2c'
          },
          resourceType: 'image'
        }
      ]
    })

    const preparedPath = fileService.prepareFile.mock.calls[0][0] as string
    expect(fetchMock).toHaveBeenCalledWith(
      'https://novac2c.cdn.weixin.qq.com/c2c/download?encrypted_query_param=encrypted%20query',
      {
        signal: expect.any(AbortSignal)
      }
    )
    await expect(fs.readFile(preparedPath)).resolves.toEqual(plainContent)
    expect(sessionPorts.turn.sendMessage).toHaveBeenCalledWith('session-bound', {
      text: 'read this image',
      files: [
        expect.objectContaining({
          name: 'image-1.png',
          path: preparedPath,
          size: plainContent.byteLength,
          metadata: expect.objectContaining({
            fileName: 'image-1.png',
            fileSize: plainContent.byteLength
          })
        })
      ]
    })
  })

  it('persists generated remote images from cached and base64 sources', async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'deepchat-remote-images-'))
    const userData = await fs.mkdtemp(path.join(os.tmpdir(), 'deepchat-user-data-'))
    const cacheDir = path.join(userData, 'images')
    await fs.mkdir(cacheDir, { recursive: true })

    const cachedImage = Buffer.from('cached generated image')
    const dataUrlImage = Buffer.from('data url generated image')
    const rawBase64Image = Buffer.from('raw base64 generated image')
    const screenshotImage = Buffer.from('cached screenshot image')
    const toolOutputImage = Buffer.from('tool output image')
    await fs.writeFile(path.join(cacheDir, 'generated.png'), cachedImage)
    await fs.writeFile(path.join(cacheDir, 'screenshot.png'), screenshotImage)
    vi.mocked(app.getPath).mockImplementation((name: string) =>
      name === 'userData' ? userData : '/mock/path'
    )

    const assistantMessage = {
      id: 'assistant-images',
      role: 'assistant',
      orderSeq: 2,
      status: 'success',
      content: JSON.stringify([
        {
          type: 'image',
          status: 'success',
          timestamp: 1,
          image_data: {
            data: 'imgcache://generated.png',
            mimeType: 'image/png'
          }
        },
        {
          type: 'image',
          status: 'success',
          timestamp: 2,
          image_data: {
            data: `data:image/jpeg;base64,${dataUrlImage.toString('base64')}`,
            mimeType: 'image/png'
          }
        },
        {
          type: 'image',
          status: 'success',
          timestamp: 3,
          image_data: {
            data: rawBase64Image.toString('base64'),
            mimeType: 'image/webp'
          }
        },
        {
          type: 'tool_call',
          content: '',
          status: 'success',
          timestamp: 4,
          tool_call: {
            id: 'tool-screenshot',
            name: 'cdp_send',
            params: JSON.stringify({ method: 'Page.captureScreenshot' }),
            response: JSON.stringify({ data: 'omitted from text' }),
            imagePreviews: [
              {
                id: 'screenshot-1',
                data: 'imgcache://screenshot.png',
                mimeType: 'image/png',
                title: 'Page.captureScreenshot',
                source: 'screenshot'
              },
              {
                id: 'tool-output-1',
                data: `data:image/png;base64,${toolOutputImage.toString('base64')}`,
                mimeType: 'image/png',
                source: 'tool_output'
              },
              {
                id: 'metadata-only',
                mimeType: 'image/png',
                source: 'tool_output'
              }
            ]
          },
          extra: {
            toolCallArgsComplete: true
          }
        },
        {
          type: 'image',
          content: '',
          status: 'success',
          timestamp: 5,
          image_data: {
            data: 'imgcache://screenshot.png',
            mimeType: 'image/png'
          },
          extra: {
            toolCallId: 'tool-screenshot',
            toolName: 'cdp_send',
            toolImagePreviewId: 'screenshot-1',
            toolImagePreviewSource: 'screenshot',
            toolImagePreviewTitle: 'Page.captureScreenshot'
          }
        }
      ])
    }
    const session = createSession({
      id: 'session-bound',
      projectDir: workspace
    })
    const sessionPorts = createRemoteSessionPorts({
      projection: {
        getSession: vi.fn().mockResolvedValue(session),
        getMessages: vi.fn().mockResolvedValueOnce([]).mockResolvedValue([assistantMessage]),
        getMessage: vi.fn().mockResolvedValue(assistantMessage)
      }
    })
    const runner = createRunner(
      {
        catalog: createCatalog(),
        workspace: createWorkspace(),
        ...sessionPorts,
        resolveDefaultAgentId: vi.fn().mockResolvedValue('deepchat')
      },
      {
        getBinding: vi.fn().mockReturnValue({
          sessionId: 'session-bound',
          updatedAt: 1
        }),
        clearBinding: vi.fn(),
        clearActiveEvent: vi.fn(),
        rememberActiveEvent: vi.fn()
      } as any
    )

    const execution = await runner.sendText('weixin-ilink:account:user', 'draw a sunset')
    const snapshot = await execution.getSnapshot()

    expect(snapshot.generatedImages).toEqual([
      expect.objectContaining({
        key: 'assistant-images:0:image',
        mimeType: 'image/png',
        filename: 'generated-1.png'
      }),
      expect.objectContaining({
        key: 'assistant-images:1:image',
        mimeType: 'image/jpeg',
        filename: 'generated-2.jpg'
      }),
      expect.objectContaining({
        key: 'assistant-images:2:image',
        mimeType: 'image/webp',
        filename: 'generated-3.webp'
      }),
      expect.objectContaining({
        key: 'assistant-images:3:toolResultImage:1',
        mimeType: 'image/png',
        filename: 'tool_output-4-2.png'
      }),
      expect.objectContaining({
        key: 'assistant-images:4:image',
        mimeType: 'image/png',
        filename: 'screenshot-5.png'
      })
    ])
    await expect(fs.readFile(snapshot.generatedImages![0].path)).resolves.toEqual(cachedImage)
    await expect(fs.readFile(snapshot.generatedImages![1].path)).resolves.toEqual(dataUrlImage)
    await expect(fs.readFile(snapshot.generatedImages![2].path)).resolves.toEqual(rawBase64Image)
    await expect(fs.readFile(snapshot.generatedImages![3].path)).resolves.toEqual(toolOutputImage)
    await expect(fs.readFile(snapshot.generatedImages![4].path)).resolves.toEqual(screenshotImage)
    expect(snapshot.finalText).toBe('')
  })

  it('persists generated remote images in user data when no workspace is available', async () => {
    const userData = await fs.mkdtemp(path.join(os.tmpdir(), 'deepchat-user-data-'))
    const image = Buffer.from('generated image without workspace')
    vi.mocked(app.getPath).mockImplementation((name: string) =>
      name === 'userData' ? userData : '/mock/path'
    )

    const assistantMessage = {
      id: 'assistant-images-no-workspace',
      role: 'assistant',
      orderSeq: 2,
      status: 'success',
      content: JSON.stringify([
        {
          type: 'image',
          status: 'success',
          timestamp: 1,
          image_data: {
            data: `data:image/png;base64,${image.toString('base64')}`,
            mimeType: 'image/png'
          }
        }
      ])
    }
    const session = createSession({
      id: 'session-bound',
      projectDir: null
    })
    const sessionPorts = createRemoteSessionPorts({
      projection: {
        getSession: vi.fn().mockResolvedValue(session),
        getMessages: vi.fn().mockResolvedValueOnce([]).mockResolvedValue([assistantMessage]),
        getMessage: vi.fn().mockResolvedValue(assistantMessage)
      }
    })
    const runner = createRunner(
      {
        catalog: createCatalog(),
        workspace: createWorkspace(),
        ...sessionPorts,
        resolveDefaultAgentId: vi.fn().mockResolvedValue('deepchat')
      },
      {
        getBinding: vi.fn().mockReturnValue({
          sessionId: 'session-bound',
          updatedAt: 1
        }),
        clearBinding: vi.fn(),
        clearActiveEvent: vi.fn(),
        rememberActiveEvent: vi.fn()
      } as any
    )

    const execution = await runner.sendText('weixin-ilink:account:user', 'draw a sunrise')
    const snapshot = await execution.getSnapshot()

    expect(snapshot.generatedImages).toEqual([
      expect.objectContaining({
        key: 'assistant-images-no-workspace:0:image',
        mimeType: 'image/png',
        filename: 'generated-1.png'
      })
    ])
    expect(snapshot.generatedImages![0].path).toContain(
      path.join(userData, 'remote-assets', 'weixin-ilink')
    )
    await expect(fs.readFile(snapshot.generatedImages![0].path)).resolves.toEqual(image)
    expect(snapshot.finalText).toBe('')
  })

  it('lists recent sessions for the currently bound agent before falling back to default agent', async () => {
    const sessionPorts = createRemoteSessionPorts({
      projection: {
        getSession: vi.fn().mockResolvedValue(
          createSession({
            id: 'session-bound',
            agentId: 'deepchat-bound'
          })
        ),
        listSessions: vi.fn().mockResolvedValue([
          createSession({
            id: 'session-a',
            agentId: 'deepchat-bound',
            updatedAt: 5
          }),
          createSession({
            id: 'session-b',
            agentId: 'deepchat-bound',
            updatedAt: 10
          })
        ])
      }
    })
    const bindingStore = {
      getBinding: vi.fn().mockReturnValue({
        sessionId: 'session-bound',
        updatedAt: 1
      }),
      rememberSessionSnapshot: vi.fn()
    }
    const runner = createRunner(
      {
        catalog: createCatalog(),
        workspace: createWorkspace(),
        ...sessionPorts,
        resolveDefaultAgentId: vi.fn().mockResolvedValue('deepchat-default')
      },
      bindingStore as any
    )

    const sessions = await runner.listSessions('telegram:100:0')

    expect(sessionPorts.projection.listSessions).toHaveBeenCalledWith({
      agentId: 'deepchat-bound'
    })
    expect(sessions.map((session) => session.id)).toEqual(['session-b', 'session-a'])
    expect(bindingStore.rememberSessionSnapshot).toHaveBeenCalledWith('telegram:100:0', [
      'session-b',
      'session-a'
    ])
  })

  it('delegates remote model switching to the bound session', async () => {
    const sessionPorts = createRemoteSessionPorts({
      projection: {
        getSession: vi.fn().mockResolvedValue(
          createSession({
            id: 'session-bound',
            agentId: 'deepchat-bound'
          })
        )
      },
      assignment: {
        setSessionModel: vi.fn().mockResolvedValue(
          createSession({
            id: 'session-bound',
            agentId: 'deepchat-bound',
            providerId: 'anthropic',
            modelId: 'claude-3-5-sonnet'
          })
        )
      }
    })
    const runner = createRunner(
      {
        catalog: createCatalog(),
        workspace: createWorkspace(),
        ...sessionPorts,
        resolveDefaultAgentId: vi.fn().mockResolvedValue('deepchat-default')
      },
      {
        getBinding: vi.fn().mockReturnValue({
          sessionId: 'session-bound',
          updatedAt: 1
        })
      } as any
    )

    const updated = await runner.setSessionModel('telegram:100:0', 'anthropic', 'claude-3-5-sonnet')

    expect(sessionPorts.assignment.setSessionModel).toHaveBeenCalledWith(
      'session-bound',
      'anthropic',
      'claude-3-5-sonnet'
    )
    expect(updated.providerId).toBe('anthropic')
    expect(updated.modelId).toBe('claude-3-5-sonnet')
  })

  it('returns noSession when /open has no bound session', async () => {
    const runner = createRunner(
      {
        catalog: createCatalog(),
        workspace: createWorkspace(),
        ...createRemoteSessionPorts(),
        resolveDefaultAgentId: vi.fn()
      },
      {
        getBinding: vi.fn().mockReturnValue(null)
      } as any
    )

    await expect(runner.open('telegram:100:0')).resolves.toEqual({
      status: 'noSession'
    })
  })

  it('returns windowNotFound when /open cannot resolve a desktop chat window', async () => {
    const openSession = vi.fn(async () => false)
    const runner = createRunner(
      {
        catalog: createCatalog(),
        workspace: createWorkspace(),
        ...createRemoteSessionPorts({
          projection: {
            getSession: vi.fn().mockResolvedValue(createSession())
          },
          desktop: {
            openSession
          }
        }),
        resolveDefaultAgentId: vi.fn()
      },
      {
        getBinding: vi.fn().mockReturnValue({
          sessionId: 'session-1',
          updatedAt: 1
        }),
        clearBinding: vi.fn()
      } as any
    )

    await expect(runner.open('telegram:100:0')).resolves.toEqual({
      status: 'windowNotFound'
    })
    expect(openSession).toHaveBeenCalledWith('session-1')
  })

  it('returns ok and activates the bound session when /open resolves a chat window', async () => {
    const session = createSession()
    const openSession = vi.fn(async () => true)
    const runner = createRunner(
      {
        catalog: createCatalog(),
        workspace: createWorkspace(),
        ...createRemoteSessionPorts({
          projection: {
            getSession: vi.fn().mockResolvedValue(session)
          },
          desktop: {
            openSession
          }
        }),
        resolveDefaultAgentId: vi.fn()
      },
      {
        getBinding: vi.fn().mockReturnValue({
          sessionId: 'session-1',
          updatedAt: 1
        }),
        clearBinding: vi.fn()
      } as any
    )

    await expect(runner.open('telegram:100:0')).resolves.toEqual({
      status: 'ok',
      session
    })
    expect(openSession).toHaveBeenCalledWith('session-1')
  })

  it('reports the bound active event as the remote generation status', async () => {
    const session = createSession({ status: 'generating' })
    const getBinding = vi
      .fn()
      .mockReturnValueOnce(null)
      .mockReturnValue({ sessionId: 'session-1', updatedAt: 1 })
    const runner = createRunner(
      {
        catalog: createCatalog(),
        workspace: createWorkspace(),
        ...createRemoteSessionPorts({
          projection: {
            getSession: vi.fn().mockResolvedValue(session)
          }
        }),
        resolveDefaultAgentId: vi.fn()
      },
      {
        getBinding,
        getActiveEvent: vi.fn().mockReturnValue('bound-event')
      } as any
    )

    await expect(runner.getStatus('telegram:100:0')).resolves.toEqual({
      session: null,
      activeEventId: null,
      isGenerating: false,
      pendingInteraction: null
    })
    await expect(runner.getStatus('telegram:100:0')).resolves.toEqual({
      session,
      activeEventId: 'bound-event',
      isGenerating: true,
      pendingInteraction: null
    })
  })

  it('clears deleted bindings and returns the fixed missing-session output', async () => {
    const clearBinding = vi.fn()
    const runner = createRunner(
      {
        catalog: createCatalog(),
        workspace: createWorkspace(),
        ...createRemoteSessionPorts(),
        resolveDefaultAgentId: vi.fn()
      },
      { clearBinding } as any
    )

    await expect(
      (runner as any).getConversationSnapshot('telegram:100:0', 'deleted-session', {
        afterOrderSeq: 0,
        preferredMessageId: null,
        ignoreMessageId: null
      })
    ).resolves.toEqual({
      messageId: null,
      text: 'The bound session no longer exists.',
      traceText: '',
      deliverySegments: [],
      statusText: '',
      finalText: 'The bound session no longer exists.',
      draftText: '',
      renderBlocks: [],
      fullText: 'The bound session no longer exists.',
      completed: true,
      pendingInteraction: null
    })
    expect(clearBinding).toHaveBeenCalledWith('telegram:100:0')
  })

  it('does not fall back to the previous active assistant event while waiting for a new reply', async () => {
    vi.useFakeTimers()

    const session = createSession({
      id: 'session-legacy',
      agentId: 'deepchat-legacy',
      status: 'idle'
    })
    const oldAssistantMessage = {
      id: 'msg-old',
      role: 'assistant',
      content: 'old reply',
      status: 'success',
      orderSeq: 2
    }

    const sessionPorts = createRemoteSessionPorts({
      projection: {
        getSession: vi.fn().mockResolvedValue(session),
        getMessages: vi
          .fn()
          .mockResolvedValueOnce([
            {
              id: 'user-1',
              role: 'user',
              content: 'hello',
              status: 'success',
              orderSeq: 1
            }
          ])
          .mockResolvedValue([oldAssistantMessage])
      }
    })
    const bindingStore = {
      getBinding: vi.fn().mockReturnValue({
        sessionId: 'session-legacy',
        updatedAt: 1
      }),
      clearBinding: vi.fn(),
      clearActiveEvent: vi.fn(),
      rememberActiveEvent: vi.fn(),
      setBinding: vi.fn(),
      getActiveEvent: vi.fn().mockReturnValue('msg-old')
    }
    const runner = createRunner(
      {
        catalog: createCatalog(),
        workspace: createWorkspace(),
        ...sessionPorts,
        resolveDefaultAgentId: vi.fn().mockResolvedValue('deepchat-legacy')
      },
      bindingStore as any
    )

    const executionPromise = runner.sendText('telegram:100:0', 'hello again')
    await vi.advanceTimersByTimeAsync(1000)
    const execution = await executionPromise

    expect(execution.eventId).toBeNull()
    expect(bindingStore.rememberActiveEvent).not.toHaveBeenCalledWith('telegram:100:0', 'msg-old')

    const snapshot = await execution.getSnapshot()

    expect(snapshot).toEqual({
      messageId: null,
      text: 'No assistant response was produced.',
      traceText: '',
      deliverySegments: [],
      statusText: '',
      finalText: 'No assistant response was produced.',
      draftText: '',
      renderBlocks: [],
      fullText: 'No assistant response was produced.',
      completed: true,
      pendingInteraction: null
    })

    vi.useRealTimers()
  })

  it('extracts the latest pending interaction from assistant action blocks', async () => {
    const runner = createRunner(
      {
        catalog: createCatalog(),
        workspace: createWorkspace(),
        ...createRemoteSessionPorts({
          projection: {
            getSession: vi.fn().mockResolvedValue(createSession()),
            getMessages: vi.fn().mockResolvedValue([
              {
                id: 'assistant-1',
                role: 'assistant',
                orderSeq: 2,
                content: JSON.stringify([
                  {
                    type: 'content',
                    content: 'Need approval before continuing.',
                    status: 'success',
                    timestamp: 1
                  },
                  {
                    type: 'action',
                    action_type: 'tool_call_permission',
                    content: 'Permission requested',
                    status: 'pending',
                    timestamp: 2,
                    tool_call: {
                      id: 'tool-1',
                      name: 'shell_command',
                      params: '{"command":"git push"}'
                    },
                    extra: {
                      needsUserAction: true,
                      permissionType: 'command',
                      permissionRequest: JSON.stringify({
                        permissionType: 'command',
                        description: 'Run git push',
                        command: 'git push',
                        commandInfo: {
                          command: 'git push',
                          riskLevel: 'high',
                          suggestion: 'Confirm before pushing.'
                        }
                      })
                    }
                  }
                ])
              }
            ])
          }
        }),
        resolveDefaultAgentId: vi.fn().mockResolvedValue('deepchat')
      },
      {
        getBinding: vi.fn().mockReturnValue({
          sessionId: 'session-1',
          updatedAt: 1
        }),
        getActiveEvent: vi.fn().mockReturnValue(null)
      } as any
    )

    const pendingInteraction = {
      type: 'permission',
      messageId: 'assistant-1',
      toolCallId: 'tool-1',
      toolName: 'shell_command',
      toolArgs: '{"command":"git push"}',
      permission: {
        permissionType: 'command',
        description: 'Run git push',
        rememberable: true,
        command: 'git push',
        commandInfo: {
          command: 'git push',
          riskLevel: 'high',
          suggestion: 'Confirm before pushing.'
        }
      }
    }

    await expect(runner.getPendingInteraction('telegram:100:0')).resolves.toEqual(
      pendingInteraction
    )
    await expect(runner.getStatus('telegram:100:0')).resolves.toEqual({
      session: createSession(),
      activeEventId: null,
      isGenerating: false,
      pendingInteraction
    })
  })

  it('keeps stream text empty while the assistant is still reasoning', async () => {
    const runner = createRunner(
      {
        catalog: createCatalog(),
        workspace: createWorkspace(),
        ...createRemoteSessionPorts({
          projection: {
            getSession: vi.fn().mockResolvedValue(createSession({ status: 'generating' })),
            getMessages: vi.fn().mockResolvedValue([
              {
                id: 'assistant-1',
                role: 'assistant',
                orderSeq: 2,
                status: 'pending',
                content: JSON.stringify([
                  {
                    type: 'reasoning_content',
                    content: 'Thinking now',
                    status: 'pending',
                    timestamp: 1
                  }
                ])
              }
            ]),
            getMessage: vi.fn().mockResolvedValue({
              id: 'assistant-1',
              role: 'assistant',
              orderSeq: 2,
              status: 'pending',
              content: JSON.stringify([
                {
                  type: 'reasoning_content',
                  content: 'Thinking now',
                  status: 'pending',
                  timestamp: 1
                }
              ])
            })
          }
        }),
        resolveDefaultAgentId: vi.fn().mockResolvedValue('deepchat')
      },
      {
        getBinding: vi.fn().mockReturnValue({
          sessionId: 'session-1',
          updatedAt: 1
        }),
        getActiveEvent: vi.fn().mockReturnValue('assistant-1'),
        rememberActiveEvent: vi.fn(),
        clearActiveEvent: vi.fn()
      } as any
    )

    const snapshot = await (runner as any).getConversationSnapshot('telegram:100:0', 'session-1', {
      afterOrderSeq: 0,
      preferredMessageId: null,
      ignoreMessageId: null
    })

    expect(snapshot.text).toBe('')
    expect(snapshot.statusText).toBe('Running: thinking...')
    expect(snapshot.completed).toBe(false)
  })

  it('falls back to an empty stored-search result when projection lookup fails', async () => {
    const searchError = new Error('search store unavailable')
    const getSearchResults = vi.fn().mockRejectedValue(searchError)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const runner = createRunner(
      {
        catalog: createCatalog(),
        workspace: createWorkspace(),
        ...createRemoteSessionPorts({
          projection: {
            getSession: vi.fn().mockResolvedValue(createSession()),
            getMessage: vi.fn().mockResolvedValue({
              id: 'assistant-search',
              role: 'assistant',
              orderSeq: 2,
              status: 'success',
              content: JSON.stringify([
                {
                  id: 'search-1',
                  type: 'search',
                  content: '',
                  status: 'success',
                  timestamp: 1,
                  extra: { searchId: 'stored-search', label: 'web_search' }
                }
              ])
            }),
            getSearchResults
          }
        }),
        resolveDefaultAgentId: vi.fn()
      },
      {
        rememberActiveEvent: vi.fn(),
        clearActiveEvent: vi.fn()
      } as any
    )

    const snapshot = await (runner as any).getConversationSnapshot('telegram:100:0', 'session-1', {
      afterOrderSeq: 0,
      preferredMessageId: 'assistant-search',
      ignoreMessageId: null
    })

    expect(getSearchResults).toHaveBeenCalledWith('assistant-search', 'stored-search')
    expect(snapshot.renderBlocks).toEqual([
      expect.objectContaining({
        kind: 'search',
        text: expect.stringContaining('No stored search results were found.')
      })
    ])
    expect(snapshot.completed).toBe(true)
    expect(warn).toHaveBeenCalledWith(
      '[RemoteConversationRunner] Failed to load search results:',
      expect.objectContaining({ error: searchError })
    )
    warn.mockRestore()
  })

  it('creates a follow-up execution after responding to a pending interaction', async () => {
    const getMessage = vi.fn().mockResolvedValue({
      id: 'assistant-2',
      role: 'assistant',
      orderSeq: 5,
      status: 'success',
      content: JSON.stringify([
        {
          type: 'content',
          content: 'Push completed.',
          status: 'success',
          timestamp: 2
        }
      ])
    })
    const sessionPorts = createRemoteSessionPorts({
      projection: {
        getSession: vi.fn().mockResolvedValue(createSession()),
        getMessages: vi
          .fn()
          .mockResolvedValueOnce([
            {
              id: 'assistant-2',
              role: 'assistant',
              orderSeq: 5,
              content: JSON.stringify([
                {
                  type: 'action',
                  action_type: 'tool_call_permission',
                  content: 'Permission requested',
                  status: 'pending',
                  timestamp: 1,
                  tool_call: {
                    id: 'tool-2',
                    name: 'shell_command',
                    params: '{"command":"git push"}'
                  },
                  extra: {
                    needsUserAction: true,
                    permissionType: 'command',
                    permissionRequest: JSON.stringify({
                      permissionType: 'command',
                      description: 'Run git push',
                      command: 'git push'
                    })
                  }
                }
              ])
            }
          ])
          .mockResolvedValue([
            {
              id: 'assistant-2',
              role: 'assistant',
              orderSeq: 5,
              status: 'success',
              content: JSON.stringify([
                {
                  type: 'content',
                  content: 'Push completed.',
                  status: 'success',
                  timestamp: 2
                }
              ])
            }
          ]),
        getMessage
      },
      turn: {
        respondToolInteraction: vi.fn().mockResolvedValue({
          resumed: true,
          waitingForUserMessage: false
        })
      }
    })
    const bindingStore = {
      getBinding: vi.fn().mockReturnValue({
        sessionId: 'session-1',
        updatedAt: 1
      }),
      clearActiveEvent: vi.fn(),
      rememberActiveEvent: vi.fn()
    }
    const runner = createRunner(
      {
        catalog: createCatalog(),
        workspace: createWorkspace(),
        ...sessionPorts,
        resolveDefaultAgentId: vi.fn().mockResolvedValue('deepchat')
      },
      bindingStore as any
    )

    const response = await runner.respondToPendingInteraction('telegram:100:0', {
      kind: 'permission',
      granted: true
    })

    expect(sessionPorts.turn.respondToolInteraction).toHaveBeenCalledWith(
      'session-1',
      'assistant-2',
      'tool-2',
      {
        kind: 'permission',
        granted: true
      }
    )
    expect(response.waitingForUserMessage).toBe(false)

    const snapshot = await response.execution?.getSnapshot()
    expect(snapshot).toEqual({
      messageId: 'assistant-2',
      text: 'Push completed.',
      traceText: '',
      deliverySegments: [
        {
          key: 'assistant-2:0:answer',
          kind: 'answer',
          text: 'Push completed.',
          sourceMessageId: 'assistant-2'
        }
      ],
      statusText: 'Running: writing...',
      finalText: 'Push completed.',
      draftText: '',
      renderBlocks: [
        expect.objectContaining({
          kind: 'answer',
          text: '[Answer]\nPush completed.'
        })
      ],
      fullText: '[Answer]\nPush completed.',
      completed: true,
      pendingInteraction: null
    })
  })

  it('creates ACP sessions with provider, model, and the global default workdir', async () => {
    const createDetachedSession = vi.fn().mockResolvedValue(
      createSession({
        agentId: 'acp-agent',
        providerId: 'acp',
        modelId: 'acp-agent',
        projectDir: '/workspaces/remote'
      })
    )
    const runner = createRunner(
      {
        catalog: createCatalog(),
        workspace: createWorkspace('/workspaces/remote'),
        ...createRemoteSessionPorts({ lifecycle: { createDetachedSession } }),
        resolveDefaultAgentId: vi.fn().mockResolvedValue('acp-agent')
      },
      {
        getTelegramDefaultWorkdir: vi.fn().mockReturnValue('/workspaces/remote'),
        setBinding: vi.fn()
      } as any
    )

    await runner.createNewSession('telegram:100:0', 'Remote ACP')

    expect(createDetachedSession).toHaveBeenCalledWith({
      title: 'Remote ACP',
      agentId: 'acp-agent',
      providerId: 'acp',
      modelId: 'acp-agent',
      projectDir: '/workspaces/remote'
    })
  })

  it('requires a channel default workdir for ACP workdir resolution', async () => {
    const runner = createRunner(
      {
        catalog: createCatalog(),
        workspace: createWorkspace('/workspaces/global'),
        ...createRemoteSessionPorts(),
        resolveDefaultAgentId: vi.fn().mockResolvedValue('acp-agent')
      },
      {
        getTelegramDefaultWorkdir: vi.fn().mockReturnValue('')
      } as any
    )

    await expect(runner.getDefaultWorkdir('telegram:100:0')).resolves.toBeNull()
  })

  it('prefers the discord channel default workdir for ACP sessions', async () => {
    const runner = createRunner(
      {
        catalog: createCatalog(),
        workspace: createWorkspace('/workspaces/global'),
        ...createRemoteSessionPorts(),
        resolveDefaultAgentId: vi.fn().mockResolvedValue('acp-agent')
      },
      {
        getDiscordDefaultWorkdir: vi.fn().mockReturnValue('/workspaces/discord')
      } as any
    )

    await expect(runner.getDefaultWorkdir('discord:dm:123')).resolves.toBe('/workspaces/discord')
  })

  it('rejects ACP session creation when no channel workdir is configured', async () => {
    const runner = createRunner(
      {
        catalog: createCatalog(),
        workspace: createWorkspace(),
        ...createRemoteSessionPorts(),
        resolveDefaultAgentId: vi.fn().mockResolvedValue('acp-agent')
      },
      {
        getTelegramDefaultWorkdir: vi.fn().mockReturnValue('')
      } as any
    )

    await expect(runner.createNewSession('telegram:100:0')).rejects.toThrow(
      'ACP remote agent requires a channel default directory.'
    )
  })

  it('lists enabled agents only', async () => {
    const catalog = createCatalog({
      listAgents: vi.fn().mockResolvedValue([
        {
          agentId: 'deepchat',
          agentName: 'DeepChat',
          agentType: 'deepchat',
          source: 'builtin'
        },
        { agentId: 'codex', agentName: 'Codex', agentType: 'acp', source: 'registry' }
      ])
    })
    const runner = createRunner(
      {
        catalog,
        workspace: createWorkspace(),
        ...createRemoteSessionPorts(),
        resolveDefaultAgentId: vi.fn()
      },
      {} as any
    )

    const agents = await runner.listAvailableAgents()

    expect(agents).toEqual([
      { agentId: 'deepchat', agentName: 'DeepChat', agentType: 'deepchat', source: 'builtin' },
      { agentId: 'codex', agentName: 'Codex', agentType: 'acp', source: 'registry' }
    ])
  })

  it('switches the channel default agent and starts a new session', async () => {
    const setChannelDefaultAgentId = vi.fn()
    const createDetachedSession = vi
      .fn()
      .mockResolvedValue(createSession({ id: 'session-new', agentId: 'codex' }))
    const catalog = createCatalog({
      listAgents: vi.fn().mockResolvedValue([
        { agentId: 'deepchat', agentName: 'DeepChat', agentType: 'deepchat' },
        { agentId: 'codex', agentName: 'Codex', agentType: 'deepchat' }
      ])
    })
    const runner = createRunner(
      {
        catalog,
        workspace: createWorkspace(),
        ...createRemoteSessionPorts({ lifecycle: { createDetachedSession } }),
        resolveDefaultAgentId: vi.fn().mockResolvedValue('codex')
      },
      {
        setBinding: vi.fn(),
        setChannelDefaultAgentId,
        getTelegramDefaultWorkdir: vi.fn().mockReturnValue('')
      } as any
    )

    const result = await runner.setChannelDefaultAgent('telegram:100:0', 'codex')

    expect(setChannelDefaultAgentId).toHaveBeenCalledWith('telegram:100:0', 'codex')
    expect(createDetachedSession).toHaveBeenCalled()
    expect(result.session.agentId).toBe('codex')
    expect(result.agent.agentId).toBe('codex')
  })

  it('rejects an unknown agent id', async () => {
    const catalog = createCatalog({
      listAgents: vi
        .fn()
        .mockResolvedValue([{ agentId: 'deepchat', agentName: 'DeepChat', agentType: 'deepchat' }])
    })
    const runner = createRunner(
      {
        catalog,
        workspace: createWorkspace(),
        ...createRemoteSessionPorts(),
        resolveDefaultAgentId: vi.fn()
      },
      { setChannelDefaultAgentId: vi.fn() } as any
    )

    await expect(runner.setChannelDefaultAgent('telegram:100:0', 'missing')).rejects.toThrow(
      'Agent "missing" is not available'
    )
  })

  it('rejects an ACP agent switch when the channel has no default workdir', async () => {
    const catalog = createCatalog({
      listAgents: vi
        .fn()
        .mockResolvedValue([
          { agentId: 'codex', agentName: 'Codex', agentType: 'acp', source: 'registry' }
        ])
    })
    const setChannelDefaultAgentId = vi.fn()
    const runner = createRunner(
      {
        catalog,
        workspace: createWorkspace(),
        ...createRemoteSessionPorts(),
        resolveDefaultAgentId: vi.fn()
      },
      {
        setChannelDefaultAgentId,
        getTelegramDefaultWorkdir: vi.fn().mockReturnValue('')
      } as any
    )

    await expect(runner.setChannelDefaultAgent('telegram:100:0', 'codex')).rejects.toThrow(
      /no default workdir/
    )
    expect(setChannelDefaultAgentId).not.toHaveBeenCalled()
  })
})
