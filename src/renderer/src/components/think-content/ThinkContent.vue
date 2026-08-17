<template>
  <div
    class="text-xs leading-4 text-[rgba(37,37,37,0.5)] dark:text-white/50 flex flex-col gap-[6px]"
  >
    <div
      class="inline-flex items-center gap-[10px] select-none self-start"
      @click="$emit('toggle')"
    >
      <span class="whitespace-nowrap">
        {{ label }}
      </span>
      <Icon
        v-if="thinking && !expanded"
        icon="lucide:ellipsis"
        class="w-[14px] h-[14px] text-[rgba(37,37,37,0.5)] dark:text-white/50 animate-[pulse_1s_ease-in-out_infinite]"
      />
      <Icon
        v-else-if="expanded"
        icon="lucide:chevron-down"
        class="w-[14px] h-[14px] text-[rgba(37,37,37,0.5)] dark:text-white/50"
      />
      <Icon
        v-else
        icon="lucide:chevron-right"
        class="w-[14px] h-[14px] text-[rgba(37,37,37,0.5)] dark:text-white/50"
      />
    </div>

    <div v-if="expanded" class="w-full relative">
      <NodeRenderer
        v-if="sanitizedContent"
        class="think-prose w-full max-w-full"
        :isDark="themeStore.isDark"
        :content="sanitizedContent"
        :deferNodesUntilVisible="true"
        :maxLiveNodes="120"
        :liveNodeBuffer="30"
        :customId="customId"
        :final="!thinking"
        :smooth-streaming="false"
        :code-block-stream="thinking"
        :code-block-props="thinkingCodeBlockProps"
      />
    </div>

    <Icon
      v-if="thinking && expanded"
      icon="lucide:ellipsis"
      class="w-[14px] h-[14px] text-[rgba(37,37,37,0.5)] dark:text-white/50 animate-[pulse_1s_ease-in-out_infinite]"
    />
  </div>
</template>

<script setup lang="ts">
import { useThemeStore } from '@/stores/theme'
import { Icon } from '@iconify/vue'
import { h, computed, onMounted, watch } from 'vue'
import NodeRenderer, { setCustomComponents, PreCodeNode } from 'markstream-vue'
import { ensureMarkdownWorkers } from '@/lib/markdownWorkerLifecycle'

const props = defineProps<{
  label: string
  expanded: boolean
  thinking: boolean
  content?: string
}>()

// Strip <style> tags to prevent global style pollution
const sanitizedContent = computed(() => {
  if (!props.content) return ''
  return props.content.replace(/<style[\s\S]*?<\/style>/gi, '')
})

defineEmits<{
  (e: 'toggle'): void
}>()
const customId = 'thinking-content'
const themeStore = useThemeStore()
const thinkingCodeBlockProps = {
  isShowPreview: false,
  showCopyButton: false,
  showExpandButton: false,
  showPreviewButton: false,
  showFontSizeButtons: false
} as const
const propsWatchSource = () => [props.label, props.expanded, props.thinking, props.content] as const

onMounted(() => {
  ensureMarkdownWorkers().catch((error) => {
    console.error('Failed to initialize markdown workers:', error)
  })
})

watch(propsWatchSource, () => {}, { immediate: true })
setCustomComponents(customId, {
  mermaid: (_props) =>
    h(PreCodeNode, {
      ..._props
    })
})
</script>

<style scoped>
@reference '../../assets/style.css';

.think-prose {
  --ms-text-body: calc(0.75rem * var(--dc-font-scale));
  --ms-leading-body: calc(1rem * var(--dc-font-scale));
  --ms-text-h1: var(--ms-text-body);
  --ms-text-h2: var(--ms-text-body);
  --ms-text-h3: var(--ms-text-body);
  --ms-text-h4: var(--ms-text-body);
  --ms-text-h5: var(--ms-text-body);
  --ms-text-h6: var(--ms-text-body);
  --ms-leading-h1: var(--ms-leading-body);
  --ms-leading-h2: var(--ms-leading-body);
  --ms-leading-h3: var(--ms-leading-body);
  --ms-font-sans: var(--dc-font-family);
}

.think-prose :deep(:where(h1, h2, h3, h4, h5, h6, .heading-node)) {
  font-size: inherit;
  line-height: inherit;
}

.think-prose :where(p, ul, li) {
  @apply mb-1 mt-0;
}
.think-prose :where(ul) {
  @apply my-1.5;
}
.think-prose :where(li) {
  @apply my-1.5;
}
.think-prose :where(p, li, ol, ul) {
  letter-spacing: 0;
}
.think-prose :where(ol, ul) {
  padding-left: 1.5em;
}
.think-prose :where(p, li, ol, ul) :where(a) {
  color: inherit;
  text-decoration: underline;
}
</style>
