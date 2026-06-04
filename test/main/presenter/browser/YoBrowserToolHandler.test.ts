import { describe, expect, it, vi } from 'vitest'
import { YoBrowserToolHandler } from '@/presenter/browser/YoBrowserToolHandler'

vi.mock('@shared/logger', () => ({
  default: {
    warn: vi.fn(),
    error: vi.fn()
  }
}))

describe('YoBrowserToolHandler', () => {
  const readyStatus = {
    initialized: true,
    page: {
      id: 'page-1',
      url: 'https://example.com',
      status: 'ready',
      createdAt: 1,
      updatedAt: 2
    },
    canGoBack: false,
    canGoForward: false,
    visible: true,
    loading: false
  }

  const createPresenter = () =>
    ({
      getBrowserStatus: vi.fn().mockResolvedValue(readyStatus),
      loadUrl: vi.fn().mockResolvedValue({ initialized: true }),
      getBrowserPage: vi.fn().mockResolvedValue({
        id: 'page-1',
        url: 'https://example.com',
        status: 'ready'
      }),
      sendCdpCommand: vi.fn().mockResolvedValue({ ok: true })
    }) as any

  it('exposes only the simplified YoBrowser tool names', () => {
    const handler = new YoBrowserToolHandler(createPresenter())

    const toolNames = handler.getToolDefinitions().map((tool) => tool.function.name)

    expect(toolNames).toEqual(['get_browser_status', 'load_url', 'cdp_send'])
  })

  it('routes load_url through the conversation session id', async () => {
    const presenter = createPresenter()
    const handler = new YoBrowserToolHandler(presenter)

    const result = await handler.callTool('load_url', { url: 'https://example.com' }, 'session-a')

    expect(presenter.loadUrl).toHaveBeenCalledWith(
      'session-a',
      'https://example.com',
      undefined,
      undefined,
      'agent'
    )
    expect(result).toBe(JSON.stringify({ initialized: true }))
  })

  it('marks CDP commands as agent activity', async () => {
    const presenter = createPresenter()
    const handler = new YoBrowserToolHandler(presenter)

    await handler.callTool(
      'cdp_send',
      {
        method: 'Input.dispatchMouseEvent',
        params: { type: 'mousePressed', x: 24, y: 48 }
      },
      'session-a'
    )

    expect(presenter.sendCdpCommand).toHaveBeenCalledWith(
      'session-a',
      'Input.dispatchMouseEvent',
      { type: 'mousePressed', x: 24, y: 48 },
      'agent'
    )
  })

  it('rejects old tool names as unknown tools', async () => {
    const handler = new YoBrowserToolHandler(createPresenter())

    await expect(handler.callTool('yo_browser_cdp_send', {}, 'session-a')).rejects.toThrow(
      'Unknown YoBrowser tool: yo_browser_cdp_send'
    )
  })

  it('returns a recoverable browser-unavailable error before cdp_send', async () => {
    const presenter = createPresenter()
    presenter.getBrowserStatus.mockResolvedValue({
      initialized: false,
      page: null,
      canGoBack: false,
      canGoForward: false,
      visible: false,
      loading: false
    })
    const handler = new YoBrowserToolHandler(presenter)

    await expect(
      handler.callTool('cdp_send', { method: 'Page.reload' }, 'session-a')
    ).rejects.toMatchObject({
      name: 'YoBrowserUnavailableError',
      payload: {
        ok: false,
        error: expect.objectContaining({
          code: 'yobrowser_unavailable',
          recoverable: true,
          sessionId: 'session-a',
          method: 'Page.reload'
        })
      }
    })
    expect(presenter.sendCdpCommand).not.toHaveBeenCalled()
  })

  it('maps YoBrowserNotReadyError to the recoverable unavailable error', async () => {
    const presenter = createPresenter()
    const notReadyError = new Error('Browser page is not ready')
    notReadyError.name = 'YoBrowserNotReadyError'
    presenter.sendCdpCommand.mockRejectedValue(notReadyError)
    const handler = new YoBrowserToolHandler(presenter)

    await expect(
      handler.callTool('cdp_send', { method: 'Page.captureScreenshot' }, 'session-a')
    ).rejects.toMatchObject({
      name: 'YoBrowserUnavailableError',
      payload: {
        error: expect.objectContaining({
          code: 'yobrowser_unavailable',
          method: 'Page.captureScreenshot',
          browserStatus: readyStatus
        })
      },
      originalError: notReadyError
    })
  })
})
