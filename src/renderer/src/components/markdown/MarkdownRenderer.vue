<template>
  <div class="prose prose-zinc prose-sm dark:prose-invert w-full max-w-none break-all">
    <NodeRenderer
      :content="debouncedContent"
      :custom-id="customRendererId"
      :isDark="themeStore.isDark"
      :codeBlockDarkTheme="codeBlockDarkTheme"
      :codeBlockLightTheme="codeBlockLightTheme"
      :codeBlockMonacoOptions="codeBlockMonacoOption"
      @copy="$emit('copy', $event)"
    />
  </div>
</template>

<script setup lang="ts">
import { usePresenter } from '@/composables/usePresenter'
import { useArtifactStore } from '@/stores/artifact'
import { useReferenceStore } from '@/stores/reference'
import { nanoid } from 'nanoid'
import { useDebounceFn } from '@vueuse/core'
import { computed, h, onBeforeUnmount, ref, watch } from 'vue'
import NodeRenderer, {
  CodeBlockNode,
  ReferenceNode,
  removeCustomComponents,
  setCustomComponents,
  MermaidBlockNode
} from 'markstream-vue'
import { useThemeStore } from '@/stores/theme'
import { useUiSettingsStore } from '@/stores/uiSettingsStore'
import LinkNode from './LinkNode.vue'
import { useMarkdownLinkNavigation } from './useMarkdownLinkNavigation'
import type { MarkdownLinkContext } from './linkTypes'

const props = defineProps<{
  content: string
  debug?: boolean
  messageId?: string
  threadId?: string
  linkContext?: MarkdownLinkContext
}>()
const themeStore = useThemeStore()
const uiSettingsStore = useUiSettingsStore()
// 组件映射表
const artifactStore = useArtifactStore()
// 生成唯一的 message ID 和 thread ID，用于 MarkdownRenderer
const fallbackMessageId = `artifact-msg-${nanoid()}`
const fallbackThreadId = `artifact-thread-${nanoid()}`
const referenceStore = useReferenceStore()
const agentSessionPresenter = usePresenter('agentSessionPresenter')
const referenceNode = ref<HTMLElement | null>(null)
const debouncedContent = ref(props.content)
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
    effectiveLinkContext.value.sourceFilePath ?? ''
  ].join('::')
)
const codeBlockThemes = ['vitesse-dark', 'vitesse-light'] as const
const codeBlockDarkTheme = codeBlockThemes[0]
const codeBlockLightTheme = codeBlockThemes[1]
const codeBlockMonacoOption = computed(() => ({
  fontFamily: uiSettingsStore.formattedCodeFontFamily
}))
const { navigateLink } = useMarkdownLinkNavigation({
  linkContext: effectiveLinkContext
})

const updateContent = useDebounceFn(
  (value: string) => {
    debouncedContent.value = value
  },
  32,
  { maxWait: 64 }
)

watch(
  () => props.content,
  (value) => {
    updateContent(value)
  }
)

watch(
  customRendererId,
  (nextCustomRendererId, previousCustomRendererId) => {
    if (previousCustomRendererId && previousCustomRendererId !== nextCustomRendererId) {
      removeCustomComponents(previousCustomRendererId)
    }

    setCustomComponents(nextCustomRendererId, {
      link: (_props) =>
        h(LinkNode, {
          ..._props,
          linkContext: effectiveLinkContext.value
        }),
      reference: (_props) =>
        h(ReferenceNode, {
          ..._props,
          messageId: effectiveMessageId.value,
          threadId: effectiveThreadId.value,
          onClick(event?: MouseEvent) {
            agentSessionPresenter.getSearchResults(effectiveMessageId.value).then((results) => {
              const index = parseInt(_props.node.id, 10) - 1
              if (index >= 0 && index < results.length) {
                void navigateLink(results[index].url, event)
              }
            })
          },
          onMouseEnter() {
            referenceStore.hideReference()
            agentSessionPresenter.getSearchResults(effectiveMessageId.value).then((results) => {
              const index = parseInt(_props.node.id, 10) - 1
              if (index >= 0 && index < results.length && referenceNode.value) {
                referenceStore.showReference(
                  results[index],
                  referenceNode.value.getBoundingClientRect()
                )
              }
            })
          },
          onMouseLeave() {
            referenceStore.hideReference()
          }
        }),
      mermaid: (_props) => {
        return h(MermaidBlockNode, {
          ..._props,
          isStrict: true
        })
      },
      code_block: (_props) => {
        const isMermaid = _props.node.language === 'mermaid'
        if (isMermaid) {
          return h(MermaidBlockNode, {
            ..._props,
            isStrict: true
          })
        }
        return h(CodeBlockNode, {
          ..._props,
          isDark: themeStore.isDark,
          darkTheme: codeBlockDarkTheme,
          lightTheme: codeBlockLightTheme,
          themes: [...codeBlockThemes],
          monacoOptions: codeBlockMonacoOption.value,
          onPreviewCode(v) {
            artifactStore.showArtifact(
              {
                id: v.id,
                type: v.artifactType,
                title: v.artifactTitle,
                language: v.language,
                content: v.node.code,
                status: 'loaded'
              },
              effectiveMessageId.value,
              effectiveThreadId.value,
              { force: true }
            )
          }
        })
      }
    })
  },
  {
    immediate: true
  }
)

onBeforeUnmount(() => {
  removeCustomComponents(customRendererId.value)
})

defineEmits(['copy'])
</script>

<style lang="css">
@reference '../../assets/style.css';

.prose {
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
  }

  table {
    @apply py-0 my-0;
    /* @apply bg-card border block rounded-lg my-0 py-0 overflow-hidden; */
    border-collapse: collapse;
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
