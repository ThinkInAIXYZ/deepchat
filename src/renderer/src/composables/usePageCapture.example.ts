// usePageCapture 使用示例

import { usePageCapture, createCapturePresets } from '@/composables/usePageCapture'
import { useLegacyDevicePresenter } from '@api/legacy/presenters'
import { useI18n } from 'vue-i18n'
import { ref } from 'vue'

// 在组件中使用示例
export function useMessageCapture() {
  const { t } = useI18n()
  const { isCapturing, captureAndCopy } = usePageCapture()
  const devicePresenter = useLegacyDevicePresenter()
  const appVersion = ref('')

  // 初始化应用版本
  const initAppVersion = async () => {
    appVersion.value = await devicePresenter.getAppVersion()
  }

  // 获取水印配置
  const getWatermarkConfig = (isDark: boolean, modelName?: string, providerName?: string) => ({
    isDark,
    version: appVersion.value,
    texts: {
      brand: 'DeepChat',
      tip: t('common.watermarkTip'),
      model: modelName,
      provider: providerName
    }
  })

  // 计算单个消息组范围（用户消息 + 助手消息）
  const calculateMessageGroupRect = (messageNode: HTMLElement, parentId?: string) => {
    const userMessageElement = parentId
      ? (document.querySelector(`[data-message-id="${parentId}"]`) as HTMLElement)
      : null

    if (!userMessageElement || !messageNode) {
      if (messageNode) {
        const rect = messageNode.getBoundingClientRect()
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
    const assistantRect = messageNode.getBoundingClientRect()

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

  // 计算从顶部到当前消息的范围
  const calculateFromTopToCurrentRect = (currentMessageNode: HTMLElement) => {
    const container = document.querySelector('.message-list-container')
    if (!container || !currentMessageNode) return null

    const allMessages = container.querySelectorAll('[data-message-id]')
    if (allMessages.length === 0) return null

    const firstMessage = allMessages[0] as HTMLElement
    const currentRect = currentMessageNode.getBoundingClientRect()
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

  // 截图单个消息组
  const captureMessageGroup = async (
    messageNode: HTMLElement,
    parentId: string | undefined,
    isDark: boolean,
    modelName?: string,
    providerName?: string
  ) => {
    return await captureAndCopy({
      container: '.message-list-container',
      getTargetRect: () => calculateMessageGroupRect(messageNode, parentId),
      watermark: getWatermarkConfig(isDark, modelName, providerName)
    })
  }

  // 截图从顶部到当前消息
  const captureFromTopToCurrent = async (
    currentMessageNode: HTMLElement,
    isDark: boolean,
    modelName?: string,
    providerName?: string
  ) => {
    return await captureAndCopy({
      container: '.message-list-container',
      getTargetRect: () => calculateFromTopToCurrentRect(currentMessageNode),
      watermark: getWatermarkConfig(isDark, modelName, providerName)
    })
  }

  // 使用预设配置截取整个会话
  const captureFullConversation = async (
    isDark: boolean,
    modelName?: string,
    providerName?: string
  ) => {
    const { captureFullConversation } = createCapturePresets()
    const config = captureFullConversation(getWatermarkConfig(isDark, modelName, providerName))
    return await captureAndCopy(config)
  }

  // 使用预设配置截取消息范围
  const captureMessageRange = async (
    startMessageId: string,
    endMessageId: string,
    isDark: boolean,
    modelName?: string,
    providerName?: string
  ) => {
    const { captureMessageRange } = createCapturePresets()
    const config = captureMessageRange(
      startMessageId,
      endMessageId,
      getWatermarkConfig(isDark, modelName, providerName)
    )
    return await captureAndCopy(config)
  }

  return {
    isCapturing,
    initAppVersion,
    captureMessageGroup,
    captureFromTopToCurrent,
    captureFullConversation,
    captureMessageRange
  }
}

// 在 MessageItemAssistant.vue 中的使用示例
/*
<script setup lang="ts">
import { useMessageCapture } from '@/composables/usePageCapture.example'

const {
  isCapturing: isCapturingImage,
  initAppVersion,
  captureMessageGroup,
  captureFromTopToCurrent
} = useMessageCapture()

// 在 onMounted 中初始化
onMounted(async () => {
  await initAppVersion()
})

// 处理复制图片操作
const handleCopyImage = async (fromTop: boolean = false) => {
  if (fromTop) {
    await captureFromTopToCurrent(
      messageNode.value,
      props.isDark,
      props.message.model_name,    // 传递模型名称
      props.message.model_provider // 传递供应商名称
    )
  } else {
    await captureMessageGroup(
      messageNode.value,
      props.message.parentId,
      props.isDark,
      props.message.model_name,    // 传递模型名称
      props.message.model_provider // 传递供应商名称
    )
  }
}
</script>
*/
