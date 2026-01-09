<template>
  <div
    class="text-xs leading-4 text-[rgba(37,37,37,0.5)] dark:text-white/50 flex flex-col gap-[6px]"
  >
    <div
      class="inline-flex items-center gap-[10px] cursor-pointer select-none self-start"
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

    <div v-show="expanded" class="w-full relative">
      <NodeRenderer
        v-if="sanitizedContent"
        class="think-prose w-full max-w-full"
        :isDark="themeStore.isDark"
        :content="sanitizedContent"
        :deferNodesUntilVisible="true"
        :maxLiveNodes="120"
        :liveNodeBuffer="30"
        :customId="customId"
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
import { h, computed, watch } from 'vue'
import NodeRenderer, { setCustomComponents, CodeBlockNode, PreCodeNode } from 'markstream-vue'

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
const propsWatchSource = () => [props.label, props.expanded, props.thinking, props.content] as const

watch(propsWatchSource, () => {}, { immediate: true })
setCustomComponents(customId, {
  code_block: (_props) => {
    const isMermaid = _props.node.language === 'mermaid'
    if (isMermaid) {
      // 对于 Mermaid 代码块，直接返回 MermaidNode 组件
      return h(PreCodeNode.vue, {
        ..._props
      })
    }
    return h(
      CodeBlockNode,
      {
        ..._props,
        isShowPreview: false,
        showCopyButton: false,
        showExpandButton: false,
        showPreviewButton: false,
        showFontSizeButtons: false
      },
      undefined
    )
  },
  mermaid: (_props) =>
    h(PreCodeNode.vue, {
      ..._props
    })
})
</script>

<style scoped>
@reference '../../assets/style.css';
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
  font-size: inherit;
  line-height: inherit;
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
