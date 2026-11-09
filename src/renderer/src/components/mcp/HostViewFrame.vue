<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { useResizeObserver } from '@vueuse/core'
import {
  AppBridge,
  PostMessageTransport,
  type McpUiHostContext
} from '@modelcontextprotocol/ext-apps/app-bridge'
import { HOST_VIEW_MAX_HEIGHT } from '@shared/hostViews'
import type { McpHostPreparedView } from '@shared/types/mcp'
import { createMcpClient } from '@api/McpClient'
import { useThemeStore } from '@/stores/theme'

const props = withDefaults(
  defineProps<{
    prepare: () => Promise<McpHostPreparedView>
    title: string
    placeholderHeight: number
    displayMode?: 'inline' | 'fullscreen'
    decorateHtml?: (html: string) => string
  }>(),
  { displayMode: 'inline', decorateHtml: undefined }
)

// The page initializes before its own scripts run, so one that has not done so was wiped (for
// example by document.open()) or is stuck, and would otherwise stay an invisible gap.
const INITIALIZE_TIMEOUT_MS = 10_000
const OSCILLATION_WINDOW_MS = 2000
const MAX_CONSECUTIVE_RISES = 5
const MAX_DIRECTION_CHANGES = 4

const emit = defineEmits<{
  ready: []
  error: []
  notification: [method: string, params: Record<string, unknown>]
}>()

const { locale } = useI18n()
const mcpClient = createMcpClient()
const themeStore = useThemeStore()
const iframe = ref<HTMLIFrameElement | null>(null)
const prepared = shallowRef<McpHostPreparedView | null>(null)
const bridge = shallowRef<AppBridge | null>(null)
const height = ref<number | null>(null)
const frameKey = ref(0)
let disposed = false
let preparing = false
let loadSeq = 0
let initialized = false
let initializeTimer: number | undefined
let sizeHistory: Array<{ at: number; height: number }> = []
let heightLocked = false
let lastWidth = 0

const buildHostContext = (): McpUiHostContext => ({
  theme: themeStore.isDark ? 'dark' : 'light',
  displayMode: props.displayMode,
  locale: locale.value,
  platform: 'desktop'
})

const isOscillating = (entries: Array<{ height: number }>): boolean => {
  let rises = 0
  let changes = 0
  let lastSign = 0
  for (let index = 1; index < entries.length; index += 1) {
    const sign = Math.sign(entries[index].height - entries[index - 1].height)
    rises = sign > 0 ? rises + 1 : 0
    if (sign !== 0 && lastSign !== 0 && sign !== lastSign) changes += 1
    if (sign !== 0) lastSign = sign
    if (rises >= MAX_CONSECUTIVE_RISES || changes >= MAX_DIRECTION_CHANGES) return true
  }
  return false
}

// The sandboxed page controls the reported height, so cap it to keep a hostile view from pushing the
// rest of the chat out of reach, and stop following a page whose height feeds back on its frame.
// Taller content scrolls inside the frame.
const handleSizeChange = (next: unknown) => {
  if (!Number.isFinite(next) || heightLocked) return
  const now = performance.now()
  sizeHistory = [
    ...sizeHistory.filter((entry) => now - entry.at <= OSCILLATION_WINDOW_MS),
    { at: now, height: Number(next) }
  ]
  if (isOscillating(sizeHistory)) {
    heightLocked = true
    return
  }
  height.value = Math.min(HOST_VIEW_MAX_HEIGHT, Math.ceil(Number(next)))
}

useResizeObserver(iframe, (entries) => {
  const width = Math.round(entries[0]?.contentRect.width ?? 0)
  if (width === lastWidth) return
  lastWidth = width
  heightLocked = false
  sizeHistory = []
})

const closeBridge = async (current: AppBridge) => {
  await Promise.race([
    current.teardownResource({}).catch(() => undefined),
    new Promise<void>((resolve) => window.setTimeout(resolve, 500))
  ])
  await current.close().catch(() => undefined)
}

const release = async () => {
  window.clearTimeout(initializeTimer)
  const currentBridge = bridge.value
  bridge.value = null
  if (currentBridge) await closeBridge(currentBridge)
  const instanceId = prepared.value?.instanceId
  prepared.value = null
  if (instanceId) {
    await mcpClient.releaseAppView(instanceId).catch(() => undefined)
  }
}

const connectBridge = async () => {
  const frameWindow = iframe.value?.contentWindow
  const view = prepared.value
  if (!frameWindow || !view || bridge.value || preparing) {
    return
  }
  const nextBridge = new AppBridge(
    null,
    { name: 'DeepChat', version: 'host-view' },
    { sandbox: { csp: view.csp } },
    { hostContext: buildHostContext() }
  )
  bridge.value = nextBridge
  nextBridge.onsandboxready = () => {
    void nextBridge.sendSandboxResourceReady({
      html: props.decorateHtml ? props.decorateHtml(view.html) : view.html,
      sandbox: view.sandbox,
      csp: view.csp
    })
  }
  nextBridge.oninitialized = () => {
    window.clearTimeout(initializeTimer)
    initialized = true
    emit('ready')
  }
  nextBridge.onsizechange = ({ height: next }) => handleSizeChange(next)
  nextBridge.fallbackNotificationHandler = async ({ method, params }) => {
    emit('notification', method, (params ?? {}) as Record<string, unknown>)
  }
  await nextBridge.connect(new PostMessageTransport(frameWindow, frameWindow))
}

const notify = async (method: string, params: Record<string, unknown>) => {
  if (!bridge.value) throw new Error('Host view is not connected')
  await bridge.value.notification({ method, params })
}

const load = async () => {
  window.clearTimeout(initializeTimer)
  initialized = false
  preparing = true
  const seq = ++loadSeq
  try {
    const view = await props.prepare()
    if (disposed || seq !== loadSeq) {
      await mcpClient.releaseAppView(view.instanceId).catch(() => undefined)
      return
    }
    const previous = prepared.value
    prepared.value = view
    frameKey.value += 1
    initializeTimer = window.setTimeout(() => {
      if (disposed || initialized) return
      void release()
      emit('error')
    }, INITIALIZE_TIMEOUT_MS)
    await nextTick()
    preparing = false
    if (previous) void mcpClient.releaseAppView(previous.instanceId).catch(() => undefined)
    await connectBridge()
  } catch (error) {
    if (disposed || seq !== loadSeq) return
    preparing = false
    console.warn('[HostViewFrame] Failed to prepare view', {
      title: props.title,
      error: error instanceof Error ? error.message : String(error)
    })
    emit('error')
  }
}

// A moved iframe reloads, and a page that bakes colors in needs a reload on theme change. Sandbox
// instances expire after 30 minutes, so each reload prepares a fresh one; until it is ready, the old
// frame must not reconnect when the move reloads it.
const reload = () => {
  if (disposed || !prepared.value) return
  const currentBridge = bridge.value
  bridge.value = null
  if (currentBridge) void closeBridge(currentBridge)
  void load()
}

onMounted(load)

onBeforeUnmount(() => {
  disposed = true
  void release()
})

defineExpose({ notify, reload })
</script>

<template>
  <div v-if="!prepared" :style="{ height: `${placeholderHeight}px` }" />
  <iframe
    v-else
    :key="frameKey"
    ref="iframe"
    :src="prepared.sandboxUrl"
    :sandbox="prepared.sandbox"
    :title="title"
    class="block w-full border-0 bg-transparent"
    :class="[
      displayMode === 'fullscreen' ? 'min-h-0 flex-1' : '',
      height === null ? 'opacity-0' : 'opacity-100'
    ]"
    :style="
      displayMode === 'fullscreen' ? undefined : { height: `${height ?? placeholderHeight}px` }
    "
    @load="connectBridge"
  />
</template>
