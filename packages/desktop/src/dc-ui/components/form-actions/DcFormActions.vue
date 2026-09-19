<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { DcButton } from '@dc-ui/components/button'
import { DcSubmitButton, useDcForm } from '@dc-ui/components/form'
import type { DcFormSubmitStatus } from '@dc-ui/components/form'
import { cn } from '@shadcn/lib/utils'

interface Props {
  submitStatus?: DcFormSubmitStatus
  cancelLabel?: string
  submitLabel?: string
  submitDisabled?: boolean
  submitIcon?: string
  dangerSubmit?: boolean
  cancelDisabled?: boolean
  submitTestId?: string
  cancelTestId?: string
  class?: string
}

const props = withDefaults(defineProps<Props>(), {
  submitDisabled: false,
  dangerSubmit: false,
  cancelDisabled: false
})

const emit = defineEmits<{
  (e: 'cancel'): void
  (e: 'submit'): void
}>()

const { t } = useI18n()
const form = useDcForm()

const status = computed(() => props.submitStatus ?? form?.status.value ?? 'idle')
</script>

<template>
  <div :class="cn('flex items-center justify-end gap-3', props.class)">
    <slot />
    <DcButton
      type="button"
      variant="outline"
      :disabled="cancelDisabled"
      :data-testid="cancelTestId"
      @click="emit('cancel')"
    >
      {{ cancelLabel ?? t('common.cancel') }}
    </DcButton>
    <DcSubmitButton
      :status="status"
      :variant="dangerSubmit ? 'destructive' : 'default'"
      :icon="submitIcon"
      :disabled="submitDisabled"
      :data-testid="submitTestId"
      @click="emit('submit')"
    >
      {{ submitLabel ?? t('common.confirm') }}
    </DcSubmitButton>
  </div>
</template>
