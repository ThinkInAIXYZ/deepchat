<template>
  <!-- Wrapper mimicking the new prompt bar while reusing ChatInput functionality -->
  <div class="prompt-input w-full max-w-4xl mx-auto">
    <div
      class="flex flex-col gap-2 px-4 py-3 rounded-b-lg border-t border-border bg-background"
      :dir="langStore.dir"
    >
      <!-- Forward to existing ChatInput for full functionality -->
      <ChatInput
        ref="innerRef"
        v-bind="passThroughProps"
        :disabled="disabled"
        :rows="rows"
        :max-rows="maxRows"
        :context-length="contextLength"
        @send="(v) => $emit('send', v)"
        @file-upload="(v) => $emit('file-upload', v)"
        class="prompt-input-inner"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import ChatInput from '@/components/ChatInput.vue'
import { useLanguageStore } from '@/stores/language'

defineOptions({ inheritAttrs: false })

const props = withDefaults(
  defineProps<{
    contextLength?: number
    maxRows?: number
    rows?: number
    disabled?: boolean
  }>(),
  {
    maxRows: 10,
    rows: 1,
    disabled: false
  }
)

const passThroughProps = computed(() => ({
  contextLength: props.contextLength,
  maxRows: props.maxRows,
  rows: props.rows,
  disabled: props.disabled
}))

const langStore = useLanguageStore()
const innerRef = ref<InstanceType<typeof ChatInput> | null>(null)

defineEmits<{
  send: [value: any]
  'file-upload': [value: any]
}>()

// Expose the common methods so ChatView can keep using ref APIs
defineExpose({
  restoreFocus: () => innerRef.value?.restoreFocus?.(),
  clearContent: () => innerRef.value?.clearContent?.(),
  appendText: (t: string) => innerRef.value?.appendText?.(t),
  appendMention: (n: string) => innerRef.value?.appendMention?.(n)
})
</script>

<style scoped>
/* Make the inner ChatInput container visually match the new prompt bar */
.prompt-input :deep(.bg-card) {
  background-color: transparent !important;
}

.prompt-input :deep(.border.border-border.rounded-lg) {
  border: 0 !important;
  border-radius: 0 !important;
  box-shadow: none !important;
}

.prompt-input :deep(.p-2) {
  padding: 0 !important;
}

.prompt-input :deep(.file-list-enter-active),
.prompt-input :deep(.file-list-leave-active) {
  transition: all 0.2s ease;
}
</style>

