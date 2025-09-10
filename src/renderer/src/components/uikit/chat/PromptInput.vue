<template>
  <!-- Wrapper mimicking the new prompt bar while reusing ChatInput functionality -->
  <div class="prompt-input w-full">
    <div class="flex flex-col gap-2 px-4 py-3 rounded-b-lg bg-background" :dir="langStore.dir">
      <!-- Forward to existing ChatInput for full functionality -->
      <ChatInput
        ref="innerRef"
        v-bind="$attrs"
        :disabled="disabled"
        :rows="rows"
        :max-rows="maxRows"
        :context-length="contextLength"
        @send="(v) => $emit('send', v)"
        @file-upload="(v) => $emit('file-upload', v)"
        class="prompt-input-inner w-full mx-auto"
      >
        <template #addon-buttons>
          <slot name="addon-buttons" />
        </template>
      </ChatInput>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import ChatInput from '@/components/ChatInput.vue'
import { useLanguageStore } from '@/stores/language'

defineOptions({ inheritAttrs: false })

withDefaults(
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
  border-top-width: 1px !important;
  border-left-width: 0 !important;
  border-right-width: 0 !important;
  border-bottom-width: 0 !important;
  border-radius: 0 0 0.5rem 0.5rem !important; /* bottom corners */
  box-shadow: none !important;
}

/* Avoid overriding generic p-2 to keep ChatInput's internal layout */

.prompt-input :deep(.file-list-enter-active),
.prompt-input :deep(.file-list-leave-active) {
  transition: all 0.2s ease;
}

/* Editor area: 12px top/bottom, 16px sides, 12px font with 18px leading */
.prompt-input :deep(.editor-content),
.prompt-input :deep([data-tiptap-editor]),
.prompt-input :deep(.tiptap) {
  padding: 12px 16px !important;
}
.prompt-input :deep(.p-2.text-sm) {
  padding: 12px 16px !important;
  font-size: 12px !important;
  line-height: 18px !important;
}
.prompt-input :deep(.tiptap p.is-editor-empty:first-child::before) {
  font-size: 12px !important;
  line-height: 18px !important;
}

/* Bottom bar: 6px gap, compact controls */
.prompt-input :deep(.flex.items-center.justify-between) {
  padding: 0 16px 8px 16px !important;
}

/* Do not resize internal buttons; keep ChatInput defaults for consistent layout */
</style>
