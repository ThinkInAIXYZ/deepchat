import { describe, it, expect, beforeEach, vi } from 'vitest'
import { EventBus, SendTarget } from '../../../src/main/eventbus'
import type { IWindowPresenter, ITabPresenter } from '../../../src/shared/presenter'

describe('EventBus 事件总线', () => {
  let eventBus: EventBus
  let mockWindowPresenter: IWindowPresenter
  let mockTabPresenter: ITabPresenter

  beforeEach(() => {
    eventBus = new EventBus()

    // Mock WindowPresenter
    mockWindowPresenter = {
      sendToWindow: vi.fn(),
      sendToAllWindows: vi.fn(),
      sendToDefaultWindow: vi.fn(),
      sendToDefaultTab: vi.fn(),
      sendToWebContents: vi.fn().mockResolvedValue(true),
      sendToActiveTab: vi.fn().mockResolvedValue(true)
    } as Partial<IWindowPresenter> as IWindowPresenter

    // Mock TabPresenter
    mockTabPresenter = {
      getTab: vi.fn(),
      getActiveTabId: vi.fn()
    } as Partial<ITabPresenter> as ITabPresenter
  })

  describe('发送事件到主进程', () => {
    it('应该能够正确发送事件到主进程', () => {
      const eventName = 'test:event'
      const testData = { message: 'test' }

      // 监听事件
      const mockListener = vi.fn()
      eventBus.on(eventName, mockListener)

      // 发送事件
      eventBus.sendToMain(eventName, testData)

      // 验证事件被正确触发
      expect(mockListener).toHaveBeenCalledWith(testData)
      expect(mockListener).toHaveBeenCalledTimes(1)
    })

    it('应该支持发送多个参数', () => {
      const eventName = 'test:multiple-args'
      const arg1 = 'first'
      const arg2 = { second: 'data' }
      const arg3 = 123

      const mockListener = vi.fn()
      eventBus.on(eventName, mockListener)

      eventBus.sendToMain(eventName, arg1, arg2, arg3)

      expect(mockListener).toHaveBeenCalledWith(arg1, arg2, arg3)
    })
  })

  describe('发送事件到特定窗口', () => {
    beforeEach(() => {
      eventBus.setWindowPresenter(mockWindowPresenter)
    })

    it('应该能够发送事件到特定窗口', () => {
      const eventName = 'window:test'
      const windowId = 123
      const testData = { data: 'test' }

      eventBus.sendToWindow(eventName, windowId, testData)

      expect(mockWindowPresenter.sendToWindow).toHaveBeenCalledWith(windowId, eventName, testData)
    })

    it('当WindowPresenter未设置时应该显示警告', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const newEventBus = new EventBus()

      newEventBus.sendToWindow('test:event', 1, 'data')

      expect(consoleSpy).toHaveBeenCalledWith(
        'WindowPresenter not available, cannot send to window'
      )

      consoleSpy.mockRestore()
    })
  })

  describe('发送事件到渲染进程', () => {
    beforeEach(() => {
      eventBus.setWindowPresenter(mockWindowPresenter)
    })

    it('应该能够发送事件到所有窗口（默认行为）', () => {
      const eventName = 'renderer:test'
      const testData = { message: 'test' }

      eventBus.sendToRenderer(eventName, undefined, testData)

      expect(mockWindowPresenter.sendToAllWindows).toHaveBeenCalledWith(eventName, testData)
    })

    it('应该能够发送事件到所有窗口（显式指定）', () => {
      const eventName = 'renderer:all'
      const testData = { message: 'all windows' }

      eventBus.sendToRenderer(eventName, SendTarget.ALL_WINDOWS, testData)

      expect(mockWindowPresenter.sendToAllWindows).toHaveBeenCalledWith(eventName, testData)
    })

    it('应该能够发送事件到默认窗口', () => {
      const eventName = 'renderer:default-window'
      const testData = { message: 'default window' }

      eventBus.sendToRenderer(eventName, SendTarget.DEFAULT_WINDOW, testData)

      expect(mockWindowPresenter.sendToDefaultWindow).toHaveBeenCalledWith(
        eventName,
        true,
        testData
      )
    })

    it('当WindowPresenter未设置时应该显示警告', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const newEventBus = new EventBus()

      newEventBus.sendToRenderer('test:event', SendTarget.ALL_WINDOWS, 'data')

      expect(consoleSpy).toHaveBeenCalledWith(
        'WindowPresenter not available, cannot send to renderer'
      )

      consoleSpy.mockRestore()
    })
  })

  describe('同时发送到主进程和渲染进程', () => {
    beforeEach(() => {
      eventBus.setWindowPresenter(mockWindowPresenter)
    })

    it('应该同时发送事件到主进程和渲染进程', () => {
      const eventName = 'both:test'
      const testData = { message: 'both processes' }

      const mockListener = vi.fn()
      eventBus.on(eventName, mockListener)

      eventBus.send(eventName, SendTarget.ALL_WINDOWS, testData)

      // 验证主进程收到事件
      expect(mockListener).toHaveBeenCalledWith(testData)

      // 验证渲染进程收到事件
      expect(mockWindowPresenter.sendToAllWindows).toHaveBeenCalledWith(eventName, testData)
    })

    it('应该使用默认的SendTarget', () => {
      const eventName = 'both:default'
      const testData = { message: 'default target' }

      eventBus.send(eventName, undefined, testData)

      expect(mockWindowPresenter.sendToAllWindows).toHaveBeenCalledWith(eventName, testData)
    })
  })

  describe('webContents 路由相关功能', () => {
    beforeEach(() => {
      eventBus.setWindowPresenter(mockWindowPresenter)
      eventBus.setTabPresenter(mockTabPresenter)
      vi.mocked(mockTabPresenter.getActiveTabId).mockResolvedValue(1)
    })

    it('应该能够发送事件到指定 webContents', async () => {
      const webContentsId = 1
      const eventName = 'web-contents:test'
      const testData = { message: 'webContents test' }

      eventBus.sendToWebContents(webContentsId, eventName, testData)

      // 等待异步操作完成
      await new Promise((resolve) => setTimeout(resolve, 0))

      expect(mockWindowPresenter.sendToWebContents).toHaveBeenCalledWith(
        webContentsId,
        eventName,
        testData
      )
    })

    it('应该能够发送事件到活跃窗口内容', async () => {
      const windowId = 1
      const eventName = 'active-content:test'
      const testData = { message: 'active content test' }

      eventBus.sendToActiveTab(windowId, eventName, testData)

      // 等待异步操作完成
      await new Promise((resolve) => setTimeout(resolve, 0))

      expect(mockWindowPresenter.sendToActiveTab).toHaveBeenCalledWith(
        windowId,
        eventName,
        testData
      )
    })

    it('应该能够广播事件到多个 webContents', async () => {
      const webContentsIds = [1, 2, 3]
      const eventName = 'broadcast:test'
      const testData = { message: 'broadcast test' }

      eventBus.broadcastToWebContents(webContentsIds, eventName, testData)

      // 等待异步操作完成
      await new Promise((resolve) => setTimeout(resolve, 0))

      expect(mockWindowPresenter.sendToWebContents).toHaveBeenCalledTimes(3)
      expect(mockWindowPresenter.sendToWebContents).toHaveBeenCalledWith(1, eventName, testData)
      expect(mockWindowPresenter.sendToWebContents).toHaveBeenCalledWith(2, eventName, testData)
      expect(mockWindowPresenter.sendToWebContents).toHaveBeenCalledWith(3, eventName, testData)
    })

    it('当WindowPresenter未设置时应该显示警告', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const newEventBus = new EventBus()

      newEventBus.sendToWebContents(1, 'test:event', 'data')

      expect(consoleSpy).toHaveBeenCalledWith(
        'WindowPresenter not available, cannot send to specific webContents'
      )

      consoleSpy.mockRestore()
    })
  })

  describe('Presenter设置', () => {
    it('应该能够设置WindowPresenter', () => {
      eventBus.setWindowPresenter(mockWindowPresenter)

      // 验证设置成功（通过发送事件不产生警告）
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      eventBus.sendToRenderer('test:event', SendTarget.ALL_WINDOWS, 'data')

      expect(consoleSpy).not.toHaveBeenCalled()
      consoleSpy.mockRestore()
    })

    it('应该能够设置TabPresenter', () => {
      eventBus.setTabPresenter(mockTabPresenter)

      // 验证设置成功（通过发送事件不产生警告）
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      eventBus.setWindowPresenter(mockWindowPresenter)
      eventBus.sendToWebContents(1, 'test:event', 'data')

      expect(consoleSpy).not.toHaveBeenCalled()
      consoleSpy.mockRestore()
    })
  })

  describe('错误处理', () => {
    beforeEach(() => {
      eventBus.setWindowPresenter(mockWindowPresenter)
    })

    it('当 webContents 不存在时应该显示警告', async () => {
      vi.mocked(mockWindowPresenter.sendToWebContents).mockResolvedValue(false)
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      eventBus.sendToWebContents(999, 'test:event', 'data')

      // 等待异步操作完成
      await new Promise((resolve) => setTimeout(resolve, 0))

      expect(consoleSpy).toHaveBeenCalledWith(
        'webContents 999 not found or destroyed, cannot send event test:event'
      )

      consoleSpy.mockRestore()
    })

    it('当发送 webContents 失败时应该记录错误', async () => {
      const error = new Error('Failed to send webContents event')
      vi.mocked(mockWindowPresenter.sendToWebContents).mockRejectedValue(error)
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      eventBus.sendToWebContents(1, 'test:event', 'data')

      // 等待异步操作完成
      await new Promise((resolve) => setTimeout(resolve, 0))

      expect(consoleSpy).toHaveBeenCalledWith(
        'Error sending event test:event to webContents 1:',
        error
      )

      consoleSpy.mockRestore()
    })
  })
})
