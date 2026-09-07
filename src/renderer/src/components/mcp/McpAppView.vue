<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useResizeObserver } from '@vueuse/core'
import { Icon } from '@iconify/vue'
import { DcButton } from '@dc-ui/components/button'
import { Spinner } from '@shadcn/components/ui/spinner'
import {
  AppBridge,
  PostMessageTransport,
  buildAllowAttribute,
  type McpUiDisplayMode,
  type McpUiHostContext
} from '@modelcontextprotocol/ext-apps/app-bridge'
import type {
  CallToolResult,
  ContentBlock,
  ListPromptsResult,
  ListResourcesResult,
  ListResourceTemplatesResult,
  ListToolsResult,
  ReadResourceResult,
  Tool as SdkTool
} from '@modelcontextprotocol/sdk/types.js'
import { ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import type { MCPContentItem, McpAppDescriptor, PersistedMcpToolResult } from '@shared/types/mcp'
import { createMcpClient } from '@api/McpClient'
import { createDeviceClient } from '@api/DeviceClient'
import { useThemeStore } from '@/stores/theme'
import { useSessionStore } from '@/stores/ui/session'
import { useSidepanelStore } from '@/stores/ui/sidepanel'
import {
  claimMcpAppNonInlineDisplay,
  releaseMcpAppNonInlineDisplay,
  type McpAppDisplayMode
} from './mcpAppDisplayCoordinator'

const props = defineProps<{
  descriptor: McpAppDescriptor
  result: PersistedMcpToolResult
  conversationId: string
  messageId: string
  blockId: string
  toolInput: Record<string, unknown>
}>()

const { t, locale } = useI18n()
const mcpClient = createMcpClient()
const deviceClient = createDeviceClient()
const themeStore = useThemeStore()
const sessionStore = useSessionStore()
const sidepanelStore = useSidepanelStore()
const iframe = ref<HTMLIFrameElement | null>(null)
const prepared = shallowRef<Awaited<ReturnType<typeof mcpClient.prepareAppView>> | null>(null)
const bridge = shallowRef<AppBridge | null>(null)
const status = ref<'loading' | 'ready' | 'error' | 'released'>('loading')
const errorMessage = ref('')
const displayMode = ref<McpAppDisplayMode>('inline')
const supportedDisplayModes = ref<McpAppDisplayMode[]>(['inline'])
const inlineContentHeight = ref<number | null>(null)
const toolAccessSuspended = ref(false)
const detailsExpanded = ref(false)
const viewportRevision = ref(0)
const iframeKey = ref(0)
let hostVersion = 'unknown'
let prepareRevision = 0
let frameRevision = 0
let disposed = false

const sidepanelOwnerId = `${props.conversationId}:${props.messageId}:${props.blockId}`
const isSidepanelPreview = computed(
  () =>
    sidepanelStore.open &&
    sidepanelStore.activeTab === 'mcp-app' &&
    sidepanelStore.mcpAppPreviewOwnerId === sidepanelOwnerId
)
const teleportTarget = computed(() =>
  displayMode.value === 'inline' && isSidepanelPreview.value ? '#mcp-app-sidepanel-outlet' : 'body'
)
const teleportDisabled = computed(() => displayMode.value === 'inline' && !isSidepanelPreview.value)
const frameAllow = computed(() =>
  prepared.value ? buildAllowAttribute(prepared.value.permissions) : ''
)
const frameClass = computed(() => {
  if (displayMode.value === 'fullscreen') {
    return 'fixed inset-4 z-[90] flex flex-col overflow-hidden rounded-xl border bg-background shadow-2xl'
  }
  if (displayMode.value === 'pip') {
    return 'fixed bottom-5 right-5 z-[80] flex h-[min(640px,75vh)] w-[min(520px,85vw)] flex-col overflow-hidden rounded-xl border bg-background shadow-2xl'
  }
  if (isSidepanelPreview.value) {
    return 'flex h-full min-h-0 w-full flex-col overflow-hidden bg-background'
  }
  return [
    'relative mt-3 flex w-full flex-col overflow-hidden bg-background',
    prepared.value?.prefersBorder === false ? '' : 'rounded-lg border'
  ]
})
const frameViewportClass = computed(() =>
  displayMode.value === 'inline' && !isSidepanelPreview.value
    ? 'dc-overscroll-contain aspect-video w-full overflow-auto'
    : 'flex min-h-0 flex-1'
)
const frameStyle = computed(() =>
  displayMode.value === 'inline' && !isSidepanelPreview.value && inlineContentHeight.value !== null
    ? { height: `${inlineContentHeight.value}px` }
    : undefined
)
const declaredPermissions = computed(() => {
  const permissions = prepared.value?.permissions
  if (!permissions) {
    return []
  }
  return [
    permissions.camera ? t('mcp.apps.permissions.camera') : '',
    permissions.microphone ? t('mcp.apps.permissions.microphone') : '',
    permissions.geolocation ? t('mcp.apps.permissions.geolocation') : '',
    permissions.clipboardWrite ? t('mcp.apps.permissions.clipboardWrite') : ''
  ].filter(Boolean)
})
const declaredCspOrigins = computed(() => {
  const csp = prepared.value?.csp
  if (!csp) {
    return []
  }
  return Array.from(
    new Set([
      ...(csp.connectDomains ?? []),
      ...(csp.resourceDomains ?? []),
      ...(csp.frameDomains ?? []),
      ...(csp.baseUriDomains ?? [])
    ])
  )
})
const hostContext = computed<McpUiHostContext>(() => {
  void viewportRevision.value
  const fallbackWidth = displayMode.value === 'inline' ? 800 : window.innerWidth
  const fallbackHeight = displayMode.value === 'inline' ? 450 : window.innerHeight
  return {
    toolInfo: prepared.value ? { tool: prepared.value.tool as SdkTool } : undefined,
    theme: themeStore.isDark ? 'dark' : 'light',
    displayMode: displayMode.value,
    availableDisplayModes: ['inline', 'fullscreen', 'pip'],
    locale: locale.value,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    platform: 'desktop',
    userAgent: 'DeepChat',
    deviceCapabilities: {
      touch: navigator.maxTouchPoints > 0,
      hover: window.matchMedia('(hover: hover)').matches
    },
    safeAreaInsets: { top: 0, right: 0, bottom: 0, left: 0 },
    containerDimensions: {
      maxWidth: Math.max(1, iframe.value?.clientWidth || fallbackWidth),
      maxHeight: Math.max(1, iframe.value?.clientHeight || fallbackHeight)
    }
  }
})

useResizeObserver(iframe, () => {
  viewportRevision.value += 1
})

const setDisplayMode = (mode: McpAppDisplayMode): McpAppDisplayMode => {
  if (mode !== 'inline' && !supportedDisplayModes.value.includes(mode)) {
    return displayMode.value
  }
  if (mode === 'inline') {
    releaseMcpAppNonInlineDisplay(prepared.value?.instanceId ?? '')
    displayMode.value = 'inline'
  } else {
    const instanceId = prepared.value?.instanceId
    if (!instanceId) {
      return 'inline'
    }
    claimMcpAppNonInlineDisplay({
      instanceId,
      forceInline: () => {
        displayMode.value = 'inline'
        bridge.value?.setHostContext(hostContext.value)
      }
    })
    displayMode.value = mode
  }
  bridge.value?.setHostContext(hostContext.value)
  return displayMode.value
}

const extractMessageText = (content: ContentBlock[]): string =>
  content
    .filter(
      (block): block is Extract<ContentBlock, { type: 'text' }> =>
        block.type === 'text' && typeof block.text === 'string'
    )
    .map((block) => block.text)
    .join('\n\n')
    .trim()

const handleSizeChange = (height?: number) => {
  if (!Number.isFinite(height)) {
    return
  }
  inlineContentHeight.value = Math.max(120, Math.min(800, Number(height)))
}

const closeBridge = async (currentBridge: AppBridge) => {
  await Promise.race([
    currentBridge.teardownResource({}).catch(() => undefined),
    new Promise<void>((resolve) => window.setTimeout(resolve, 500))
  ])
  await currentBridge.close().catch(() => undefined)
}

const release = async () => {
  frameRevision += 1
  const currentBridge = bridge.value
  bridge.value = null
  if (currentBridge) {
    await closeBridge(currentBridge)
  }
  const instanceId = prepared.value?.instanceId
  if (instanceId) {
    releaseMcpAppNonInlineDisplay(instanceId)
    await mcpClient.releaseAppView(instanceId).catch(() => undefined)
  }
  prepared.value = null
}

const connectBridge = async () => {
  const frameWindow = iframe.value?.contentWindow
  const view = prepared.value
  if (!frameWindow || !view || bridge.value) {
    return
  }

  const nextBridge = new AppBridge(
    null,
    { name: 'DeepChat', version: hostVersion },
    {
      openLinks: {},
      serverTools: {},
      serverResources: {},
      updateModelContext: { text: {}, resource: {}, resourceLink: {}, structuredContent: {} },
      message: { text: {} },
      sandbox: {
        csp: view.csp,
        permissions: view.permissions
      }
    },
    { hostContext: hostContext.value }
  )
  bridge.value = nextBridge

  nextBridge.onsandboxready = () => {
    void nextBridge.sendSandboxResourceReady({
      html: view.html,
      sandbox: view.sandbox,
      csp: view.csp,
      permissions: view.permissions
    })
  }
  nextBridge.oninitialized = () => {
    void (async () => {
      const declaredModes = nextBridge.getAppCapabilities()?.availableDisplayModes ?? []
      supportedDisplayModes.value = [
        'inline',
        ...declaredModes.filter(
          (mode): mode is 'fullscreen' | 'pip' => mode === 'fullscreen' || mode === 'pip'
        )
      ]
      await nextBridge.sendToolInput({ arguments: props.toolInput })
      const resultMeta = {
        ...props.result.meta,
        ...(props.result.truncated
          ? { 'io.deepchat/persistence-truncated': props.result.truncated }
          : {})
      }
      await nextBridge.sendToolResult({
        content: (props.result.content ?? []) as CallToolResult['content'],
        ...(props.result.structuredContent !== undefined
          ? { structuredContent: props.result.structuredContent }
          : {}),
        ...(Object.keys(resultMeta).length > 0 ? { _meta: resultMeta } : {}),
        ...(props.result.isError ? { isError: true } : {})
      } as unknown as CallToolResult)
      status.value = 'ready'
    })().catch((error) => {
      status.value = 'error'
      errorMessage.value = error instanceof Error ? error.message : String(error)
    })
  }
  nextBridge.onsizechange = ({ height }) => handleSizeChange(height)
  nextBridge.onrequestdisplaymode = async ({ mode }) => ({
    mode: setDisplayMode(mode as McpAppDisplayMode) as McpUiDisplayMode
  })
  nextBridge.oncalltool = async ({ name, arguments: args }) => {
    const call = await mcpClient.callAppTool(view.instanceId, name, args ?? {})
    toolAccessSuspended.value = call.toolAccessSuspended
    return call.result as CallToolResult
  }
  nextBridge.setRequestHandler(
    ListToolsRequestSchema,
    async ({ params }) =>
      (await mcpClient.listAppTools(view.instanceId, params?.cursor)) as ListToolsResult
  )
  nextBridge.onreadresource = async ({ uri }) => {
    const result = await mcpClient.readAppResource(view.instanceId, uri)
    return {
      contents: result.contents.map((entry) => ({
        uri: entry.uri,
        ...(entry.mimeType ? { mimeType: entry.mimeType } : {}),
        ...(entry.text !== undefined ? { text: entry.text } : { blob: entry.blob ?? '' }),
        ...(entry._meta ? { _meta: entry._meta } : {})
      }))
    } as ReadResourceResult
  }
  nextBridge.onlistresources = async (params) =>
    (await mcpClient.listAppResources(view.instanceId, params?.cursor)) as ListResourcesResult
  nextBridge.onlistresourcetemplates = async (params) =>
    (await mcpClient.listAppResourceTemplates(
      view.instanceId,
      params?.cursor
    )) as ListResourceTemplatesResult
  nextBridge.onlistprompts = async (params) =>
    (await mcpClient.listAppPrompts(view.instanceId, params?.cursor)) as ListPromptsResult
  nextBridge.onopenlink = async ({ url }) =>
    (await mcpClient.openAppLink(view.instanceId, url)) ? {} : { isError: true }
  nextBridge.onmessage = async ({ content }) => {
    const text = extractMessageText(content)
    if (!text || !(await mcpClient.authorizeAppMessage(view.instanceId, text))) {
      return { isError: true }
    }
    await sessionStore.sendMessage(props.conversationId, text)
    return {}
  }
  nextBridge.onupdatemodelcontext = async ({ content, structuredContent }) => {
    const result = await mcpClient.updateAppModelContext(view.instanceId, {
      content: content as MCPContentItem[],
      structuredContent
    })
    if (!result.approved) {
      throw new Error('The user denied the MCP App model-context update')
    }
    return {}
  }
  nextBridge.onrequestteardown = () => {
    status.value = 'released'
    void release()
  }
  await nextBridge.connect(new PostMessageTransport(frameWindow, frameWindow))
}

const prepare = async () => {
  const revision = ++prepareRevision
  status.value = 'loading'
  errorMessage.value = ''
  toolAccessSuspended.value = false
  await release()
  try {
    const [view, version] = await Promise.all([
      mcpClient.prepareAppView({
        descriptor: props.descriptor,
        conversationId: props.conversationId,
        messageId: props.messageId,
        blockId: props.blockId,
        toolInput: props.toolInput
      }),
      deviceClient.getAppVersion().catch(() => 'unknown')
    ])
    if (disposed || revision !== prepareRevision) {
      await mcpClient.releaseAppView(view.instanceId).catch(() => undefined)
      return
    }
    hostVersion = version
    prepared.value = view
    await nextTick()
    await connectBridge()
  } catch (error) {
    if (disposed || revision !== prepareRevision) {
      return
    }
    status.value = 'error'
    errorMessage.value = error instanceof Error ? error.message : String(error)
  }
}

const retryToolAccess = async () => {
  if (!prepared.value) {
    return
  }
  await mcpClient.retryAppToolAccess(prepared.value.instanceId)
  toolAccessSuspended.value = false
}

const handleKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Escape' && displayMode.value !== 'inline') {
    event.preventDefault()
    setDisplayMode('inline')
  }
}

const openSidepanelPreview = () => {
  setDisplayMode('inline')
  sidepanelStore.openMcpAppPreview(sidepanelOwnerId)
}

const returnInline = () => {
  if (displayMode.value !== 'inline') {
    setDisplayMode('inline')
    return
  }
  sidepanelStore.closeMcpAppPreview(sidepanelOwnerId)
}

const reloadRelocatedFrame = () => {
  const revision = ++frameRevision
  const currentBridge = bridge.value
  bridge.value = null
  if (currentBridge) {
    void closeBridge(currentBridge)
  }
  iframeKey.value += 1
  void nextTick(() => {
    if (!disposed && revision === frameRevision) {
      void connectBridge()
    }
  })
}

watch(isSidepanelPreview, reloadRelocatedFrame, { flush: 'sync' })

watch(
  () => [
    themeStore.isDark,
    locale.value,
    displayMode.value,
    isSidepanelPreview.value,
    viewportRevision.value
  ],
  () => bridge.value?.setHostContext(hostContext.value)
)

onMounted(() => {
  disposed = false
  window.addEventListener('keydown', handleKeydown)
  void prepare()
})

onBeforeUnmount(() => {
  disposed = true
  prepareRevision += 1
  sidepanelStore.closeMcpAppPreview(sidepanelOwnerId)
  window.removeEventListener('keydown', handleKeydown)
  void release()
})
</script>

<template>
  <div v-if="status === 'loading' && !prepared" class="mt-3 flex h-32 items-center justify-center">
    <Spinner class="size-5" />
  </div>
  <div
    v-else-if="status === 'error'"
    class="mt-3 rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground"
  >
    <p>{{ t('mcp.apps.loadError') }}</p>
    <p class="mt-1 break-words text-xs">{{ errorMessage }}</p>
    <DcButton variant="outline" size="sm" class="mt-3" @click="prepare">
      {{ t('mcp.apps.retry') }}
    </DcButton>
  </div>

  <Teleport v-else-if="prepared" :to="teleportTarget" :disabled="teleportDisabled">
    <section data-testid="mcp-app-surface" :class="frameClass" :aria-label="t('mcp.apps.title')">
      <header class="flex h-10 shrink-0 items-center justify-between border-b px-3">
        <div class="min-w-0">
          <span class="block truncate text-sm font-medium">{{ descriptor.serverName }}</span>
          <span class="block truncate text-[11px] text-muted-foreground">
            {{ t('mcp.apps.interactiveContent') }}
          </span>
        </div>
        <div class="flex items-center gap-1">
          <DcButton
            variant="ghost"
            size="icon"
            :aria-label="t('mcp.apps.securityDetails')"
            :aria-expanded="detailsExpanded"
            @click="detailsExpanded = !detailsExpanded"
            :tooltip="t('mcp.apps.securityDetails')"
          >
            <Icon icon="lucide:shield-check" class="size-4" />
          </DcButton>
          <DcButton
            v-if="displayMode === 'inline' && !isSidepanelPreview"
            data-testid="mcp-app-open-sidepanel"
            variant="ghost"
            size="icon"
            :aria-label="`${t('mcp.apps.title')} · ${t('common.preview')}`"
            @click="openSidepanelPreview"
            :tooltip="`${t('mcp.apps.title')} · ${t('common.preview')}`"
          >
            <Icon icon="lucide:panel-right-open" class="size-4" />
          </DcButton>
          <DcButton
            v-if="displayMode === 'inline' && supportedDisplayModes.includes('fullscreen')"
            variant="ghost"
            size="icon"
            :aria-label="t('mcp.apps.fullscreen')"
            @click="setDisplayMode('fullscreen')"
            :tooltip="t('mcp.apps.fullscreen')"
          >
            <Icon icon="lucide:maximize-2" class="size-4" />
          </DcButton>
          <DcButton
            v-if="
              displayMode === 'inline' &&
              !supportedDisplayModes.includes('fullscreen') &&
              supportedDisplayModes.includes('pip')
            "
            variant="ghost"
            size="icon"
            :aria-label="t('mcp.apps.pictureInPicture')"
            @click="setDisplayMode('pip')"
            :tooltip="t('mcp.apps.pictureInPicture')"
          >
            <Icon icon="lucide:picture-in-picture-2" class="size-4" />
          </DcButton>
          <DcButton
            v-if="displayMode === 'fullscreen' && supportedDisplayModes.includes('pip')"
            variant="ghost"
            size="icon"
            :aria-label="t('mcp.apps.pictureInPicture')"
            @click="setDisplayMode('pip')"
            :tooltip="t('mcp.apps.pictureInPicture')"
          >
            <Icon icon="lucide:picture-in-picture-2" class="size-4" />
          </DcButton>
          <DcButton
            v-if="displayMode !== 'inline' || isSidepanelPreview"
            data-testid="mcp-app-return-inline"
            variant="ghost"
            size="icon"
            :aria-label="t('mcp.apps.returnInline')"
            @click="returnInline"
            :tooltip="t('mcp.apps.returnInline')"
          >
            <Icon
              :icon="isSidepanelPreview ? 'lucide:panel-right-close' : 'lucide:minimize-2'"
              class="size-4"
            />
          </DcButton>
        </div>
      </header>
      <div v-if="detailsExpanded" class="shrink-0 space-y-2 border-b bg-muted/30 px-3 py-2 text-xs">
        <div>
          <span class="font-medium">{{ t('mcp.apps.allowedOrigins') }}</span>
          <p class="mt-0.5 break-all text-muted-foreground">
            {{ declaredCspOrigins.join(', ') || t('mcp.apps.noneDeclared') }}
          </p>
        </div>
        <div>
          <span class="font-medium">{{ t('mcp.apps.requestedPermissions') }}</span>
          <p class="mt-0.5 text-muted-foreground">
            {{ declaredPermissions.join(', ') || t('mcp.apps.noneDeclared') }}
          </p>
        </div>
        <div v-if="prepared.advisoryDomain">
          <span class="font-medium">{{ t('mcp.apps.advisoryDomain') }}</span>
          <p class="mt-0.5 break-all text-muted-foreground">{{ prepared.advisoryDomain }}</p>
        </div>
      </div>
      <div data-testid="mcp-app-frame-viewport" :class="frameViewportClass">
        <iframe
          :key="iframeKey"
          ref="iframe"
          :src="prepared.sandboxUrl"
          :sandbox="prepared.sandbox"
          :allow="frameAllow"
          class="block h-full w-full bg-transparent"
          :class="
            displayMode === 'inline' && !isSidepanelPreview
              ? 'min-h-full shrink-0'
              : 'min-h-0 flex-1'
          "
          :style="frameStyle"
          :title="t('mcp.apps.title')"
          @load="connectBridge"
        />
      </div>
      <div
        v-if="toolAccessSuspended"
        class="flex items-center justify-between gap-3 border-t bg-muted/40 px-3 py-2 text-xs"
      >
        <span>{{ t('mcp.apps.toolAccessSuspended') }}</span>
        <DcButton size="sm" variant="outline" @click="retryToolAccess">
          {{ t('mcp.apps.retryAccess') }}
        </DcButton>
      </div>
    </section>
  </Teleport>
</template>
