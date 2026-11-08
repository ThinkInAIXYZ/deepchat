<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  AppBridge,
  PostMessageTransport,
  type McpUiHostContext
} from '@modelcontextprotocol/ext-apps/app-bridge'
import type { HostViewKind } from '@shared/hostViews'
import type { McpHostPreparedView } from '@shared/types/mcp'
import { createMcpClient } from '@api/McpClient'
import { useThemeStore } from '@/stores/theme'

const props = defineProps<{
  kind: HostViewKind
  title: string
  placeholderHeight: number
}>()

// The sandboxed page controls the reported height, so cap it to keep a hostile view from pushing the
// rest of the chat out of reach. Taller content scrolls inside the frame.
const MAX_HEIGHT = 1600

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
let disposed = false

const buildHostContext = (): McpUiHostContext => ({
  theme: themeStore.isDark ? 'dark' : 'light',
  displayMode: 'inline',
  locale: locale.value,
  platform: 'desktop'
})

const release = async () => {
  const currentBridge = bridge.value
  bridge.value = null
  if (currentBridge) {
    await Promise.race([
      currentBridge.teardownResource({}).catch(() => undefined),
      new Promise<void>((resolve) => window.setTimeout(resolve, 500))
    ])
    await currentBridge.close().catch(() => undefined)
  }
  const instanceId = prepared.value?.instanceId
  prepared.value = null
  if (instanceId) {
    await mcpClient.releaseAppView(instanceId).catch(() => undefined)
  }
}

const connectBridge = async () => {
  const frameWindow = iframe.value?.contentWindow
  const view = prepared.value
  if (!frameWindow || !view || bridge.value) {
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
      html: view.html,
      sandbox: view.sandbox,
      csp: view.csp
    })
  }
  nextBridge.oninitialized = () => emit('ready')
  nextBridge.onsizechange = ({ height: next }) => {
    if (Number.isFinite(next)) height.value = Math.min(MAX_HEIGHT, Math.ceil(Number(next)))
  }
  nextBridge.fallbackNotificationHandler = async ({ method, params }) => {
    emit('notification', method, (params ?? {}) as Record<string, unknown>)
  }
  await nextBridge.connect(new PostMessageTransport(frameWindow, frameWindow))
}

const notify = async (method: string, params: Record<string, unknown>) => {
  if (!bridge.value) throw new Error('Host view is not connected')
  await bridge.value.notification({ method, params })
}

onMounted(async () => {
  try {
    const view = await mcpClient.prepareHostView(props.kind)
    if (disposed) {
      await mcpClient.releaseAppView(view.instanceId).catch(() => undefined)
      return
    }
    prepared.value = view
    await nextTick()
    await connectBridge()
  } catch (error) {
    if (disposed) return
    console.warn('[HostViewFrame] Failed to prepare view', {
      kind: props.kind,
      error: error instanceof Error ? error.message : String(error)
    })
    emit('error')
  }
})

onBeforeUnmount(() => {
  disposed = true
  void release()
})

defineExpose({ notify })
</script>

<template>
  <div v-if="!prepared" :style="{ height: `${placeholderHeight}px` }" />
  <iframe
    v-else
    ref="iframe"
    :src="prepared.sandboxUrl"
    :sandbox="prepared.sandbox"
    :title="title"
    class="block w-full border-0 bg-transparent"
    :class="height === null ? 'opacity-0' : 'opacity-100'"
    :style="{ height: `${height ?? placeholderHeight}px` }"
    @load="connectBridge"
  />
</template>
