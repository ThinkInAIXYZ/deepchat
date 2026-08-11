<template>
  <template v-if="!isCapturingImage">
    <TooltipProvider :ignore-non-keyboard-focus="true">
      <div
        class="message-toolbar w-full h-7 text-xs text-muted-foreground items-center justify-between flex flex-row opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-within:opacity-100 transition-opacity duration-[var(--dc-motion-fast)] ease-[var(--dc-ease-out-soft)]"
        :class="[isAssistant ? '' : 'flex-row-reverse']"
      >
        <span v-show="!loading" class="flex flex-row gap-3">
          <!-- Edit mode buttons (save/cancel) -->
          <template v-if="isEditMode">
            <DcButton
              variant="ghost"
              size="icon-sm"
              icon="lucide:check"
              :tooltip="t('thread.toolbar.save')"
              :tooltip-delay-duration="200"
              class="w-4 h-4 min-w-0 min-h-0 p-0 text-muted-foreground hover:text-primary hover:bg-transparent transition-colors duration-[var(--dc-motion-fast)] ease-[var(--dc-ease-out-soft)]"
              @click="emit('save')"
            />
            <DcButton
              variant="ghost"
              size="icon-sm"
              icon="lucide:x"
              :tooltip="t('thread.toolbar.cancel')"
              :tooltip-delay-duration="200"
              class="w-4 h-4 min-w-0 min-h-0 p-0 text-muted-foreground hover:text-primary hover:bg-transparent transition-colors duration-[var(--dc-motion-fast)] ease-[var(--dc-ease-out-soft)]"
              @click="emit('cancel')"
            />
          </template>

          <!-- Normal mode buttons -->
          <template v-else>
            <DcButton
              v-if="!isAssistant && !isEditMode && !isReadOnly"
              variant="ghost"
              size="icon-sm"
              icon="lucide:refresh-cw"
              :tooltip="t('thread.toolbar.retry')"
              :tooltip-delay-duration="200"
              class="text-muted-foreground hover:text-primary hover:bg-transparent transition-colors duration-[var(--dc-motion-fast)] ease-[var(--dc-ease-out-soft)]"
              @click="emit('retry')"
            />
            <DcButton
              v-if="isAssistant && hasVariants"
              :disabled="currentVariantIndex === 0"
              variant="ghost"
              size="icon-sm"
              icon="lucide:chevron-left"
              :tooltip="t('thread.toolbar.previousVariant')"
              :tooltip-delay-duration="200"
              class="text-muted-foreground hover:text-primary hover:bg-transparent transition-colors duration-[var(--dc-motion-fast)] ease-[var(--dc-ease-out-soft)]"
              @click="emit('prev')"
            />
            <span v-if="isAssistant && hasVariants">
              {{ (currentVariantIndex ?? 0) + 1 }} / {{ totalVariants }}
            </span>
            <DcButton
              v-if="isAssistant && hasVariants"
              :disabled="(currentVariantIndex ?? 0) >= (totalVariants || 0) - 1"
              variant="ghost"
              size="icon-sm"
              icon="lucide:chevron-right"
              :tooltip="t('thread.toolbar.nextVariant')"
              :tooltip-delay-duration="200"
              class="text-muted-foreground hover:text-primary hover:bg-transparent transition-colors duration-[var(--dc-motion-fast)] ease-[var(--dc-ease-out-soft)]"
              @click="emit('next')"
            />
            <DcCopyButton
              size="icon-sm"
              variant="ghost"
              :tooltip="t('thread.toolbar.copy')"
              :tooltip-ignore-non-keyboard-focus="true"
              :copy-text="copyText"
              class="relative text-muted-foreground hover:text-primary hover:bg-transparent transition-colors duration-[var(--dc-motion-fast)] ease-[var(--dc-ease-out-soft)]"
              @copied="emit('copy')"
            />
            <DcButton
              v-if="isAssistant"
              variant="ghost"
              size="icon-sm"
              icon="lucide:images"
              :loading="isCapturingImage"
              :disabled="isCapturingImage"
              :tooltip="
                isCapturingImage
                  ? t('thread.toolbar.capturing')
                  : t('thread.toolbar.copyImageWithLongPress')
              "
              aria-keyshortcuts="Enter Space Shift+Enter Shift+Space"
              class="relative text-muted-foreground hover:text-primary hover:bg-transparent transition-colors duration-[var(--dc-motion-fast)] ease-[var(--dc-ease-out-soft)]"
              @mousedown="handleCopyImageStart"
              @mouseup="handleCopyImageEnd"
              @mouseleave="handleCopyImageCancel"
              @keydown="handleCopyImageKeyboard"
            >
              <span
                v-if="showCopyImageTip"
                class="absolute -top-6 left-1/2 transform -translate-x-1/2 bg-background border px-2 py-1 rounded text-xs whitespace-nowrap z-[var(--dc-z-popover)]"
              >
                {{ t('common.copyImageSuccess') }}
              </span>
              <span
                v-if="showCopyFromTopTip"
                class="absolute -top-6 left-1/2 transform -translate-x-1/2 bg-background border px-2 py-1 rounded text-xs whitespace-nowrap z-[var(--dc-z-popover)]"
              >
                {{ t('thread.toolbar.copyFromTopSuccess') }}
              </span>
            </DcButton>
            <DcButton
              v-if="isAssistant && !isReadOnly"
              variant="ghost"
              size="icon-sm"
              icon="lucide:refresh-cw"
              :tooltip="t('thread.toolbar.retry')"
              :tooltip-delay-duration="200"
              class="text-muted-foreground hover:text-primary hover:bg-transparent transition-colors duration-[var(--dc-motion-fast)] ease-[var(--dc-ease-out-soft)]"
              @click="emit('retry')"
            />
            <DcButton
              v-if="isAssistant && traceDebugEnabled && allowTrace"
              variant="ghost"
              size="icon-sm"
              icon="lucide:bug"
              :tooltip="t('thread.toolbar.trace')"
              class="text-muted-foreground hover:text-primary hover:bg-transparent transition-colors duration-[var(--dc-motion-fast)] ease-[var(--dc-ease-out-soft)]"
              @click="emit('trace')"
            />
            <DcButton
              v-if="isAssistant && allowMemory && !isReadOnly"
              variant="ghost"
              size="icon-sm"
              icon="lucide:brain"
              :tooltip="t('chat.memory.toolbar')"
              class="text-muted-foreground hover:text-primary hover:bg-transparent transition-colors duration-[var(--dc-motion-fast)] ease-[var(--dc-ease-out-soft)]"
              @click="emit('memory')"
            />
            <DcButton
              v-if="isAssistant && !loading && !isInGeneratingThread && !isReadOnly"
              variant="ghost"
              size="icon-sm"
              icon="lucide:git-branch"
              :tooltip="t('thread.toolbar.fork')"
              class="text-muted-foreground hover:text-primary hover:bg-transparent transition-colors duration-[var(--dc-motion-fast)] ease-[var(--dc-ease-out-soft)]"
              @click="emit('fork')"
            />
            <DcButton
              v-if="!isAssistant && !isEditMode && !isReadOnly"
              variant="ghost"
              size="icon-sm"
              icon="lucide:edit"
              icon-size="3"
              :tooltip="t('thread.toolbar.edit')"
              class="text-muted-foreground hover:text-primary hover:bg-transparent transition-colors duration-[var(--dc-motion-fast)] ease-[var(--dc-ease-out-soft)]"
              @click="emit('edit')"
            />
            <DcButton
              v-if="!isReadOnly"
              variant="ghost"
              size="icon-sm"
              icon="lucide:trash-2"
              :tooltip="t('thread.toolbar.delete')"
              class="text-destructive/70 hover:text-destructive hover:bg-destructive/10 transition-colors duration-[var(--dc-motion-fast)] ease-[var(--dc-ease-out-soft)]"
              @click="emit('delete')"
            />
          </template>
        </span>
        <span class="flex flex-row gap-2">
          <template v-if="usage.input_tokens > 0 || usage.output_tokens > 0">
            <span class="text-xs flex flex-row items-center">
              <Icon icon="lucide:arrow-up" class="w-3 h-3" />{{ usage.input_tokens }}
            </span>
            <span class="text-xs flex flex-row items-center">
              <Icon icon="lucide:arrow-down" class="w-3 h-3" />{{ usage.output_tokens }}
            </span>
          </template>
          <template v-if="hasTokensPerSecond">{{ usage.tokens_per_second?.toFixed(2) }}/S</template>
        </span>
      </div>
    </TooltipProvider>
  </template>
</template>

<script setup lang="ts">
import { Icon } from '@iconify/vue'
import { DcCopyButton, DcButton } from '@dc-ui/components'
import { computed, onBeforeUnmount, ref, type Ref } from 'vue'
import { TooltipProvider } from '@shadcn/components/ui/tooltip'
import { useI18n } from 'vue-i18n'
import { useUiSettingsStore } from '@/stores/uiSettingsStore'

const { t } = useI18n()
const uiSettingsStore = useUiSettingsStore()

const traceDebugEnabled = computed(() => uiSettingsStore.traceDebugEnabled)

const showCopyImageTip = ref(false)
const showCopyFromTopTip = ref(false)

let copyImagePressTimer: number | null = null
type TipTimerKey = 'copyImage' | 'copyFromTop'
const tipTimers: Record<TipTimerKey, number | null> = {
  copyImage: null,
  copyFromTop: null
}
const LONG_PRESS_DURATION = 800 // 长按时间阈值（毫秒）
const TIP_DURATION = 2000

const flashTip = (tip: Ref<boolean>, timerKey: TipTimerKey) => {
  tip.value = true
  const activeTimer = tipTimers[timerKey]
  if (activeTimer !== null) window.clearTimeout(activeTimer)
  tipTimers[timerKey] = window.setTimeout(() => {
    tip.value = false
    tipTimers[timerKey] = null
  }, TIP_DURATION)
}

const handleCopyImageStart = () => {
  copyImagePressTimer = window.setTimeout(() => {
    // 长按触发：从顶部开始截图
    emit('copyImageFromTop')
    flashTip(showCopyFromTopTip, 'copyFromTop')
    copyImagePressTimer = null
  }, LONG_PRESS_DURATION)
}

const handleCopyImageEnd = () => {
  if (copyImagePressTimer) {
    // 短按触发：只截图当前消息组
    window.clearTimeout(copyImagePressTimer)
    copyImagePressTimer = null
    emit('copyImage')
    flashTip(showCopyImageTip, 'copyImage')
  }
}

const handleCopyImageKeyboard = (event: KeyboardEvent) => {
  if (!['Enter', ' '].includes(event.key) || event.repeat || props.isCapturingImage) return

  event.preventDefault()
  if (event.shiftKey) {
    emit('copyImageFromTop')
    flashTip(showCopyFromTopTip, 'copyFromTop')
    return
  }

  emit('copyImage')
  flashTip(showCopyImageTip, 'copyImage')
}

const handleCopyImageCancel = () => {
  if (copyImagePressTimer) {
    window.clearTimeout(copyImagePressTimer)
    copyImagePressTimer = null
  }
}

const props = defineProps<{
  usage: {
    context_usage: number
    tokens_per_second: number
    total_tokens: number
    reasoning_start_time: number
    reasoning_end_time: number
    input_tokens: number
    output_tokens: number
  }
  loading: boolean
  isAssistant: boolean
  currentVariantIndex?: number
  totalVariants?: number
  isEditMode?: boolean
  isInGeneratingThread?: boolean
  isCapturingImage: boolean
  showTrace?: boolean
  showMemory?: boolean
  copyText: string
  isReadOnly?: boolean
}>()
const emit = defineEmits<{
  (e: 'retry'): void
  (e: 'delete'): void
  (e: 'copy'): void
  (e: 'copyImage'): void
  (e: 'prev'): void
  (e: 'next'): void
  (e: 'edit'): void
  (e: 'save'): void
  (e: 'cancel'): void
  (e: 'fork'): void
  (e: 'copyImageFromTop'): void
  (e: 'trace'): void
  (e: 'memory'): void
}>()

const hasTokensPerSecond = computed(() => props.usage.tokens_per_second > 0)
const hasVariants = computed(() => (props.totalVariants || 0) > 1)
const allowTrace = computed(() => props.showTrace ?? false)
const allowMemory = computed(() => props.showMemory ?? false)
const isReadOnly = computed(() => props.isReadOnly === true)

onBeforeUnmount(() => {
  for (const timer of [copyImagePressTimer, ...Object.values(tipTimers)]) {
    if (timer !== null) window.clearTimeout(timer)
  }
})
</script>

<style scoped>
.message-toolbar :deep([data-slot='dc-button']) {
  width: 1rem;
  height: 1rem;
  min-width: 1rem;
  min-height: 1rem;
  padding: 0;
}

@media (hover: none), (pointer: coarse) {
  .message-toolbar {
    opacity: 1;
  }
}
</style>
