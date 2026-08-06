<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { computed } from 'vue'
import { DcButton } from '@dc-ui/components/button'
import { useDcForm } from './useDcForm'
import type { DcFormSubmitStatus } from './useDcFormSubmit'

interface Props {
  /** 显式状态；缺省时自动读取最近的 <DcForm> 注入 */
  status?: DcFormSubmitStatus
  successIcon?: string
  errorIcon?: string
  successLabel?: string
  errorLabel?: string
  variant?: 'default' | 'outline' | 'secondary' | 'ghost' | 'destructive' | 'link'
  size?: 'default' | 'sm' | 'xs' | 'lg' | 'icon' | 'icon-sm' | 'icon-lg'
  icon?: string
  iconSize?: '3' | '3.5' | '4'
  disabled?: boolean
  class?: HTMLAttributes['class']
}

const props = withDefaults(defineProps<Props>(), {
  successIcon: 'lucide:check',
  errorIcon: 'lucide:circle-alert',
  disabled: false
})

const form = useDcForm()

const status = computed(() => props.status ?? form?.status.value ?? 'idle')
const isSubmitting = computed(() => status.value === 'submitting')
const isSuccess = computed(() => status.value === 'success')
const isError = computed(() => status.value === 'error')

const resolvedIcon = computed(() => {
  if (isSuccess.value) return props.successIcon
  if (isError.value) return props.errorIcon
  return props.icon
})

const resolvedLabel = computed(() => {
  if (isSuccess.value && props.successLabel) return props.successLabel
  if (isError.value && props.errorLabel) return props.errorLabel
  return undefined
})
</script>

<template>
  <DcButton
    type="submit"
    :variant="variant"
    :size="size"
    :icon="resolvedIcon"
    :icon-size="iconSize"
    :loading="isSubmitting"
    :disabled="disabled || isSubmitting"
    :class="props.class"
  >
    {{ resolvedLabel }}
    <slot />
  </DcButton>
</template>
