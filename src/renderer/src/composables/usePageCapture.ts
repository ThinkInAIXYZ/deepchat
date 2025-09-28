import { ref } from 'vue'
import { usePresenter } from './usePresenter'

export interface CaptureRect {
  x: number
  y: number
  width: number
  height: number
}

export interface WatermarkConfig {
  isDark?: boolean
  version?: string
  texts?: {
    brand?: string
    time?: string
    tip?: string
    model?: string // 模型名称
    provider?: string // 供应商名称
  }
}

export interface CaptureConfig {
  /**
   * 滚动容器，可以是CSS选择器字符串或HTML元素
   */
  container: string | HTMLElement

  /**
   * 获取目标截图区域的函数
   * @returns 返回目标区域的矩形信息，如果无法获取则返回null
   */
  getTargetRect: () => CaptureRect | null

  /**
   * 水印配置
   */
  watermark?: WatermarkConfig

  /**
   * 滚动行为，默认为 'auto'
   */
  scrollBehavior?: 'auto' | 'smooth'

  /**
   * 每次截图后的延迟时间（毫秒），默认为 350
   */
  captureDelay?: number

  /**
   * 最大迭代次数，防止无限循环，默认为 30
   */
  maxIterations?: number

  /**
   * 滚动条偏移量，避免截取滚动条，默认为 20
   */
  scrollbarOffset?: number

  /**
   * 容器顶部预留空间（如工具栏高度），默认为 44
   */
  containerHeaderOffset?: number
  isHTMLIframe?: boolean
}

export interface CaptureResult {
  success: boolean
  imageData?: string
  error?: string
}

export function usePageCapture() {
  const isCapturing = ref(false)
  const tabPresenter = usePresenter('tabPresenter')

  /**
   * 获取滚动容器元素
   */
  const getScrollContainer = (container: string | HTMLElement): HTMLElement | null => {
    if (typeof container === 'string') {
      return document.querySelector(container) as HTMLElement
    }
    return container
  }

  /**
   * 执行滚动操作，支持普通元素和 iframe
   */
  const performScroll = (
    scrollContainer: HTMLElement,
    scrollTop: number,
    isIframe: boolean = false
  ): void => {
    if (isIframe && scrollContainer.tagName.toLowerCase() === 'iframe') {
      const iframe = scrollContainer as HTMLIFrameElement
      if (iframe.contentWindow) {
        iframe.contentWindow.scrollTo(0, scrollTop)
      }
    } else {
      scrollContainer.scrollTop = scrollTop
    }
  }

  /**
   * 获取滚动位置，支持普通元素和 iframe
   */
  const getScrollTop = (scrollContainer: HTMLElement, isIframe: boolean = false): number => {
    if (isIframe && scrollContainer.tagName.toLowerCase() === 'iframe') {
      const iframe = scrollContainer as HTMLIFrameElement
      if (iframe.contentWindow) {
        return iframe.contentWindow.scrollY || iframe.contentWindow.pageYOffset || 0
      }
    }
    return scrollContainer.scrollTop
  }

  /**
   * 获取滚动容器的最大滚动高度
   */
  const getMaxScrollTop = (scrollContainer: HTMLElement, isIframe: boolean = false): number => {
    if (isIframe && scrollContainer.tagName.toLowerCase() === 'iframe') {
      const iframe = scrollContainer as HTMLIFrameElement
      if (iframe.contentWindow && iframe.contentDocument) {
        const doc = iframe.contentDocument
        return Math.max(
          doc.body.scrollHeight - iframe.contentWindow.innerHeight,
          doc.documentElement.scrollHeight - iframe.contentWindow.innerHeight
        )
      }
    }
    return scrollContainer.scrollHeight - scrollContainer.clientHeight
  }

  /**
   * 获取 iframe 内容的实际高度
   */
  const getIframeContentHeight = (iframe: HTMLIFrameElement): number => {
    if (iframe.contentDocument) {
      const doc = iframe.contentDocument
      return Math.max(
        doc.body.scrollHeight || 0,
        doc.documentElement.scrollHeight || 0,
        doc.body.offsetHeight || 0,
        doc.documentElement.offsetHeight || 0
      )
    }
    return 0
  }

  /**
   * 执行页面区域截图
   * @param config 截图配置
   * @returns 返回截图结果
   */
  const captureArea = async (config: CaptureConfig): Promise<CaptureResult> => {
    if (isCapturing.value) {
      return { success: false, error: '正在进行截图，请稍候...' }
    }

    isCapturing.value = true
    let originalScrollBehavior = ''
    let scrollContainer: HTMLElement | null = null

    try {
      // 配置默认参数
      const {
        scrollBehavior = 'auto',
        captureDelay = 350,
        maxIterations = 30,
        scrollbarOffset = 20,
        containerHeaderOffset = 44,
        isHTMLIframe = false
      } = config

      // 获取初始目标区域
      const initialRect = config.getTargetRect()
      if (!initialRect) {
        return { success: false, error: '无法获取截图目标区域' }
      }

      if (initialRect.height <= 0) {
        return { success: false, error: '截图区域高度无效' }
      }

      // 获取当前标签页ID
      const tabId = window.api.getWebContentsId()

      // 获取滚动容器
      scrollContainer = getScrollContainer(config.container)
      if (!scrollContainer) {
        return { success: false, error: '无法找到滚动容器' }
      }

      // 对于 iframe，我们需要获取其内容的实际高度
      let targetContentHeight = initialRect.height
      if (isHTMLIframe && scrollContainer.tagName.toLowerCase() === 'iframe') {
        const iframe = scrollContainer as HTMLIFrameElement
        const iframeContentHeight = getIframeContentHeight(iframe)
        if (iframeContentHeight > 0) {
          // 使用 iframe 内容的实际高度作为截图目标高度
          targetContentHeight = iframeContentHeight
        }
      }

      // 保存原始滚动行为并设置为指定行为
      originalScrollBehavior = scrollContainer.style.scrollBehavior
      scrollContainer.style.scrollBehavior = scrollBehavior

      // 记录容器原始滚动位置
      const containerOriginalScrollTop = getScrollTop(scrollContainer, isHTMLIframe)
      const containerRect = scrollContainer.getBoundingClientRect()

      // 计算可见截图窗口
      const captureWindowVisibleHeight = containerRect.height - containerHeaderOffset
      const fixedCaptureWindow = {
        x: containerRect.left,
        y: containerRect.top,
        width: containerRect.width - scrollbarOffset,
        height: captureWindowVisibleHeight
      }

      const maxScrollTop = getMaxScrollTop(scrollContainer, isHTMLIframe)
      const imageDataList: string[] = []
      let totalCapturedContentHeight = 0
      let iteration = 0

      // 分段截图循环
      while (totalCapturedContentHeight < targetContentHeight && iteration < maxIterations) {
        iteration++

        // 重新获取当前目标区域（可能因滚动而变化）
        const currentActualInitialRect = config.getTargetRect()
        if (!currentActualInitialRect) {
          console.error(`[CAPTURE_DEBUG] Iteration ${iteration}: 无法获取当前目标区域`)
          break
        }

        // 计算需要滚动到的位置
        const targetContentSegmentTopInCurrentInitialRectY =
          currentActualInitialRect.y + totalCapturedContentHeight
        const scrollTopTarget =
          getScrollTop(scrollContainer, isHTMLIframe) +
          targetContentSegmentTopInCurrentInitialRectY -
          fixedCaptureWindow.y

        const currentScroll = Math.max(0, Math.min(scrollTopTarget, maxScrollTop))

        // 执行滚动
        performScroll(scrollContainer, currentScroll, isHTMLIframe)
        await new Promise((resolve) => setTimeout(resolve, captureDelay))

        // 重新获取滚动后的目标区域
        const finalInitialRectStateAfterScroll = config.getTargetRect()
        if (!finalInitialRectStateAfterScroll) {
          console.error(`[CAPTURE_DEBUG] Iteration ${iteration}: 滚动后无法获取目标区域`)
          break
        }

        const finalScRect = scrollContainer.getBoundingClientRect()
        const topOfUncapturedContentInViewport =
          finalInitialRectStateAfterScroll.y + totalCapturedContentHeight
        const contentOffsetYInCaptureWindow = topOfUncapturedContentInViewport - finalScRect.top

        // 计算当前段的截图参数
        let captureStartYInWindow = 0
        let heightToCaptureFromSegment = 0

        if (contentOffsetYInCaptureWindow < 0) {
          captureStartYInWindow = 0
          heightToCaptureFromSegment = Math.min(
            targetContentHeight - totalCapturedContentHeight + contentOffsetYInCaptureWindow,
            fixedCaptureWindow.height
          )
        } else {
          captureStartYInWindow = contentOffsetYInCaptureWindow
          heightToCaptureFromSegment = Math.min(
            targetContentHeight - totalCapturedContentHeight,
            fixedCaptureWindow.height - contentOffsetYInCaptureWindow
          )
        }

        heightToCaptureFromSegment = Math.max(0, heightToCaptureFromSegment)

        if (heightToCaptureFromSegment < 1 && targetContentHeight > totalCapturedContentHeight) {
          break
        }

        // 构建截图区域
        const captureRect: CaptureRect = {
          x: fixedCaptureWindow.x,
          y: Math.round(finalScRect.top + captureStartYInWindow),
          width: fixedCaptureWindow.width,
          height: Math.round(heightToCaptureFromSegment)
        }

        // 执行截图
        try {
          const segmentData = await tabPresenter.captureTabArea(tabId, captureRect)
          if (segmentData) {
            imageDataList.push(segmentData)
          } else {
            console.error(`[CAPTURE_DEBUG] Iteration ${iteration}: 截图失败，未返回数据`)
            break
          }
        } catch (captureError) {
          console.error(`[CAPTURE_DEBUG] Iteration ${iteration}: 截图出错:`, captureError)
          break
        }

        totalCapturedContentHeight += heightToCaptureFromSegment
      }

      // 恢复原始滚动位置
      performScroll(scrollContainer, containerOriginalScrollTop, isHTMLIframe)

      // 检查是否有截图数据
      if (imageDataList.length === 0) {
        if (targetContentHeight > 0) {
          return { success: false, error: '截图失败，未能捕获任何图像数据' }
        }
        return { success: false, error: '目标区域高度为0，无需截图' }
      }

      // 拼接图片并添加水印
      let finalImage: string | null = null
      if (config.watermark) {
        finalImage = await tabPresenter.stitchImagesWithWatermark(imageDataList, config.watermark)
      } else {
        // 如果不需要水印，只拼接图片
        finalImage = await tabPresenter.stitchImagesWithWatermark(imageDataList, {})
      }

      if (!finalImage) {
        return { success: false, error: '图片拼接失败' }
      }

      return { success: true, imageData: finalImage }
    } catch (error) {
      console.error('截图过程中发生错误:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : '未知错误'
      }
    } finally {
      // 恢复原始滚动行为
      if (scrollContainer && originalScrollBehavior !== undefined) {
        scrollContainer.style.scrollBehavior = originalScrollBehavior
      }
      isCapturing.value = false
    }
  }

  /**
   * 直接复制截图到剪贴板
   * @param config 截图配置
   * @returns 返回操作是否成功
   */
  const captureAndCopy = async (config: CaptureConfig): Promise<boolean> => {
    const result = await captureArea(config)

    if (result.success && result.imageData) {
      window.api.copyImage(result.imageData)
      return true
    }

    return false
  }

  return {
    isCapturing,
    captureArea,
    captureAndCopy
  }
}

/**
 * 预设的截图配置函数
 */
export const createCapturePresets = () => {
  /**
   * 截取整个会话的配置
   * @param watermarkConfig 水印配置
   * @returns 截图配置
   */
  const captureFullConversation = (watermarkConfig?: WatermarkConfig): CaptureConfig => ({
    container: '.message-list-container',
    getTargetRect: () => {
      const container = document.querySelector('.message-list-container')
      if (!container) return null

      const rect = container.getBoundingClientRect()
      return {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      }
    },
    watermark: watermarkConfig,
    containerHeaderOffset: 44 // 顶部工具栏高度
  })

  /**
   * 截取指定消息范围的配置
   * @param startMessageId 起始消息ID
   * @param endMessageId 结束消息ID
   * @param watermarkConfig 水印配置
   * @returns 截图配置
   */
  const captureMessageRange = (
    startMessageId: string,
    endMessageId: string,
    watermarkConfig?: WatermarkConfig
  ): CaptureConfig => ({
    container: '.message-list-container',
    getTargetRect: () => {
      const startElement = document.querySelector(`[data-message-id="${startMessageId}"]`)
      const endElement = document.querySelector(`[data-message-id="${endMessageId}"]`)

      if (!startElement || !endElement) return null

      const startRect = startElement.getBoundingClientRect()
      const endRect = endElement.getBoundingClientRect()

      const left = Math.min(startRect.left, endRect.left)
      const top = Math.min(startRect.top, endRect.top)
      const right = Math.max(startRect.right, endRect.right)
      const bottom = Math.max(startRect.bottom, endRect.bottom)

      return {
        x: Math.round(left),
        y: Math.round(top),
        width: Math.round(right - left),
        height: Math.round(bottom - top)
      }
    },
    watermark: watermarkConfig
  })

  /**
   * 截取自定义选择器范围的配置
   * @param selector CSS选择器
   * @param containerSelector 滚动容器选择器，默认为 '.message-list-container'
   * @param watermarkConfig 水印配置
   * @returns 截图配置
   */
  const captureCustomElement = (
    selector: string,
    containerSelector: string = '.message-list-container',
    watermarkConfig?: WatermarkConfig
  ): CaptureConfig => ({
    container: containerSelector,
    getTargetRect: () => {
      const element = document.querySelector(selector)
      if (!element) return null

      const rect = element.getBoundingClientRect()
      return {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      }
    },
    watermark: watermarkConfig
  })

  return {
    captureFullConversation,
    captureMessageRange,
    captureCustomElement
  }
}
