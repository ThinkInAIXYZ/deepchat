import { WeixinIlinkRuntime } from '@/presenter/remoteControlPresenter/weixinIlink/weixinIlinkRuntime'

describe('WeixinIlinkRuntime', () => {
  const createRuntime = () =>
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
      }
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
})
