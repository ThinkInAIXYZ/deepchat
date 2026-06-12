import { WeixinIlinkRuntime } from '@/presenter/remoteControlPresenter/weixinIlink/weixinIlinkRuntime'
import type {
  RemoteGeneratedImageAsset,
  WeixinIlinkInboundMessage
} from '@/presenter/remoteControlPresenter/types'

describe('WeixinIlinkRuntime', () => {
  const createRuntime = (
    overrides: Partial<ConstructorParameters<typeof WeixinIlinkRuntime>[0]> = {}
  ) =>
    new WeixinIlinkRuntime({
      accountId: 'wx-account-1',
      ownerUserId: 'owner-1',
      baseUrl: 'https://ilinkai.weixin.qq.com',
      client: {} as any,
      parser: {} as any,
      router: {} as any,
      bindingStore: {} as any,
      logger: {
        info: vi.fn(),
        error: vi.fn()
      },
      ...overrides
    })

  const createInboundMessage = (
    overrides: Partial<WeixinIlinkInboundMessage> = {}
  ): WeixinIlinkInboundMessage => ({
    kind: 'message',
    accountId: 'wx-account-1',
    userId: 'wx-user-1',
    text: 'hello',
    messageId: 'wx-message-1',
    contextToken: 'ctx-1',
    command: null,
    createdAt: null,
    attachments: [],
    ...overrides
  })

  it('skips terminal delivery when the final text matches the last answer segment', () => {
    const runtime = createRuntime()
    const segments = [
      {
        key: 'assistant-message:answer',
        kind: 'answer' as const,
        text: 'Final answer',
        sourceMessageId: 'assistant-message'
      }
    ]

    const nextSegments = (runtime as any).appendTerminalDeliverySegment(
      segments,
      'assistant-message',
      'Final answer'
    )

    expect(nextSegments).toEqual(segments)
  })

  it('sends generated images from completed conversation snapshots', async () => {
    const generatedImage: RemoteGeneratedImageAsset = {
      key: 'assistant-message:0:image',
      path: '/tmp/generated.png',
      mimeType: 'image/png',
      filename: 'generated.png',
      sourceMessageId: 'assistant-message'
    }
    const client = {
      sendTextMessage: vi.fn().mockResolvedValue(undefined),
      sendImageMessage: vi.fn().mockResolvedValue(undefined)
    }
    const bindingStore = {
      getRemoteDeliveryState: vi.fn().mockReturnValue(null),
      rememberRemoteDeliveryState: vi.fn(),
      clearRemoteDeliveryState: vi.fn()
    }
    const runtime = createRuntime({
      client: client as any,
      bindingStore: bindingStore as any
    })
    ;(runtime as any).started = true

    await (runtime as any).deliverConversation(
      createInboundMessage(),
      {
        userId: 'wx-user-1',
        contextToken: 'ctx-1'
      },
      {
        sessionId: 'session-1',
        eventId: 'assistant-message',
        getSnapshot: vi.fn().mockResolvedValue({
          messageId: 'assistant-message',
          text: '',
          traceText: '',
          deliverySegments: [],
          finalText: '',
          fullText: '',
          generatedImages: [generatedImage],
          completed: true,
          pendingInteraction: null
        })
      },
      0
    )

    expect(client.sendTextMessage).not.toHaveBeenCalled()
    expect(client.sendImageMessage).toHaveBeenCalledWith({
      toUserId: 'wx-user-1',
      contextToken: 'ctx-1',
      imagePath: '/tmp/generated.png',
      mimeType: 'image/png'
    })
  })
})
