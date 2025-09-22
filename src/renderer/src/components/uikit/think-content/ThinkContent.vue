<!-- eslint-disable vue/no-v-html -->
<template>
  <div
    class="text-xs leading-4 text-[rgba(37,37,37,0.5)] dark:text-white/50 flex flex-col gap-[6px]"
  >
    <div
      class="inline-flex items-center gap-[10px] cursor-pointer select-none self-start"
      @click="$emit('toggle')"
    >
      <span class="whitespace-nowrap">{{ label }}</span>
      <Icon
        v-if="thinking && !expanded"
        icon="lucide:ellipsis"
        class="w-[14px] h-[14px] text-[rgba(37,37,37,0.5)] dark:text-white/50 animate-pulse"
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
      <div class="think-prose w-full max-w-full mt-[6px]" v-html="contentHtml"></div>
    </div>

    <Icon
      v-if="thinking && expanded"
      icon="lucide:ellipsis"
      class="w-[14px] h-[14px] text-[rgba(37,37,37,0.5)] dark:text-white/50 animate-pulse"
    />
  </div>
</template>

<script setup lang="ts">
import { Icon } from '@iconify/vue'

defineProps<{
  label: string
  expanded: boolean
  thinking: boolean
  contentHtml?: string
}>()

defineEmits<{
  (e: 'toggle'): void
}>()
</script>

<style scoped>
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
