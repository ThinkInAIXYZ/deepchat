<template>
  <template v-if="!isCapturingImage">
    <TooltipProvider>
      <div
        class="w-full h-8 text-xs text-muted-foreground items-center justify-between flex flex-row opacity-0 group-hover:opacity-100 transition-opacity"
        :class="[isAssistant ? '' : 'flex-row-reverse']"
      >
        <span v-show="!loading" class="flex flex-row gap-3">
          <!-- Edit mode buttons (save/cancel) -->
          <template v-if="isEditMode">
            <Tooltip :delayDuration="200">
              <TooltipTrigger as-child>
                <Button
                  variant="ghost"
                  size="icon"
                  class="w-4 h-4 text-muted-foreground hover:text-primary hover:bg-transparent"
                  @click="emit('save')"
                >
                  <Icon icon="lucide:check" class="w-3 h-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{{ t('thread.toolbar.save') }}</TooltipContent>
            </Tooltip>
            <Tooltip :delayDuration="200">
              <TooltipTrigger as-child>
                <Button
                  variant="ghost"
                  size="icon"
                  class="w-4 h-4 text-muted-foreground hover:text-primary hover:bg-transparent"
                  @click="emit('cancel')"
                >
                  <Icon icon="lucide:x" class="w-3 h-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{{ t('thread.toolbar.cancel') }}</TooltipContent>
            </Tooltip>
          </template>

          <!-- Normal mode buttons -->
          <template v-else>
            <Tooltip :delayDuration="200">
              <TooltipTrigger as-child>
                <Button
                  v-show="isAssistant && hasVariants"
                  :disabled="currentVariantIndex === 0"
                  variant="ghost"
                  size="icon"
                  class="w-4 h-4 text-muted-foreground hover:text-primary hover:bg-transparent"
                  @click="emit('prev')"
                >
                  <Icon icon="lucide:chevron-left" class="w-3 h-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{{ t('thread.toolbar.previousVariant') }}</TooltipContent>
            </Tooltip>
            <span v-show="isAssistant && hasVariants">
              {{ currentVariantIndex !== undefined ? currentVariantIndex + 1 : 1 }} /
              {{ totalVariants }}
            </span>
            <Tooltip :delayDuration="200">
              <TooltipTrigger as-child>
                <Button
                  v-show="isAssistant && hasVariants"
                  :disabled="hasVariants && totalVariants === (currentVariantIndex ?? 0) + 1"
                  variant="ghost"
                  size="icon"
                  class="w-4 h-4 text-muted-foreground hover:text-primary hover:bg-transparent"
                  @click="emit('next')"
                >
                  <Icon icon="lucide:chevron-right" class="w-3 h-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{{ t('thread.toolbar.nextVariant') }}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger as-child>
                <Button
                  variant="ghost"
                  size="icon"
                  class="w-4 h-4 text-muted-foreground hover:text-primary hover:bg-transparent relative"
                  @click="handleCopy"
                >
                  <Icon icon="lucide:copy" class="w-3 h-3" />
                  <span
                    v-if="showCopyTip"
                    class="absolute -top-6 left-1/2 transform -translate-x-1/2 bg-background border px-2 py-1 rounded text-xs whitespace-nowrap z-50"
                  >
                    {{ t('common.copySuccess') }}
                  </span>
                </Button>
              </TooltipTrigger>
              <TooltipContent>{{ t('thread.toolbar.copy') }}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger as-child>
                <Button
                  v-show="isAssistant"
                  variant="ghost"
                  size="icon"
                  class="w-4 h-4 text-muted-foreground hover:text-primary hover:bg-transparent relative"
                  :disabled="isCapturingImage"
                  @mousedown="handleCopyImageStart"
                  @mouseup="handleCopyImageEnd"
                  @mouseleave="handleCopyImageCancel"
                >
                  <Icon v-if="isCapturingImage" icon="lucide:loader" class="w-3 h-3 animate-spin" />
                  <Icon v-else icon="lucide:images" class="w-3 h-3" />
                  <span
                    v-if="showCopyImageTip"
                    class="absolute -top-6 left-1/2 transform -translate-x-1/2 bg-background border px-2 py-1 rounded text-xs whitespace-nowrap z-50"
                  >
                    {{ t('common.copyImageSuccess') }}
                  </span>
                  <span
                    v-if="showCopyFromTopTip"
                    class="absolute -top-6 left-1/2 transform -translate-x-1/2 bg-background border px-2 py-1 rounded text-xs whitespace-nowrap z-50"
                  >
                    {{ t('thread.toolbar.copyFromTopSuccess') }}
                  </span>
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {{
                  isCapturingImage
                    ? t('thread.toolbar.capturing')
                    : t('thread.toolbar.copyImageWithLongPress')
                }}
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger as-child>
                <Button
                  v-show="isAssistant"
                  variant="ghost"
                  size="icon"
                  class="w-4 h-4 text-muted-foreground hover:text-primary hover:bg-transparent"
                  @click="emit('retry')"
                >
                  <Icon icon="lucide:refresh-cw" class="w-3 h-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{{ t('thread.toolbar.retry') }}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger as-child>
                <Button
                  v-show="isAssistant && !loading && !isInGeneratingThread"
                  variant="ghost"
                  size="icon"
                  class="w-4 h-4 text-muted-foreground hover:text-primary hover:bg-transparent"
                  @click="emit('fork')"
                >
                  <Icon icon="lucide:git-branch" class="w-3 h-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{{ t('thread.toolbar.fork') }}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger as-child>
                <Button
                  v-show="!isAssistant && !isEditMode"
                  variant="ghost"
                  size="icon"
                  class="w-4 h-4 text-muted-foreground hover:text-primary hover:bg-transparent"
                  @click="emit('edit')"
                >
                  <Icon icon="lucide:edit" class="w-3 h-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{{ t('thread.toolbar.edit') }}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger as-child>
                <Button
                  variant="ghost"
                  size="icon"
                  class="w-4 h-4 text-muted-foreground hover:text-primary hover:bg-transparent"
                  @click="emit('delete')"
                >
                  <Icon icon="lucide:trash-2" class="w-3 h-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{{ t('thread.toolbar.delete') }}</TooltipContent>
            </Tooltip>
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
            <span
              class="text-xs flex flex-row items-center"
              :class="getUsageColorClass(usage.context_usage)"
            >
              <Icon icon="lucide:gauge" class="w-3 h-3 mr-1" />
              {{ usage.context_usage?.toFixed(2) }}%
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
import { Button } from '@/components/ui/button'
import { computed, ref } from 'vue'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

const showCopyTip = ref(false)
const showCopyImageTip = ref(false)
const showCopyFromTopTip = ref(false)

let copyImagePressTimer: number | null = null
const LONG_PRESS_DURATION = 800 // 长按时间阈值（毫秒）

function getUsageColorClass(value) {
  if (value == null) return ''
  if (value > 70) return 'text-usage-high'
  if (value > 45) return 'text-usage-mid'
  return 'text-usage-low'
}

const handleCopy = () => {
  emit('copy')
  showCopyTip.value = true
  setTimeout(() => {
    showCopyTip.value = false
  }, 2000)
}

const handleCopyImageStart = () => {
  copyImagePressTimer = window.setTimeout(() => {
    // 长按触发：从顶部开始截图
    emit('copyImageFromTop')
    showCopyFromTopTip.value = true
    setTimeout(() => {
      showCopyFromTopTip.value = false
    }, 2000)
    copyImagePressTimer = null
  }, LONG_PRESS_DURATION)
}

const handleCopyImageEnd = () => {
  if (copyImagePressTimer) {
    // 短按触发：只截图当前消息组
    window.clearTimeout(copyImagePressTimer)
    copyImagePressTimer = null
    emit('copyImage')
    showCopyImageTip.value = true
    setTimeout(() => {
      showCopyImageTip.value = false
    }, 2000)
  }
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
}>()

const hasTokensPerSecond = computed(() => props.usage.tokens_per_second > 0)
const hasVariants = computed(() => (props.totalVariants || 0) > 1)
</script>

<style scoped>
.relative {
  position: relative;
}
</style>
