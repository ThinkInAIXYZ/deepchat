import { beforeEach, describe, expect, it, vi } from 'vitest'

const trayOnMock = vi.hoisted(() => vi.fn())
const setContextMenuMock = vi.hoisted(() => vi.fn())
const setToolTipMock = vi.hoisted(() => vi.fn())
const setTemplateImageMock = vi.hoisted(() => vi.fn())
const resizeMock = vi.hoisted(() => vi.fn(() => ({ setTemplateImage: setTemplateImageMock })))
const createFromPathMock = vi.hoisted(() => vi.fn(() => ({ resize: resizeMock })))
const buildFromTemplateMock = vi.hoisted(() => vi.fn((template) => ({ template })))
const windowPresenterMock = vi.hoisted(() => ({
  toggleMainWindowVisibility: vi.fn(),
  createSettingsWindow: vi.fn(),
  sendSettingsCheckForUpdates: vi.fn()
}))

vi.mock('electron', () => ({
  app: {
    getAppPath: vi.fn(() => '/mock/app'),
    quit: vi.fn()
  },
  nativeImage: {
    createFromPath: createFromPathMock
  },
  Menu: {
    buildFromTemplate: buildFromTemplateMock
  },
  Tray: vi.fn(() => ({
    setToolTip: setToolTipMock,
    setContextMenu: setContextMenuMock,
    on: trayOnMock,
    destroy: vi.fn()
  }))
}))

describe('TrayPresenter', () => {
  const originalPlatform = process.platform

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    Object.defineProperty(process, 'platform', {
      value: originalPlatform
    })
  })

  it('does not reveal the app when the macOS tray status item is clicked', async () => {
    Object.defineProperty(process, 'platform', {
      value: 'darwin'
    })
    const { TrayPresenter } = await import('@/desktop/tray')

    new TrayPresenter({ getLanguage: vi.fn(() => 'zh-CN') }, windowPresenterMock as any).init()

    expect(trayOnMock).not.toHaveBeenCalledWith('click', expect.any(Function))
  })

  it('keeps tray click reveal behavior on non-macOS platforms', async () => {
    Object.defineProperty(process, 'platform', {
      value: 'win32'
    })
    const { TrayPresenter } = await import('@/desktop/tray')

    new TrayPresenter({ getLanguage: vi.fn(() => 'zh-CN') }, windowPresenterMock as any).init()

    const clickHandler = trayOnMock.mock.calls.find(([eventName]) => eventName === 'click')?.[1]
    expect(clickHandler).toBeTypeOf('function')

    clickHandler()

    expect(windowPresenterMock.toggleMainWindowVisibility).toHaveBeenCalledWith(true)
  })
})
