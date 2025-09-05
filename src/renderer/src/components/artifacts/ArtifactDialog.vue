<template>
  <Transition
    enter-active-class="transition ease-out duration-200"
    enter-from-class="translate-x-full"
    enter-to-class="translate-x-0"
    leave-active-class="transition ease-in duration-200"
    leave-from-class="translate-x-0"
    leave-to-class="translate-x-full"
  >
    <div
      v-if="artifactStore.isOpen"
      class="absolute right-0 top-0 bottom-0 w-[calc(60%_-_104px)] border-l shadow-lg flex flex-col max-lg:!w-3/4 max-lg:bg-white max-lg:dark:!bg-black z-[60]"
    >
      <!-- 顶部导航栏 -->
      <div
        class="flex items-center justify-between bg-card px-4 h-11 border-b w-full overflow-hidden"
      >
        <div class="flex items-center gap-2 flex-grow w-0">
          <button class="p-2 hover:bg-accent/50 rounded-md" @click="artifactStore.hideArtifact">
            <Icon icon="lucide:arrow-left" class="w-4 h-4" />
          </button>
          <h2 class="text-sm font-medium truncate">{{ artifactStore.currentArtifact?.title }}</h2>
        </div>

        <div class="flex items-center gap-2">
          <!-- 预览/代码切换按钮组 -->
          <div class="bg-border p-0.5 rounded-lg flex items-center">
            <button
              class="px-2 py-1 text-xs rounded-md transition-colors"
              :class="
                isPreview
                  ? 'bg-background shadow-sm'
                  : 'text-muted-foreground hover:bg-background/50'
              "
              @click="setPreview(true)"
            >
              {{ t('artifacts.preview') }}
            </button>
            <button
              class="px-2 py-1 text-xs rounded-md transition-colors"
              :class="
                !isPreview
                  ? 'bg-background shadow-sm'
                  : 'text-muted-foreground hover:bg-background/50'
              "
              @click="setPreview(false)"
            >
              {{ t('artifacts.code') }}
            </button>
          </div>

          <!-- 设备尺寸切换按钮组 (仅在HTML预览时显示) -->
          <div
            v-if="isPreview && artifactStore.currentArtifact?.type === 'text/html'"
            class="bg-border p-0.5 rounded-lg flex items-center"
          >
            <button
              class="px-2 py-1 text-xs rounded-md transition-colors"
              :class="
                viewportSize === 'desktop'
                  ? 'bg-background shadow-sm'
                  : 'text-muted-foreground hover:bg-background/50'
              "
              @click="setViewportSize('desktop')"
              :title="t('artifacts.desktop')"
            >
              <Icon icon="lucide:monitor" class="w-3 h-3" />
            </button>
            <button
              class="px-2 py-1 text-xs rounded-md transition-colors"
              :class="
                viewportSize === 'tablet'
                  ? 'bg-background shadow-sm'
                  : 'text-muted-foreground hover:bg-background/50'
              "
              @click="setViewportSize('tablet')"
              :title="t('artifacts.tablet')"
            >
              <Icon icon="lucide:tablet" class="w-3 h-3" />
            </button>
            <button
              class="px-2 py-1 text-xs rounded-md transition-colors"
              :class="
                viewportSize === 'mobile'
                  ? 'bg-background shadow-sm'
                  : 'text-muted-foreground hover:bg-background/50'
              "
              @click="setViewportSize('mobile')"
              :title="t('artifacts.mobile')"
            >
              <Icon icon="lucide:smartphone" class="w-3 h-3" />
            </button>
          </div>

          <!-- 尺寸微调输入框 (仅在平板和手机模式下显示) -->
          <div
            v-if="
              isPreview &&
              artifactStore.currentArtifact?.type === 'text/html' &&
              viewportSize !== 'desktop'
            "
            class="flex items-center gap-2 bg-border p-1 rounded-lg"
          >
            <span class="text-xs text-muted-foreground whitespace-nowrap"
              >{{ t('artifacts.width') }}:</span
            >
            <input
              v-if="viewportSize === 'tablet'"
              v-model.number="tabletWidth"
              type="number"
              min="320"
              max="1200"
              class="w-16 px-2 py-1 text-xs rounded border-0 bg-background focus:ring-1 focus:ring-blue-500 focus:outline-none text-center"
            />
            <input
              v-else-if="viewportSize === 'mobile'"
              v-model.number="mobileWidth"
              type="number"
              min="320"
              max="480"
              class="w-16 px-2 py-1 text-xs rounded border-0 bg-background focus:ring-1 focus:ring-blue-500 focus:outline-none text-center"
            />
            <span class="text-xs text-muted-foreground">×</span>
            <input
              v-if="viewportSize === 'tablet'"
              v-model.number="tabletHeight"
              type="number"
              min="426"
              max="1400"
              class="w-16 px-2 py-1 text-xs rounded border-0 bg-background focus:ring-1 focus:ring-blue-500 focus:outline-none text-center"
            />
            <input
              v-else-if="viewportSize === 'mobile'"
              v-model.number="mobileHeight"
              type="number"
              min="426"
              max="1000"
              class="w-16 px-2 py-1 text-xs rounded border-0 bg-background focus:ring-1 focus:ring-blue-500 focus:outline-none text-center"
            />
            <span class="text-xs text-muted-foreground">px</span>
          </div>

          <!-- 导出按钮 -->
          <div class="flex items-center gap-1">
            <Button
              v-if="
                artifactStore.currentArtifact?.type === 'image/svg+xml' ||
                artifactStore.currentArtifact?.type === 'application/vnd.ant.mermaid'
              "
              variant="outline"
              size="sm"
              :title="t('artifacts.export')"
              class="text-xs h-7"
              @click="exportSVG"
            >
              <Icon icon="lucide:download" class="w-4 h-4" />
            </Button>
            <Button
              v-if="isPreview && artifactStore.currentArtifact?.content"
              variant="outline"
              size="sm"
              class="text-xs h-7"
              :title="t('artifacts.copy')"
              @click="copyContent"
            >
              <Icon icon="lucide:copy" class="w-4 h-4" />
            </Button>
            <Button
              v-if="
                isPreview &&
                artifactStore.currentArtifact?.type !== 'text/html' &&
                artifactStore.currentArtifact?.type !== 'application/vnd.ant.react'
              "
              variant="outline"
              size="sm"
              class="text-xs h-7"
              :title="t('artifacts.copyAsImage')"
              @click="handleCopyAsImage"
            >
              <Icon icon="lucide:image" class="w-4 h-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              class="text-xs h-7"
              :title="t('artifacts.export')"
              @click="exportCode"
            >
              <Icon icon="lucide:download" class="w-4 h-4" />
            </Button>
          </div>
        </div>
      </div>

      <!-- 内容区域 -->
      <div class="flex-1 overflow-auto h-0 artifact-scroll-container">
        <template v-if="isPreview">
          <component
            :is="artifactComponent"
            v-if="artifactComponent && artifactStore.currentArtifact"
            :key="componentKey"
            :block="{
              content: artifactStore.currentArtifact.content,
              artifact: {
                type: artifactStore.currentArtifact.type,
                title: artifactStore.currentArtifact.title
              }
            }"
            :is-preview="isPreview"
            :viewport-size="viewportSize"
            v-model:tablet-width="tabletWidth"
            v-model:mobile-width="mobileWidth"
            v-model:tablet-height="tabletHeight"
            v-model:mobile-height="mobileHeight"
            class="artifact-dialog-content"
          />
        </template>
        <template v-else>
          <div
            ref="codeEditor"
            class="min-h-[30px] max-h-[500px] text-xs overflow-auto bg-background font-mono leading-relaxed"
            :data-language="codeLanguage"
          ></div>
        </template>
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useArtifactStore } from '@/stores/artifact'
import { Icon } from '@iconify/vue'
import Button from '@/components/ui/button/Button.vue'
import CodeArtifact from './CodeArtifact.vue'
import MarkdownArtifact from './MarkdownArtifact.vue'
import HTMLArtifact from './HTMLArtifact.vue'
import SvgArtifact from './SvgArtifact.vue'
import MermaidArtifact from './MermaidArtifact.vue'
import mermaid from 'mermaid'
import { useI18n } from 'vue-i18n'
import ReactArtifact from './ReactArtifact.vue'
import { useToast } from '@/components/ui/toast/use-toast'
import { usePageCapture } from '@/composables/usePageCapture'
import { useThemeStore } from '@/stores/theme'
import { usePresenter } from '@/composables/usePresenter'
import { useThrottleFn } from '@vueuse/core'
import { useMonaco, detectLanguage } from 'vue-use-monaco'

const artifactStore = useArtifactStore()
const componentKey = ref(0)
const isPreview = ref(false)
const viewportSize = ref<'desktop' | 'tablet' | 'mobile'>('desktop')
const tabletWidth = ref(768)
const mobileWidth = ref(375)
const tabletHeight = ref(1024) // 4:3 比例
const mobileHeight = ref(667) // 16:9 比例
const t = useI18n().t
const { toast } = useToast()
const themeStore = useThemeStore()
const devicePresenter = usePresenter('devicePresenter')
const appVersion = ref('')
const codeLanguage = ref(
  artifactStore.currentArtifact?.language || artifactStore.currentArtifact?.type || ''
)
const { createEditor, updateCode } = useMonaco({
  MAX_HEIGHT: '500px',
  wordWrap: 'on',
  wrappingIndent: 'same'
})
const codeEditor = ref<any>(null)

// 创建节流版本的语言检测函数，1秒内最多执行一次
const throttledDetectLanguage = useThrottleFn(
  (code: string) => {
    codeLanguage.value = detectLanguage(code)
  },
  1000,
  true
)

watch(
  () => artifactStore.currentArtifact,
  (newArtifact) => {
    if (!newArtifact) return

    // Update language detection
    codeLanguage.value = newArtifact.language || getFileExtension(newArtifact.type || '')

    if (codeLanguage.value === 'mermaid') {
      return
    }

    const newCode = newArtifact.content || ''

    // Check if we need to detect language
    if (!codeLanguage.value || codeLanguage.value === '') {
      throttledDetectLanguage(newCode)
    }

    // Always update Monaco editor content
    updateCode(newCode, codeLanguage.value)
  },
  {
    immediate: true,
    deep: true // Add deep watching to catch property changes
  }
)

// Initialize language detection if needed
if (!codeLanguage.value || codeLanguage.value === '') {
  throttledDetectLanguage(artifactStore.currentArtifact?.content || '')
}

watch(
  () => codeLanguage.value,
  () => {
    updateCode(artifactStore.currentArtifact?.content || '', codeLanguage.value)
  }
)

// Add a specific watcher for content changes to ensure real-time updates
watch(
  () => artifactStore.currentArtifact?.content,
  (newContent) => {
    if (newContent !== undefined) {
      updateCode(newContent, codeLanguage.value)
    }
  },
  {
    immediate: true
  }
)

watch(
  () => codeEditor.value,
  () => {
    if (!codeEditor.value) return
    createEditor(codeEditor.value, artifactStore.currentArtifact?.content || '', codeLanguage.value)
  }
)

// 截图相关功能
const { captureAndCopy } = usePageCapture()

const setPreview = (value: boolean) => {
  isPreview.value = value
}

const setViewportSize = (size: 'desktop' | 'tablet' | 'mobile') => {
  viewportSize.value = size
}

// 监听 artifact 变化，强制重新渲染组件
watch(
  () => artifactStore.currentArtifact,
  () => {
    componentKey.value++
  },
  {
    immediate: true
  }
)

watch(
  () => artifactStore.currentArtifact?.status,
  () => {
    if (artifactStore.currentArtifact?.status === 'loaded') {
      isPreview.value = true
    }
  },
  {
    immediate: true
  }
)

watch(
  () => artifactStore.isOpen,
  () => {
    if (artifactStore.isOpen) {
      if (artifactStore.currentArtifact?.status === 'loaded') {
        isPreview.value = true
      } else {
        isPreview.value = false
      }
    }
  }
)

onMounted(async () => {
  // 获取应用版本
  appVersion.value = await devicePresenter.getAppVersion()
})

const artifactComponent = computed(() => {
  if (!artifactStore.currentArtifact) return null
  switch (artifactStore.currentArtifact.type) {
    case 'application/vnd.ant.code':
      return CodeArtifact
    case 'text/markdown':
      return MarkdownArtifact
    case 'text/html':
      return HTMLArtifact
    case 'image/svg+xml':
      return SvgArtifact
    case 'application/vnd.ant.mermaid':
      return MermaidArtifact
    case 'application/vnd.ant.react':
      return ReactArtifact
    default:
      return null
  }
})

function getFileExtension(type: string) {
  switch (type) {
    case 'application/vnd.ant.code':
      return 'txt'
    case 'text/markdown':
      return 'md'
    case 'text/html':
      return 'html'
    case 'image/svg+xml':
      return 'svg'
    case 'application/vnd.ant.mermaid':
      return 'mdm'
    case 'application/vnd.ant.react':
      return 'jsx'
    default:
      return 'txt'
  }
}

const exportSVG = async () => {
  if (!artifactStore.currentArtifact?.content) return

  try {
    let svgContent = artifactStore.currentArtifact.content

    // 如果是 Mermaid 图表，需要先渲染成 SVG
    if (artifactStore.currentArtifact.type === 'application/vnd.ant.mermaid') {
      const { svg } = await mermaid.render('export-diagram', artifactStore.currentArtifact.content)
      svgContent = svg
    }

    // 确保 SVG 内容是有效的
    if (!svgContent.trim().startsWith('<svg')) {
      throw new Error('Invalid SVG content')
    }

    const blob = new Blob([svgContent], { type: 'image/svg+xml' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${artifactStore.currentArtifact.title || 'artifact'}.svg`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  } catch (error) {
    console.error('Failed to export SVG:', error)
  }
}

const exportCode = () => {
  if (artifactStore.currentArtifact?.content) {
    const extension = getFileExtension(artifactStore.currentArtifact.type)
    const blob = new Blob([artifactStore.currentArtifact.content], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${artifactStore.currentArtifact.title || 'artifact'}.${extension}`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }
}
const copyContent = async () => {
  if (artifactStore.currentArtifact?.content) {
    try {
      await navigator.clipboard.writeText(artifactStore.currentArtifact.content)
      toast({
        title: t('artifacts.copySuccess'),
        description: t('artifacts.copySuccessDesc')
      })
    } catch (e) {
      console.error('复制失败', e)
      toast({
        title: t('artifacts.copyFailed'),
        description: t('artifacts.copyFailedDesc'),
        variant: 'destructive'
      })
    }
  }
}

const handleCopyAsImage = async () => {
  if (!artifactStore.currentArtifact) return

  // 检查是否是 iframe 类型的 artifact (HTML 或 React)
  const isIframeArtifact =
    artifactStore.currentArtifact.type === 'text/html' ||
    artifactStore.currentArtifact.type === 'application/vnd.ant.react'

  let containerSelector: string
  let targetSelector: string

  if (isIframeArtifact) {
    // 对于 iframe 类型，我们使用 iframe 元素作为滚动容器
    containerSelector = '.html-iframe-wrapper'
    targetSelector = '.html-iframe-wrapper'
  } else {
    // 非 iframe 类型使用默认配置
    containerSelector = '.artifact-scroll-container'
    targetSelector = '.artifact-dialog-content'
  }

  const success = await captureAndCopy({
    container: containerSelector,
    getTargetRect: () => {
      const element = document.querySelector(targetSelector)
      if (!element) return null
      const rect = element.getBoundingClientRect()
      return {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      }
    },
    isHTMLIframe: isIframeArtifact,
    watermark: {
      isDark: themeStore.isDark,
      version: appVersion.value,
      texts: {
        brand: 'DeepChat',
        tip: t('common.watermarkTip')
      }
    }
  })

  if (success) {
    toast({
      title: t('artifacts.copySuccess'),
      description: t('artifacts.copyImageSuccessDesc')
    })
  } else {
    toast({
      title: t('artifacts.copyFailed'),
      description: t('artifacts.copyImageFailedDesc'),
      variant: 'destructive'
    })
  }
}
</script>

<style>
.mermaid-artifact {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
}
</style>
