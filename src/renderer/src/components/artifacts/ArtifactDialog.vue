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
      class="absolute right-0 top-0 bottom-0 w-[calc(60%-104px)] border-l shadow-lg flex flex-col max-lg:w-3/4! max-lg:bg-white max-lg:dark:bg-black! z-60"
    >
      <!-- 顶部导航栏 -->
      <div
        class="flex items-center justify-between bg-card px-4 h-11 border-b w-full overflow-hidden"
      >
        <div class="flex items-center gap-2 grow w-0">
          <button class="p-2 hover:bg-accent/50 rounded-md" @click="artifactStore.dismissArtifact">
            <Icon icon="lucide:arrow-left" class="w-4 h-4" />
          </button>
          <h2 class="text-sm font-medium truncate">{{ artifactStore.currentArtifact?.title }}</h2>
        </div>

        <div class="flex items-center gap-2">
          <!-- 设备选择下拉菜单 (仅在HTML预览时显示) -->
          <DropdownMenu v-if="shouldShowViewportControls">
            <DropdownMenuTrigger as-child>
              <Button
                variant="outline"
                size="sm"
                class="h-7 gap-1 text-xs px-2"
                :title="currentDevice.title"
              >
                <Icon :icon="currentDevice.icon" class="w-3.5 h-3.5" />
                <Icon icon="lucide:chevron-down" class="w-3 h-3 opacity-50" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent class="w-56 z-[70]" align="start">
              <DropdownMenuItem
                v-for="device in deviceSizes"
                :key="device.value"
                class="flex items-center justify-between cursor-pointer"
                @click="device.onClick"
              >
                <div class="flex items-center gap-2">
                  <Icon :icon="device.icon" class="w-4 h-4" />
                  <span>{{ device.title }}</span>
                </div>
                <span class="text-xs text-muted-foreground ml-2">{{ device.dimensions }}</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <!-- 预览/代码切换按钮组 -->
          <div class="bg-border p-0.5 rounded-lg flex items-center">
            <button
              v-for="mode in viewModes"
              :key="mode.value"
              class="px-2 py-1 text-xs rounded-md transition-colors"
              :class="
                mode.isActive()
                  ? 'bg-background shadow-sm'
                  : 'text-muted-foreground hover:bg-background/50'
              "
              @click="mode.onClick"
            >
              {{ mode.label }}
            </button>
          </div>

          <!-- 导出按钮 -->
          <div class="flex items-center gap-1">
            <Button
              v-for="action in visibleActions"
              :key="action.key"
              variant="outline"
              size="sm"
              :title="action.title"
              class="text-xs h-7"
              @click="action.onClick"
            >
              <Icon :icon="action.icon" class="w-4 h-4" />
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
            :key="context.componentKey.value"
            :block="{
              content: artifactStore.currentArtifact.content,
              artifact: {
                type: artifactStore.currentArtifact.type,
                title: artifactStore.currentArtifact.title
              }
            }"
            :is-preview="isPreview"
            :viewport-size="viewportSize"
            class="artifact-dialog-content"
          />
        </template>
        <template v-else>
          <div
            ref="codeEditorRef"
            class="min-h-[30px] h-full! text-xs overflow-auto bg-background font-mono leading-relaxed"
            :data-language="codeEditor.codeLanguage.value"
          ></div>
        </template>
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
// === Vue Core ===
import { computed, onMounted, ref } from 'vue'
import { storeToRefs } from 'pinia'

// === Stores ===
import { useArtifactStore } from '@/stores/artifact'
import { useThemeStore } from '@/stores/theme'

// === Components ===
import { Icon } from '@iconify/vue'
import { Button } from '@shadcn/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@shadcn/components/ui/dropdown-menu'
import CodeArtifact from './CodeArtifact.vue'
import MarkdownArtifact from './MarkdownArtifact.vue'
import HTMLArtifact from './HTMLArtifact.vue'
import SvgArtifact from './SvgArtifact.vue'
import MermaidArtifact from './MermaidArtifact.vue'
import ReactArtifact from './ReactArtifact.vue'

// === Composables ===
import { useI18n } from 'vue-i18n'
import { useToast } from '@/components/use-toast'
import { usePageCapture } from '@/composables/usePageCapture'
import { usePresenter } from '@/composables/usePresenter'
import { useArtifactViewMode } from '@/composables/useArtifactViewMode'
import { useViewportSize } from '@/composables/useViewportSize'
import { useArtifactCodeEditor } from '@/composables/useArtifactCodeEditor'
import { useArtifactExport } from '@/composables/useArtifactExport'
import { useArtifactContext } from '@/composables/useArtifactContext'

// === Stores ===
const artifactStore = useArtifactStore()
const themeStore = useThemeStore()

// === Extract reactive refs from store ===
const { currentArtifact, isOpen, currentThreadId, currentMessageId } = storeToRefs(artifactStore)

// === Composable Integrations ===
const { t } = useI18n()
const { toast } = useToast()
const { captureAndCopy } = usePageCapture()
const devicePresenter = usePresenter('devicePresenter')

const { isPreview, setPreview } = useArtifactViewMode(currentArtifact)
const { viewportSize, setViewportSize, TABLET_WIDTH, TABLET_HEIGHT, MOBILE_WIDTH, MOBILE_HEIGHT } =
  useViewportSize()
const context = useArtifactContext(currentArtifact, currentThreadId, currentMessageId)

const codeEditorRef = ref<HTMLElement | null>(null)
const codeEditor = useArtifactCodeEditor(currentArtifact, codeEditorRef, isPreview, isOpen)

const artifactExport = useArtifactExport(captureAndCopy)

// === Local State ===
const appVersion = ref('')

// === Computed ===
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

const shouldShowViewportControls = computed(() => {
  return isPreview.value && artifactStore.currentArtifact?.type === 'text/html'
})

// === Configuration Objects ===
const viewModes = computed(() => [
  {
    value: 'preview',
    label: t('artifacts.preview'),
    isActive: () => isPreview.value,
    onClick: () => setPreview(true)
  },
  {
    value: 'code',
    label: t('artifacts.code'),
    isActive: () => !isPreview.value,
    onClick: () => setPreview(false)
  }
])

const deviceSizes = computed(() => [
  {
    value: 'desktop',
    icon: 'lucide:monitor',
    title: t('artifacts.desktop'),
    dimensions: t('artifacts.responsive'),
    isActive: () => viewportSize.value === 'desktop',
    onClick: () => setViewportSize('desktop')
  },
  {
    value: 'tablet',
    icon: 'lucide:tablet',
    title: t('artifacts.tablet'),
    dimensions: `${TABLET_WIDTH}×${TABLET_HEIGHT}`,
    isActive: () => viewportSize.value === 'tablet',
    onClick: () => setViewportSize('tablet')
  },
  {
    value: 'mobile',
    icon: 'lucide:smartphone',
    title: t('artifacts.mobile'),
    dimensions: `${MOBILE_WIDTH}×${MOBILE_HEIGHT}`,
    isActive: () => viewportSize.value === 'mobile',
    onClick: () => setViewportSize('mobile')
  }
])

const currentDevice = computed(() => {
  return deviceSizes.value.find((d) => d.isActive()) || deviceSizes.value[0]
})

// === Event Handlers ===
const handleExportSVG = async () => {
  try {
    await artifactExport.exportSVG(artifactStore.currentArtifact)
  } catch (error) {
    console.error('Export SVG failed:', error)
  }
}

const handleExportCode = () => {
  artifactExport.exportCode(artifactStore.currentArtifact)
}

const handleCopyContent = async () => {
  try {
    await artifactExport.copyContent(artifactStore.currentArtifact)
    toast({
      title: t('artifacts.copySuccess'),
      description: t('artifacts.copySuccessDesc')
    })
  } catch (error) {
    toast({
      title: t('artifacts.copyFailed'),
      description: t('artifacts.copyFailedDesc'),
      variant: 'destructive'
    })
  }
}

const handleCopyAsImage = async () => {
  const success = await artifactExport.copyAsImage(artifactStore.currentArtifact, {
    isDark: themeStore.isDark,
    version: appVersion.value,
    texts: {
      brand: 'DeepChat',
      tip: t('common.watermarkTip')
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

// Action buttons configuration
interface ActionButton {
  key: string
  icon: string
  title: string
  onClick: () => void | Promise<void>
  visible: boolean
}

const actionButtons = computed<ActionButton[]>(() => {
  const artifact = artifactStore.currentArtifact
  if (!artifact) return []

  const actions: ActionButton[] = []

  // SVG/Mermaid export button
  if (artifact.type === 'image/svg+xml' || artifact.type === 'application/vnd.ant.mermaid') {
    actions.push({
      key: 'exportSVG',
      icon: 'lucide:download',
      title: t('artifacts.export'),
      onClick: handleExportSVG,
      visible: true
    })
  }

  // Copy content button (text)
  actions.push({
    key: 'copyContent',
    icon: 'lucide:copy',
    title: t('artifacts.copy'),
    onClick: handleCopyContent,
    visible: !!artifact.content
  })

  // Copy as image button
  actions.push({
    key: 'copyAsImage',
    icon: 'lucide:image',
    title: t('artifacts.copyAsImage'),
    onClick: handleCopyAsImage,
    visible: artifact.type !== 'text/html' && artifact.type !== 'application/vnd.ant.react'
  })

  // Export code button
  actions.push({
    key: 'exportCode',
    icon: 'lucide:download',
    title: t('artifacts.export'),
    onClick: handleExportCode,
    visible: true
  })

  return actions
})

const visibleActions = computed(() => actionButtons.value.filter((action) => action.visible))

// === Lifecycle Hooks ===
onMounted(async () => {
  appVersion.value = await devicePresenter.getAppVersion()
})
</script>
