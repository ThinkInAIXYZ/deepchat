<template>
  <div
    data-testid="guard-stop-banner"
    class="flex flex-col items-start gap-2 rounded-lg border bg-card px-3 py-2 text-sm text-card-foreground"
  >
    <p class="text-muted-foreground">{{ reasonText }}</p>
    <DcButton
      v-if="showContinue"
      data-testid="guard-stop-continue"
      size="sm"
      :disabled="disabled"
      @click="emit('continue')"
    >
      {{ t('components.messageBlockAction.continue') }}
    </DcButton>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { DcButton } from '@dc-ui/components/button'
import type { GuardRunStopReason } from '@shared/lib/runStopReason'

const props = defineProps<{
  stopReason: GuardRunStopReason
  isReadOnly?: boolean
  disabled?: boolean
  allowContinue?: boolean
}>()

const emit = defineEmits<{
  continue: []
}>()

const { t } = useI18n()
const showContinue = computed(() => props.allowContinue !== false && props.isReadOnly !== true)
const reasonText = computed(() => {
  if (props.stopReason === 'max_tool_calls') return t('chat.guardStop.maxToolCalls')
  if (props.stopReason === 'no_progress') return t('chat.guardStop.noProgress')
  return t('chat.guardStop.maxTurns')
})
</script>
