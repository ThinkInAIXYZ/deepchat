import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FloatingButtonWindow } from '@/desktop/floatingButton/FloatingButtonWindow'
import { DEFAULT_FLOATING_BUTTON_CONFIG } from '@/desktop/floatingButton/types'

const { windowMock, browserWindowMock } = vi.hoisted(() => {
  const windowMock = {
    setVisibleOnAllWorkspaces: vi.fn(),
    setAlwaysOnTop: vi.fn(),
    setOpacity: vi.fn(),
    setBounds: vi.fn(),
    isDestroyed: vi.fn(() => false),
    loadFile: vi.fn(async () => {}),
    on: vi.fn(),
    showInactive: vi.fn(),
    show: vi.fn(),
    isVisible: vi.fn()
  }
  return {
    windowMock,
    browserWindowMock: vi.fn(function (_options: Record<string, unknown>) {
      return windowMock
    })
  }
})

vi.mock('electron', () => {
  const display = { workArea: { x: 0, y: 0, width: 1200, height: 900 } }
  return {
    BrowserWindow: browserWindowMock,
    screen: {
      getPrimaryDisplay: () => display,
      getDisplayMatching: () => display,
      getDisplayNearestPoint: () => display
    }
  }
})
vi.mock('@electron-toolkit/utils', () => ({ is: { dev: false } }))
vi.mock('../../../../src/shared/logger', () => ({
  default: { info: vi.fn(), debug: vi.fn(), error: vi.fn() }
}))

beforeEach(() => {
  vi.clearAllMocks()
  windowMock.isVisible.mockReset()
})
afterEach(() => vi.unstubAllGlobals())

describe('FloatingButtonWindow visibility', () => {
  it.each([
    { platform: 'darwin', inactiveVisible: true, visible: true, fallback: false },
    { platform: 'win32', inactiveVisible: true, visible: true, fallback: false },
    { platform: 'linux', inactiveVisible: true, visible: true, fallback: false },
    { platform: 'linux', inactiveVisible: false, visible: true, fallback: true },
    { platform: 'linux', inactiveVisible: false, visible: false, fallback: true }
  ])(
    'shows with the supported API: $platform, fallback=$fallback, visible=$visible',
    async (test) => {
      vi.stubGlobal('process', { ...process, platform: test.platform })
      windowMock.isVisible.mockReturnValue(test.visible)
      if (test.platform === 'linux') {
        windowMock.isVisible.mockReturnValueOnce(test.inactiveVisible)
      }
      const widget = new FloatingButtonWindow(DEFAULT_FLOATING_BUTTON_CONFIG)
      await widget.create()
      widget.show()

      expect(windowMock.showInactive).toHaveBeenCalledOnce()
      expect(windowMock.show).toHaveBeenCalledTimes(test.fallback ? 1 : 0)
      expect(widget.getState().isVisible).toBe(test.visible)
      expect(browserWindowMock.mock.calls[0][0].type).toBe(
        test.platform === 'darwin' ? 'panel' : undefined
      )
    }
  )
})
