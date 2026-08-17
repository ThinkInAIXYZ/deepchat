<template>
  <div
    class="markdown-renderer-root prose prose-zinc prose-sm dark:prose-invert w-full max-w-none break-words"
    @keydown="handleRendererKeydown"
  >
    <NodeRenderer
      :content="renderContent"
      :custom-id="customRendererId"
      :isDark="themeStore.isDark"
      :mode="props.mode"
      :final="resolvedFinal"
      :smooth-streaming="resolvedSmoothStreaming"
      :typewriter="resolvedTypewriter"
      :code-block-stream="isStreaming"
      :themes="codeBlockThemes"
      :code-block-options="codeBlockOptions"
      :mermaid-props="mermaidProps"
      :fade="false"
      :batch-rendering="true"
      :initial-render-batch-size="initialRenderBatchSize"
      :render-batch-size="renderBatchSize"
      :render-batch-delay="renderBatchDelay"
      :render-batch-budget-ms="renderBatchBudgetMs"
      :render-batch-idle-timeout-ms="renderBatchIdleTimeoutMs"
      :parse-coalesce-ms="parseCoalesceMs"
      :parse-options="parseOptions"
      html-policy="safe"
      :defer-nodes-until-visible="shouldUseViewportPriority"
      :viewport-priority="shouldUseViewportPriority"
      :node-virtual="resolvedNodeVirtual"
      :max-live-nodes="maxLiveNodes"
      :live-node-buffer="liveNodeBuffer"
      @copy="$emit('copy', $event)"
      @handle-artifact-click="handleArtifactClick"
      @click="handleRendererClick"
      @mouseover="handleRendererMouseover"
      @mouseout="handleRendererMouseout"
    />
  </div>
</template>

<script setup lang="ts">
import { createSessionClient } from '@api/SessionClient'
import { useArtifactStore } from '@/stores/artifact'
import { useReferenceStore } from '@/stores/reference'
import { nanoid } from 'nanoid'
import { useDebounceFn } from '@vueuse/core'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import NodeRenderer, {
  type CodeBlockPreviewPayload,
  type ParsedNode,
  type ParseOptions
} from 'markstream-vue'
import { useThemeStore } from '@/stores/theme'
import { useUiSettingsStore } from '@/stores/uiSettingsStore'
import { useMarkdownLinkNavigation } from './useMarkdownLinkNavigation'
import type { MarkdownLinkContext } from './linkTypes'
import { ensureMarkdownWorkers } from '@/lib/markdownWorkerLifecycle'
import { normalizeMarkstreamCodeFenceLanguages } from '@/lib/markstreamLanguage'

const props = withDefaults(
  defineProps<{
    content: string
    debug?: boolean
    messageId?: string
    threadId?: string
    linkContext?: MarkdownLinkContext
    smoothStreaming?: boolean
    streaming?: boolean
    final?: boolean
    virtualizeNodes?: boolean
    mode?: 'docs' | 'chat' | 'minimal'
    hiddenImageSources?: readonly string[]
  }>(),
  {
    smoothStreaming: true,
    streaming: false,
    final: undefined,
    virtualizeNodes: true,
    mode: 'docs'
  }
)
const themeStore = useThemeStore()
const uiSettingsStore = useUiSettingsStore()
const artifactStore = useArtifactStore()
const fallbackMessageId = `artifact-msg-${nanoid()}`
const fallbackThreadId = `artifact-thread-${nanoid()}`
const referenceStore = useReferenceStore()
const sessionClient = createSessionClient()
const renderContent = ref(normalizeMarkstreamCodeFenceLanguages(props.content))
let searchResultsPromise: ReturnType<typeof sessionClient.getSearchResults> | null = null
let activeReferenceElement: HTMLElement | null = null
let rendererContextRevision = 0
const effectiveMessageId = computed(() => props.messageId ?? fallbackMessageId)
const effectiveThreadId = computed(() => props.threadId ?? fallbackThreadId)
const effectiveLinkContext = computed<MarkdownLinkContext>(() => {
  const provided = props.linkContext
  if (provided) {
    return provided
  }

  return {
    source: 'chat',
    sessionId: props.threadId
  }
})
const customRendererId = computed(() =>
  [
    'markdown',
    effectiveThreadId.value,
    effectiveMessageId.value,
    effectiveLinkContext.value.source,
    effectiveLinkContext.value.sessionId ?? '',
    effectiveLinkContext.value.sourceFilePath ?? '',
    fallbackMessageId
  ].join('::')
)
const codeBlockThemes = ['vitesse-dark', 'vitesse-light'] as const
const codeBlockOptions = computed(() => ({
  fontFamily: uiSettingsStore.formattedCodeFontFamily,
  overflow: 'wrap' as const
}))
const mermaidProps = { isStrict: true } as const
const NESTED_NODE_ARRAY_KEYS = ['children', 'items', 'rows', 'cells', 'term', 'definition'] as const

const isParsedNode = (value: unknown): value is ParsedNode =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as { type?: unknown }).type === 'string' &&
  typeof (value as { raw?: unknown }).raw === 'string'

const removeHiddenImageNode = (
  node: ParsedNode,
  hiddenSources: ReadonlySet<string>
): ParsedNode | null => {
  if (
    node.type === 'image' &&
    'src' in node &&
    typeof node.src === 'string' &&
    hiddenSources.has(node.src.trim())
  ) {
    return null
  }

  const source = node as unknown as Record<string, unknown>
  let result: Record<string, unknown> | undefined
  for (const key of NESTED_NODE_ARRAY_KEYS) {
    const value = source[key]
    if (!Array.isArray(value) || value.length === 0 || !value.every(isParsedNode)) {
      continue
    }
    const transformed = value
      .map((child) => removeHiddenImageNode(child, hiddenSources))
      .filter((child): child is ParsedNode => child !== null)
    if (
      transformed.length !== value.length ||
      transformed.some((child, index) => child !== value[index])
    ) {
      result ??= { ...source }
      result[key] = transformed
    }
  }

  if (isParsedNode(source.header)) {
    const transformedHeader = removeHiddenImageNode(source.header, hiddenSources)
    if (transformedHeader !== source.header) {
      result ??= { ...source }
      result.header = transformedHeader
    }
  }

  const transformedNode = (result ?? source) as unknown as ParsedNode
  if (
    transformedNode.type === 'paragraph' &&
    Array.isArray(transformedNode.children) &&
    transformedNode.children.length === 0
  ) {
    return null
  }
  return transformedNode
}

const parseOptions = computed<ParseOptions | undefined>(() => {
  const hiddenSources = new Set(props.hiddenImageSources ?? [])
  if (hiddenSources.size === 0) {
    return undefined
  }
  return {
    postTransformNodes: (nodes) =>
      nodes
        .map((node) => removeHiddenImageNode(node, hiddenSources))
        .filter((node): node is ParsedNode => node !== null)
  }
})
const isStreaming = computed(
  () => props.final === false || (props.streaming && props.final !== true)
)
const resolvedFinal = computed(() => props.final ?? !isStreaming.value)
const resolvedSmoothStreaming = computed(() => {
  if (!props.smoothStreaming || resolvedFinal.value) {
    return false
  }

  return 'auto' as const
})
const resolvedTypewriter = computed(() => (isStreaming.value ? ('simple' as const) : false))
const STREAM_INITIAL_RENDER_BATCH_SIZE = 10
const STREAM_RENDER_BATCH_SIZE = 14
const STREAM_RENDER_BATCH_DELAY_MS = 8
const STREAM_RENDER_BATCH_BUDGET_MS = 3
const STREAM_RENDER_BATCH_IDLE_TIMEOUT_MS = 24
const STREAM_PARSE_COALESCE_MS = 12
const STATIC_INITIAL_RENDER_BATCH_SIZE = 96
const STATIC_RENDER_BATCH_SIZE = 80
const STATIC_RENDER_BATCH_DELAY_MS = 0
const STATIC_RENDER_BATCH_BUDGET_MS = 8
const STATIC_RENDER_BATCH_IDLE_TIMEOUT_MS = 16
const STATIC_PARSE_COALESCE_MS = 0
const STATIC_MAX_LIVE_NODES = 260
const STATIC_LIVE_NODE_BUFFER = 80

const shouldVirtualizeNodes = computed(() => props.virtualizeNodes && !isStreaming.value)
const shouldUseViewportPriority = computed(() => props.virtualizeNodes)
const resolvedNodeVirtual = computed(() =>
  shouldVirtualizeNodes.value ? ('auto' as const) : false
)
const maxLiveNodes = computed(() => (shouldVirtualizeNodes.value ? STATIC_MAX_LIVE_NODES : 0))
const liveNodeBuffer = computed(() => (shouldVirtualizeNodes.value ? STATIC_LIVE_NODE_BUFFER : 0))
const initialRenderBatchSize = computed(() =>
  isStreaming.value ? STREAM_INITIAL_RENDER_BATCH_SIZE : STATIC_INITIAL_RENDER_BATCH_SIZE
)
const renderBatchSize = computed(() =>
  isStreaming.value ? STREAM_RENDER_BATCH_SIZE : STATIC_RENDER_BATCH_SIZE
)
const renderBatchDelay = computed(() =>
  isStreaming.value ? STREAM_RENDER_BATCH_DELAY_MS : STATIC_RENDER_BATCH_DELAY_MS
)
const renderBatchBudgetMs = computed(() =>
  isStreaming.value ? STREAM_RENDER_BATCH_BUDGET_MS : STATIC_RENDER_BATCH_BUDGET_MS
)
const renderBatchIdleTimeoutMs = computed(() =>
  isStreaming.value ? STREAM_RENDER_BATCH_IDLE_TIMEOUT_MS : STATIC_RENDER_BATCH_IDLE_TIMEOUT_MS
)
const parseCoalesceMs = computed(() =>
  isStreaming.value ? STREAM_PARSE_COALESCE_MS : STATIC_PARSE_COALESCE_MS
)
const { navigateLink } = useMarkdownLinkNavigation({
  linkContext: effectiveLinkContext
})

const getSearchResults = () => {
  if (!searchResultsPromise) {
    const request = sessionClient.getSearchResults(effectiveMessageId.value)
    searchResultsPromise = request
    void request.catch(() => {
      if (searchResultsPromise === request) {
        searchResultsPromise = null
      }
    })
  }

  return searchResultsPromise
}

function closestEventElement(event: Event, selector: string): HTMLElement | null {
  const target = event.target
  return target instanceof Element ? (target.closest(selector) as HTMLElement | null) : null
}

function getReferenceIndex(element: HTMLElement): number {
  return Number.parseInt(element.textContent?.trim() ?? '', 10) - 1
}

function isEventInsideElement(event: MouseEvent, element: HTMLElement): boolean {
  return event.relatedTarget instanceof Node && element.contains(event.relatedTarget)
}

function handleArtifactClick(v: CodeBlockPreviewPayload): void {
  artifactStore.showArtifact(
    {
      id: v.id,
      type: v.artifactType,
      title: v.artifactTitle,
      language: v.node.language,
      content: v.node.code,
      status: 'loaded'
    },
    effectiveMessageId.value,
    effectiveThreadId.value,
    { force: true }
  )
}

function handleRendererClick(event: MouseEvent): void {
  const referenceElement = closestEventElement(event, '.reference-node')
  if (referenceElement) {
    const index = getReferenceIndex(referenceElement)
    const contextRevision = rendererContextRevision
    if (index >= 0) {
      getSearchResults().then(
        (results) => {
          if (contextRevision === rendererContextRevision && index < results.length) {
            void navigateLink(results[index].url, event)
          }
        },
        () => undefined
      )
    }
    return
  }

  const anchor = closestEventElement(event, 'a.link-node[href]')
  if (anchor) {
    void navigateLink(anchor.getAttribute('href') ?? '', event)
  }
}

function handleRendererKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Enter' && event.key !== ' ') return
  const referenceElement = closestEventElement(event, '.reference-node')
  if (!referenceElement) return

  event.preventDefault()
  referenceElement.click()
}

function handleRendererMouseover(event: MouseEvent): void {
  const referenceElement = closestEventElement(event, '.reference-node')
  if (!referenceElement || isEventInsideElement(event, referenceElement)) return

  activeReferenceElement = referenceElement
  referenceStore.hideReference()
  const index = getReferenceIndex(referenceElement)
  if (index < 0) return

  getSearchResults().then(
    (results) => {
      if (activeReferenceElement === referenceElement && index < results.length) {
        referenceStore.showReference(results[index], referenceElement.getBoundingClientRect())
      }
    },
    () => undefined
  )
}

function handleRendererMouseout(event: MouseEvent): void {
  const referenceElement = closestEventElement(event, '.reference-node')
  if (!referenceElement || isEventInsideElement(event, referenceElement)) return

  if (activeReferenceElement === referenceElement) {
    activeReferenceElement = null
  }
  referenceStore.hideReference()
}

// Shared revision guard so an older slow-path update can never land after a
// newer fast-path update (or vice versa) when the routing condition flips,
// which would repaint stale markdown and reintroduce the completion flash.
let contentRevision = 0

const updateContentFast = useDebounceFn(
  (revision: number, value: string) => {
    if (revision === contentRevision) {
      renderContent.value = value
    }
  },
  32,
  { maxWait: 64 }
)
const updateContentSlow = useDebounceFn(
  (revision: number, value: string) => {
    if (revision === contentRevision) {
      renderContent.value = value
    }
  },
  96,
  { maxWait: 180 }
)

const updateContent = (value: string, commitImmediately: boolean) => {
  const revision = ++contentRevision
  const normalizedValue = normalizeMarkstreamCodeFenceLanguages(value)

  // Main already coalesces renderer snapshots and Markstream owns visible pacing.
  // Stream updates, including the final handoff, must not pass through a third timer.
  if (commitImmediately) {
    renderContent.value = normalizedValue
    return
  }

  if (props.smoothStreaming && value.length > 12_000) {
    updateContentSlow(revision, normalizedValue)
    return
  }

  updateContentFast(revision, normalizedValue)
}

watch([() => props.content, isStreaming], ([value, streaming], [, wasStreaming]) => {
  updateContent(value, streaming || wasStreaming === true)
})

watch(customRendererId, () => {
  rendererContextRevision += 1
  searchResultsPromise = null
  const ownedReferencePreview = activeReferenceElement !== null
  activeReferenceElement = null
  if (ownedReferencePreview) {
    referenceStore.hideReference()
  }
})

onMounted(() => {
  ensureMarkdownWorkers().catch((error) => {
    console.error('Failed to initialize markdown workers:', error)
  })
})

onBeforeUnmount(() => {
  rendererContextRevision += 1
  const ownedReferencePreview = activeReferenceElement !== null
  activeReferenceElement = null
  if (ownedReferencePreview) {
    referenceStore.hideReference()
  }
})

defineEmits(['copy'])
</script>

<style lang="css">
@reference '../../assets/style.css';

.prose {
  contain: layout style paint;

  pre {
    margin-top: 0;
    margin-bottom: 0;
  }

  .mermaid-block-header img {
    margin: 0 !important;
  }

  p {
    @apply my-2;
  }

  li p {
    padding-top: 0;
    padding-bottom: 0;
    margin-top: 0;
    margin-bottom: 0;
  }
  h1 {
    @apply text-2xl font-bold my-3 py-0;
  }
  h2 {
    @apply text-xl font-medium my-3 py-0;
  }
  h3 {
    @apply text-base font-medium my-2 py-0;
  }
  h4 {
    @apply text-sm font-medium my-2 py-0;
  }
  h5 {
    @apply text-sm my-1.5 py-0;
  }
  h6 {
    @apply text-sm my-1.5 py-0;
  }

  ul,
  ol {
    @apply my-1.5;
  }

  hr {
    @apply my-8;
  }

  /*
    精准定位到那个被错误地渲染在 <a> 标签内部的 <div>，
    并强制其以行内方式显示，从而修正换行 bug。
    这可以保留链接组件原有的所有样式（包括颜色）。
  */
  a .markdown-renderer {
    display: inline;
  }

  .table-node-wrapper {
    @apply border border-border rounded-lg py-0 my-0 overflow-hidden shadow-sm;
    contain: layout style paint;
  }

  table {
    @apply py-0 my-0;
    border-collapse: collapse;
    table-layout: auto;
  }

  thead,
  thead tr,
  thead th {
    @apply bg-muted;
  }

  th,
  td {
    @apply border-b not-last:border-r border-border;
  }

  tbody tr:last-child td {
    @apply border-b-0;
  }
}
</style>
