<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { computed, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { DcButton } from '@dc-ui/components/button'
import { notifyRenderer } from '@renderer-notifications/rendererNotificationPort'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from '@shadcn/components/ui/tooltip'
import { cn } from '@shadcn/lib/utils'

type DcTooltipSide = 'top' | 'bottom' | 'left' | 'right'

interface Props {
  /** 要复制的内容；缺省时组件不执行复制，由调用方通过 slot 自定义或事件处理 */
  copyText?: string
  /** 是否带文字标签（默认 icon-only） */
  label?: string
  size?: 'default' | 'sm' | 'xs'
  iconSize?: '3' | '3.5' | '4'
  variant?: 'default' | 'outline' | 'secondary' | 'ghost' | 'destructive' | 'link'
  /** 复制成功时是否弹 toast（默认只显示按钮 ✅） */
  showToast?: boolean
  successDuration?: number
  disabled?: boolean
  /** 显式 tooltip；不复用 label，避免文字按钮意外出现 tooltip */
  tooltip?: string
  tooltipSide?: DcTooltipSide
  tooltipSideOffset?: number
  tooltipDelayDuration?: number
  tooltipContentClass?: HTMLAttributes['class']
  tooltipIgnoreNonKeyboardFocus?: boolean
  class?: HTMLAttributes['class']
}

const props = withDefaults(defineProps<Props>(), {
  variant: 'ghost',
  showToast: false,
  successDuration: 1500,
  tooltipSide: 'top',
  tooltipSideOffset: 4,
  tooltipIgnoreNonKeyboardFocus: false
})

defineOptions({
  inheritAttrs: false
})

const emit = defineEmits<{
  (e: 'copied'): void
  (e: 'error', error: unknown): void
}>()

const { t } = useI18n()
const copied = ref(false)
let timer: ReturnType<typeof setTimeout> | undefined

const copy = async () => {
  if (!props.copyText) return
  try {
    await navigator.clipboard.writeText(props.copyText)
    copied.value = true
    clearTimeout(timer)
    timer = setTimeout(() => {
      copied.value = false
    }, props.successDuration)
    if (props.showToast) {
      notifyRenderer({
        kind: 'success',
        code: 'common.copy.succeeded',
        title: t('common.copied')
      })
    }
    emit('copied')
  } catch (error) {
    console.error('[DcCopyButton] Failed to copy', error)
    emit('error', error)
    if (props.showToast) {
      notifyRenderer({
        kind: 'error',
        code: 'common.copy.failed',
        title: t('common.copyFailed')
      })
    }
  }
}

onUnmounted(() => clearTimeout(timer))

const icon = computed(() => (copied.value ? 'lucide:check' : 'lucide:copy'))
const accessibleName = computed(() => props.label ?? props.tooltip)
</script>

<template>
  <TooltipProvider
    v-if="tooltip"
    :delay-duration="tooltipDelayDuration"
    :ignore-non-keyboard-focus="tooltipIgnoreNonKeyboardFocus"
  >
    <Tooltip :delay-duration="tooltipDelayDuration">
      <TooltipTrigger as-child>
        <DcButton
          v-bind="$attrs"
          :variant="variant"
          :size="size"
          :icon="icon"
          :icon-size="iconSize"
          :disabled="disabled"
          :label="accessibleName"
          :class="cn('shrink-0', copied && 'text-emerald-600 dark:text-emerald-400', props.class)"
          @click="copy"
        >
          <slot>{{ label }}</slot>
        </DcButton>
      </TooltipTrigger>
      <TooltipContent
        :side="tooltipSide"
        :side-offset="tooltipSideOffset"
        :class="tooltipContentClass"
      >
        {{ tooltip }}
      </TooltipContent>
    </Tooltip>
  </TooltipProvider>
  <DcButton
    v-else
    v-bind="$attrs"
    :variant="variant"
    :size="size"
    :icon="icon"
    :icon-size="iconSize"
    :disabled="disabled"
    :label="accessibleName"
    :class="cn('shrink-0', copied && 'text-emerald-600 dark:text-emerald-400', props.class)"
    @click="copy"
  >
    <slot>{{ label }}</slot>
  </DcButton>
</template>
