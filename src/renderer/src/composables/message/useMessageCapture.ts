import { ref, onUnmounted } from 'vue'
import { usePageCapture } from '@/composables/usePageCapture'
import { useThemeStore } from '@/stores/theme'
import { usePresenter } from '@/composables/usePresenter'
import { useI18n } from 'vue-i18n'
import type { CaptureOptions } from './types'

export function useMessageCapture() {
  const { t } = useI18n()
  const themeStore = useThemeStore()
  const devicePresenter = usePresenter('devicePresenter')
  const { isCapturing, captureAndCopy } = usePageCapture()

  const appVersion = ref('')

  // Initialize app version
  devicePresenter.getAppVersion().then((version) => {
    appVersion.value = version
  })

  // Cache container element
  let containerCache: Element | null = null

  const getContainer = () => {
    if (!containerCache) {
      containerCache = document.querySelector('.message-list-container')
    }
    return containerCache
  }

  // Clear cache on unmount
  onUnmounted(() => {
    containerCache = null
  })

  const findUserMessageElement = (parentId: string): HTMLElement | null => {
    if (!parentId) return null
    const userMessageSelector = `[data-message-id="${parentId}"]`
    return document.querySelector(userMessageSelector) as HTMLElement
  }

  const calculateMessageGroupRect = (
    messageId: string,
    parentId?: string
  ): {
    x: number
    y: number
    width: number
    height: number
  } | null => {
    const userMessageElement = parentId ? findUserMessageElement(parentId) : null
    const assistantMessageElement = document.querySelector(
      `[data-message-id="${messageId}"]`
    ) as HTMLElement

    if (!userMessageElement || !assistantMessageElement) {
      if (assistantMessageElement) {
        const rect = assistantMessageElement.getBoundingClientRect()
        return {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height)
        }
      }
      return null
    }

    const userRect = userMessageElement.getBoundingClientRect()
    const assistantRect = assistantMessageElement.getBoundingClientRect()

    const left = Math.min(userRect.left, assistantRect.left)
    const top = Math.min(userRect.top, assistantRect.top)
    const right = Math.max(userRect.right, assistantRect.right)
    const bottom = Math.max(userRect.bottom, assistantRect.bottom)

    return {
      x: Math.round(left),
      y: Math.round(top),
      width: Math.round(right - left),
      height: Math.round(bottom - top)
    }
  }

  const calculateFromTopToCurrentRect = (
    messageId: string
  ): {
    x: number
    y: number
    width: number
    height: number
  } | null => {
    const currentMessageElement = document.querySelector(
      `[data-message-id="${messageId}"]`
    ) as HTMLElement
    if (!currentMessageElement) return null

    const container = getContainer()
    if (!container) return null

    const allMessages = container.querySelectorAll('[data-message-id]')
    if (allMessages.length === 0) return null

    const firstMessage = allMessages[0] as HTMLElement
    const currentRect = currentMessageElement.getBoundingClientRect()
    const firstRect = firstMessage.getBoundingClientRect()

    const left = Math.min(firstRect.left, currentRect.left)
    const top = Math.min(firstRect.top, currentRect.top)
    const right = Math.max(firstRect.right, currentRect.right)
    const bottom = Math.max(firstRect.bottom, currentRect.bottom)

    return {
      x: Math.round(left),
      y: Math.round(top),
      width: Math.round(right - left),
      height: Math.round(bottom - top)
    }
  }

  const captureMessage = async (options: CaptureOptions): Promise<boolean> => {
    const { messageId, parentId, fromTop = false, modelInfo } = options

    const getTargetRect = fromTop
      ? () => calculateFromTopToCurrentRect(messageId)
      : () => calculateMessageGroupRect(messageId, parentId)

    const success = await captureAndCopy({
      container: '.message-list-container',
      getTargetRect,
      watermark: {
        isDark: themeStore.isDark,
        version: appVersion.value,
        texts: {
          brand: 'DeepChat',
          tip: t('common.watermarkTip'),
          model: modelInfo?.model_name,
          provider: modelInfo?.model_provider
        }
      }
    })

    if (!success) {
      console.error('Screenshot copy failed')
    }

    return success
  }

  return {
    isCapturing,
    captureMessage
  }
}
