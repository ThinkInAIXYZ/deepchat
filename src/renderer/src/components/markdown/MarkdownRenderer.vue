<template>
  <div
    class="markdown-renderer-root prose prose-zinc prose-sm dark:prose-invert w-full max-w-none break-words"
    @keydown="handleRendererKeydown"
  >
    <NodeRenderer
      v-for="segment in renderSegments"
      :key="segment.key"
      :content="segment.content"
      :custom-id="segment.customId"
      :isDark="themeStore.isDark"
      :mode="props.mode"
      :final="segment.final"
      :smooth-streaming="segment.smoothStreaming"
      :typewriter="segment.typewriter"
      :code-block-stream="segment.codeBlockStream"
      :themes="codeBlockThemes"
      :code-block-options="codeBlockOptions"
      :mermaid-props="mermaidProps"
      :fade="false"
      :batch-rendering="true"
      :initial-render-batch-size="segment.initialBatch"
      :render-batch-size="segment.batchSize"
      :render-batch-delay="segment.batchDelay"
      :render-batch-budget-ms="segment.batchBudget"
      :render-batch-idle-timeout-ms="segment.batchIdle"
      :parse-coalesce-ms="segment.parseCoalesce"
      :parse-options="parseOptions"
      html-policy="safe"
      :defer-nodes-until-visible="props.virtualizeNodes"
      :viewport-priority="props.virtualizeNodes"
      :node-virtual="segment.nodeVirtual"
      :max-live-nodes="segment.maxLiveNodes"
      :live-node-buffer="segment.liveNodeBuffer"
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
// Content-update coalescing scales with the accumulated document length.
// Streaming updates bypass these debouncers entirely (they commit immediately
// via commitImmediately: main already coalesces renderer snapshots and Markstream
// owns visible pacing); the length-adaptive levels feed `parseCoalesceMs` during
// streaming and keep the remaining content-update path debounced (profile:
// 19-33fps, 1.8s main thread stalls on long streams).
const CONTENT_UPDATE_COALESCE_LEVELS = [
  { maxLength: 8_000, debounceMs: 32, maxWaitMs: 64, parseCoalesceMs: 12 },
  { maxLength: 32_000, debounceMs: 64, maxWaitMs: 128, parseCoalesceMs: 28 },
  {
    maxLength: Number.POSITIVE_INFINITY,
    debounceMs: 120,
    maxWaitMs: 220,
    parseCoalesceMs: 48
  }
] as const

const contentUpdateCoalesceLevel = (length: number) =>
  CONTENT_UPDATE_COALESCE_LEVELS.find((level) => length <= level.maxLength) ??
  CONTENT_UPDATE_COALESCE_LEVELS[CONTENT_UPDATE_COALESCE_LEVELS.length - 1]
// Streaming render is split into a static committed prefix + a small live tail
// (see findSafeSplit / renderSegments below). The tail must stay small so each
// token only re-renders a bounded chunk instead of the whole document.
const STREAM_TAIL_CAP_CHARS = 6000
const STREAM_MIN_TAIL_CHARS = 2000
const STATIC_INITIAL_RENDER_BATCH_SIZE = 96
const STATIC_RENDER_BATCH_SIZE = 80
const STATIC_RENDER_BATCH_DELAY_MS = 0
const STATIC_RENDER_BATCH_BUDGET_MS = 8
const STATIC_RENDER_BATCH_IDLE_TIMEOUT_MS = 16
const STATIC_PARSE_COALESCE_MS = 0
const STATIC_MAX_LIVE_NODES = 260
const STATIC_LIVE_NODE_BUFFER = 80

const shouldVirtualizeNodes = computed(() => props.virtualizeNodes && !isStreaming.value)
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
const parseCoalesceMs = computed(() => {
  if (!isStreaming.value) return STATIC_PARSE_COALESCE_MS
  return contentUpdateCoalesceLevel(renderContent.value.length).parseCoalesceMs
})

// --- Streaming split-render (committed prefix + live tail) ---
// Each token currently makes Markstream re-render the whole document, so long
// streams stall the renderer. Instead, once the stream passes the tail cap we
// render a static committed prefix (only re-rendered when the split advances,
// with node virtualization limiting the cost) plus a small streaming tail that
// is cheap to re-render per token. On completion everything re-renders once as
// a single static document.
const committedLength = ref(0)

const fenceLineStarts = (s: string): { backtick: number[]; tilde: number[] } => {
  const backtick: number[] = []
  const tilde: number[] = []
  const re = /^(`{3,}|~{3,})/gm
  let match: RegExpExecArray | null
  while ((match = re.exec(s)) !== null) {
    if (match[1].startsWith('`')) {
      backtick.push(match.index)
    } else {
      tilde.push(match.index)
    }
  }
  return { backtick, tilde }
}

const findSafeSplit = (content: string, preferred: number, current: number): number => {
  const minSplit = Math.max(0, content.length - STREAM_TAIL_CAP_CHARS)
  const maxSplit = Math.min(content.length, Math.max(0, preferred))
  // Prefer a blank-line boundary so blocks/paragraphs aren't chopped mid-way.
  const blankLine = content.lastIndexOf('\n\n', maxSplit)
  let split = blankLine >= minSplit ? Math.min(maxSplit, blankLine + 2) : maxSplit
  // No blank-line boundary in the window: advancing would chop a long
  // paragraph/list mid-way. Keep the current split (no advance) until a safe
  // boundary appears instead of rendering a half-paragraph in the prefix.
  if (blankLine < minSplit) return current
  // Fences must be balanced per marker type (` vs ~): an odd count of either
  // means the committed prefix ends inside an unclosed fence.
  const fenceStarts = fenceLineStarts(content.slice(0, split))
  const unbalanced =
    fenceStarts.backtick.length % 2 === 1
      ? fenceStarts.backtick
      : fenceStarts.tilde.length % 2 === 1
        ? fenceStarts.tilde
        : null
  if (unbalanced) {
    const opener = unbalanced[unbalanced.length - 1]
    const beforeFence = opener >= 0 ? content.lastIndexOf('\n\n', opener) : -1
    // A single fenced block can be larger than the tail cap; committing a piece
    // of it would leave an unterminated code block in the static prefix. Keep
    // the current split (no advance) until the fence closes.
    if (beforeFence < minSplit || beforeFence < 0) return current
    split = Math.min(maxSplit, beforeFence + 2)
  }
  return split
}

// Split only once a committed prefix actually exists: a stream that cannot be
// split safely (e.g. a single fenced block larger than the tail cap) keeps
// `committedLength` at 0 and renders as a single streaming document.
const usingSplitRender = computed(() => isStreaming.value && committedLength.value > 0)
const committedContent = computed(() =>
  usingSplitRender.value ? renderContent.value.slice(0, committedLength.value) : ''
)
const tailContent = computed(() =>
  usingSplitRender.value ? renderContent.value.slice(committedLength.value) : renderContent.value
)

watch(
  renderContent,
  (content) => {
    if (!isStreaming.value) return
    // A regenerated/interrupted stream can shrink below an already-advanced
    // split; reset so the split restarts from scratch instead of keeping a
    // stale prefix (which would eat the whole content into the prefix).
    if (content.length < committedLength.value) {
      committedLength.value = 0
    }
    if (content.length - committedLength.value > STREAM_TAIL_CAP_CHARS) {
      committedLength.value = findSafeSplit(
        content,
        content.length - STREAM_MIN_TAIL_CHARS,
        committedLength.value
      )
    }
  },
  { immediate: true }
)

watch(isStreaming, (streaming, wasStreaming) => {
  if (wasStreaming && !streaming) committedLength.value = 0
})

type RenderSegment = {
  key: string
  content: string
  final: boolean
  codeBlockStream: boolean
  smoothStreaming: boolean | 'auto'
  typewriter: boolean | 'simple'
  nodeVirtual: boolean | 'auto'
  maxLiveNodes: number
  liveNodeBuffer: number
  initialBatch: number
  batchSize: number
  batchDelay: number
  batchBudget: number
  batchIdle: number
  parseCoalesce: number
  customId: string
}

const renderSegments = computed<RenderSegment[]>(() => {
  if (!usingSplitRender.value) {
    return [
      {
        key: 'full',
        content: renderContent.value,
        final: resolvedFinal.value,
        codeBlockStream: isStreaming.value,
        smoothStreaming: resolvedSmoothStreaming.value,
        typewriter: resolvedTypewriter.value,
        nodeVirtual: resolvedNodeVirtual.value,
        maxLiveNodes: maxLiveNodes.value,
        liveNodeBuffer: liveNodeBuffer.value,
        initialBatch: initialRenderBatchSize.value,
        batchSize: renderBatchSize.value,
        batchDelay: renderBatchDelay.value,
        batchBudget: renderBatchBudgetMs.value,
        batchIdle: renderBatchIdleTimeoutMs.value,
        parseCoalesce: parseCoalesceMs.value,
        customId: customRendererId.value
      }
    ]
  }
  return [
    {
      key: 'prefix',
      content: committedContent.value,
      final: true,
      codeBlockStream: false,
      smoothStreaming: false,
      typewriter: false,
      nodeVirtual: 'auto',
      maxLiveNodes: STATIC_MAX_LIVE_NODES,
      liveNodeBuffer: STATIC_LIVE_NODE_BUFFER,
      initialBatch: STATIC_INITIAL_RENDER_BATCH_SIZE,
      batchSize: STATIC_RENDER_BATCH_SIZE,
      batchDelay: STATIC_RENDER_BATCH_DELAY_MS,
      batchBudget: STATIC_RENDER_BATCH_BUDGET_MS,
      batchIdle: STATIC_RENDER_BATCH_IDLE_TIMEOUT_MS,
      parseCoalesce: STATIC_PARSE_COALESCE_MS,
      customId: `${customRendererId.value}::prefix`
    },
    {
      key: 'tail',
      content: tailContent.value,
      final: false,
      codeBlockStream: true,
      smoothStreaming: resolvedSmoothStreaming.value,
      typewriter: resolvedTypewriter.value,
      nodeVirtual: false,
      maxLiveNodes: 0,
      liveNodeBuffer: 0,
      initialBatch: STREAM_INITIAL_RENDER_BATCH_SIZE,
      batchSize: STREAM_RENDER_BATCH_SIZE,
      batchDelay: STREAM_RENDER_BATCH_DELAY_MS,
      batchBudget: STREAM_RENDER_BATCH_BUDGET_MS,
      batchIdle: STREAM_RENDER_BATCH_IDLE_TIMEOUT_MS,
      parseCoalesce: parseCoalesceMs.value,
      customId: `${customRendererId.value}::tail`
    }
  ]
})

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

const contentUpdateDebouncers = CONTENT_UPDATE_COALESCE_LEVELS.map((level) =>
  useDebounceFn(
    (revision: number, value: string) => {
      if (revision === contentRevision) {
        renderContent.value = value
      }
    },
    level.debounceMs,
    { maxWait: level.maxWaitMs }
  )
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

  const levelIndex = isStreaming.value
    ? CONTENT_UPDATE_COALESCE_LEVELS.indexOf(contentUpdateCoalesceLevel(value.length))
    : 0
  contentUpdateDebouncers[levelIndex](revision, normalizedValue)
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
