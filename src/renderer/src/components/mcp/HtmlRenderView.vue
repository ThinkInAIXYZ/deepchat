<script setup lang="ts">
import { computed, inject, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useIntersectionObserver } from '@vueuse/core'
import { Icon } from '@iconify/vue'
import { DcButton } from '@dc-ui/components/button'
import {
  HTML_RENDER_DEFAULT_HEIGHT,
  HTML_RENDER_HOST_STYLE_SLOT,
  HTML_RENDER_SECTIONS_METHOD
} from '@shared/agentHtmlRenderTool'
import { createMcpClient } from '@api/McpClient'
import { useThemeStore } from '@/stores/theme'
import HostViewFrame from './HostViewFrame.vue'
import {
  claimMcpAppNonInlineDisplay,
  releaseMcpAppNonInlineDisplay
} from './mcpAppDisplayCoordinator'
import { HTML_RENDER_SECTIONS_KEY } from './htmlRenderSections'

const props = defineProps<{
  conversationId: string
  messageId: string
  blockId: string
  title: string
  height?: number
  panelId?: string
}>()

const THEME_COLOR_TOKENS = [
  '--background',
  '--foreground',
  '--muted',
  '--muted-foreground',
  '--card',
  '--card-foreground',
  '--border',
  '--primary',
  '--primary-foreground',
  '--accent',
  '--destructive'
]
const CHART_COLORS = {
  light: ['#0d9488', '#d97706', '#7c3aed', '#e11d48', '#65a30d'],
  dark: ['#2dd4bf', '#fbbf24', '#c084fc', '#fb7185', '#a3e635']
}

const { t } = useI18n()
const mcpClient = createMcpClient()
const themeStore = useThemeStore()
const container = ref<HTMLElement | null>(null)
const frame = ref<InstanceType<typeof HostViewFrame> | null>(null)
const visible = ref(false)
const ready = ref(false)
const failed = ref(false)
const fullscreen = ref(false)
const attempt = ref(0)
const panelSections = inject(HTML_RENDER_SECTIONS_KEY, null)
const sections = computed(() =>
  props.panelId ? (panelSections?.value.get(props.panelId) ?? []) : []
)
const displayKey = `html-render:${props.blockId}`
const placeholderHeight = props.height ?? HTML_RENDER_DEFAULT_HEIGHT

const colorContext = document.createElement('canvas').getContext('2d')

// App tokens use CSS Color 4 syntax such as `hsl(210 100% 43%)`, which chart libraries (d3.color,
// Chart.js helpers) fail to parse; the canvas serializes any color to #rrggbb or rgba().
const toLegacyColor = (value: string): string => {
  if (!colorContext) return value
  colorContext.fillStyle = '#000000'
  colorContext.fillStyle = value
  return colorContext.fillStyle
}

const buildHostStyle = (): string => {
  const style = getComputedStyle(document.documentElement)
  const read = (name: string) => style.getPropertyValue(name).trim()
  const variables: Record<string, string> = {}
  for (const name of THEME_COLOR_TOKENS) {
    const value = read(name)
    if (value) variables[name] = toLegacyColor(value)
  }
  const chart = CHART_COLORS[themeStore.isDark ? 'dark' : 'light']
  variables['--chart-1'] = variables['--primary'] ?? chart[0]
  chart.forEach((color, index) => {
    variables[`--chart-${index + 2}`] = color
  })
  variables['--radius'] = read('--radius') || '0.5rem'
  variables['--font-sans'] = read('--dc-font-family') || 'system-ui, sans-serif'
  variables['--font-mono'] = read('--dc-code-font-family') || 'monospace'
  const declarations = Object.entries(variables)
    .filter(([, value]) => !/[<>{};]/.test(value))
    .map(([name, value]) => `${name}:${value}`)
  declarations.push(`color-scheme:${themeStore.isDark ? 'dark' : 'light'}`)
  // `html:root` outranks the `:root` fallbacks pages often declare, so the app theme wins.
  return `<style data-dc-host-vars>html:root{${declarations.join(';')}}</style>`
}

const decorateHtml = (html: string) => html.replace(HTML_RENDER_HOST_STYLE_SLOT, buildHostStyle)

const prepareView = () =>
  mcpClient.prepareHtmlRenderView({
    conversationId: props.conversationId,
    messageId: props.messageId,
    blockId: props.blockId
  })

const sendSections = () => {
  if (!ready.value || sections.value.length === 0) return
  void frame.value
    ?.notify(HTML_RENDER_SECTIONS_METHOD, {
      sections: sections.value.map(({ id, html }) => ({ id, html }))
    })
    .catch(() => undefined)
}

const handleReady = () => {
  ready.value = true
  sendSections()
}

const setFullscreen = (next: boolean) => {
  if (fullscreen.value === next) return
  if (next) {
    claimMcpAppNonInlineDisplay({ instanceId: displayKey, forceInline: () => setFullscreen(false) })
  } else {
    releaseMcpAppNonInlineDisplay(displayKey)
  }
  fullscreen.value = next
  frame.value?.reload()
}

const handleError = () => {
  setFullscreen(false)
  ready.value = false
  failed.value = true
}

const retry = () => {
  failed.value = false
  attempt.value += 1
}

const handleKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Escape' && fullscreen.value) {
    event.preventDefault()
    setFullscreen(false)
  }
}

// Each frame is its own renderer process, so offscreen pages wait until they near the viewport.
const { stop: stopVisibilityWatch } = useIntersectionObserver(
  container,
  ([entry]) => {
    if (!entry?.isIntersecting) return
    visible.value = true
    stopVisibilityWatch()
  },
  { rootMargin: '160px' }
)

watch(sections, sendSections)

// Canvas and SVG charts bake colors in when drawn, so a theme change re-renders the page.
watch(
  () => themeStore.isDark,
  async () => {
    await nextTick()
    frame.value?.reload()
  }
)

onMounted(() => {
  window.addEventListener('keydown', handleKeydown)
})

onBeforeUnmount(() => {
  stopVisibilityWatch()
  window.removeEventListener('keydown', handleKeydown)
  releaseMcpAppNonInlineDisplay(displayKey)
})
</script>

<template>
  <div
    v-if="failed"
    class="mt-2 flex items-center gap-3 text-sm text-muted-foreground"
    data-testid="html-render-error"
  >
    <span>{{ t('mcp.apps.pageLoadError') }}</span>
    <DcButton variant="outline" size="sm" @click="retry">
      {{ t('mcp.apps.retry') }}
    </DcButton>
  </div>
  <div v-else ref="container" class="mt-1 -mx-2 w-[calc(100%+1rem)]">
    <div v-if="!visible" :style="{ height: `${placeholderHeight}px` }" />
    <Teleport v-else to="body" :disabled="!fullscreen">
      <div
        v-if="fullscreen"
        class="fixed inset-0 z-[89] bg-black/30"
        @click="setFullscreen(false)"
      />
      <section
        data-testid="html-render-surface"
        :class="
          fullscreen
            ? 'fixed inset-6 z-[90] flex flex-col overflow-hidden rounded-xl border bg-background shadow-2xl'
            : 'group relative'
        "
        :aria-label="title"
      >
        <header
          v-if="fullscreen"
          class="flex h-11 shrink-0 items-center justify-between gap-3 border-b pl-4 pr-2"
        >
          <span class="min-w-0 truncate text-sm font-medium">{{ title }}</span>
          <DcButton
            variant="ghost"
            size="icon"
            :aria-label="t('mcp.apps.returnInline')"
            :tooltip="t('mcp.apps.returnInline')"
            @click="setFullscreen(false)"
          >
            <Icon icon="lucide:minimize-2" class="size-4" />
          </DcButton>
        </header>
        <div
          v-else-if="ready"
          class="absolute right-2 top-2 z-10 rounded-lg border bg-card p-0.5 opacity-0 shadow-sm transition-opacity duration-[var(--dc-motion-fast)] group-hover:opacity-100 focus-within:opacity-100 motion-reduce:transition-none"
        >
          <DcButton
            variant="ghost"
            size="icon"
            class="size-7"
            :aria-label="t('mcp.apps.fullscreen')"
            :tooltip="t('mcp.apps.fullscreen')"
            @click="setFullscreen(true)"
          >
            <Icon icon="lucide:maximize-2" class="size-4" />
          </DcButton>
        </div>
        <div :class="fullscreen ? 'flex min-h-0 flex-1 flex-col px-4 py-2' : ''">
          <HostViewFrame
            :key="attempt"
            ref="frame"
            :prepare="prepareView"
            :title="title"
            :placeholder-height="placeholderHeight"
            :display-mode="fullscreen ? 'fullscreen' : 'inline'"
            :decorate-html="decorateHtml"
            @ready="handleReady"
            @error="handleError"
          />
        </div>
      </section>
    </Teleport>
  </div>
</template>
