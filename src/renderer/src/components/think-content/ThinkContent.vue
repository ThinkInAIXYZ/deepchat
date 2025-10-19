<!-- eslint-disable vue/no-v-html -->
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
        v-if="content"
        class="think-prose w-full max-w-full"
        :content="content"
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
import { Icon } from '@iconify/vue'
import { h } from 'vue'
import NodeRenderer, {
  setCustomComponents,
  CodeBlockNode,
  PreCodeNode
} from 'vue-renderer-markdown'

defineProps<{
  label: string
  expanded: boolean
  thinking: boolean
  content?: string
}>()

defineEmits<{
  (e: 'toggle'): void
}>()
const customId = 'thinking-content'
setCustomComponents(customId, {
  code_block: (_props) =>
    h(
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
    ),
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
  font-size: 12px;
  line-height: 16px;
  letter-spacing: 0;
  color: rgba(37, 37, 37, 0.5);
}
.think-prose :where(ol, ul) {
  padding-left: 1.5em;
}
.think-prose :where(p, li, ol, ul) :where(a) {
  color: rgba(37, 37, 37, 0.6);
  text-decoration: underline;
}
.dark .think-prose :where(p, li, ol, ul) {
  color: rgba(255, 255, 255, 0.5);
}
.dark .think-prose :where(p, li, ol, ul) :where(a) {
  color: rgba(255, 255, 255, 0.6);
}
</style>
