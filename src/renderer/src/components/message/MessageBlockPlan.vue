<template>
  <div class="w-full max-w-2xl rounded-lg border bg-card p-3 text-card-foreground">
    <div class="flex items-center gap-2">
      <Icon icon="lucide:list-checks" class="h-4 w-4 text-primary" />
      <span class="text-sm font-medium">{{ t('chat.workspace.plan.section') }}</span>
      <span class="text-xs text-muted-foreground">
        {{ completedCount }}/{{ totalCount }} {{ t('chat.workspace.plan.status.completed') }}
      </span>
    </div>

    <div v-if="totalCount > 0" class="mt-2 h-1.5 w-full rounded-full bg-muted">
      <div
        class="h-1.5 rounded-full bg-primary transition-all duration-300"
        :style="{ width: `${progressPercent}%` }"
      />
    </div>

    <p
      v-if="explanation"
      class="mt-3 border-l-2 border-primary/30 pl-3 text-xs leading-5 text-muted-foreground"
    >
      {{ explanation }}
    </p>

    <div v-if="entries.length > 0" class="mt-3 space-y-2">
      <div
        v-for="(entry, index) in entries"
        :key="`${entry.status}-${index}-${entry.label}`"
        class="grid grid-cols-[1rem_minmax(0,1fr)] gap-2 text-sm leading-5"
        :class="entry.status === 'completed' ? 'text-muted-foreground' : 'text-foreground'"
        :aria-label="getEntryAriaLabel(entry)"
      >
        <Icon
          :icon="getStatusIcon(entry.status)"
          class="mt-0.5 h-4 w-4 shrink-0"
          :class="getStatusIconClass(entry.status)"
          aria-hidden="true"
        />
        <span class="min-w-0 whitespace-pre-wrap break-words">
          {{ entry.label }}
        </span>
      </div>
    </div>

    <div
      v-else
      class="mt-3 rounded-md border border-dashed px-3 py-3 text-xs text-muted-foreground"
    >
      {{ t('chat.workspace.plan.empty') }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Icon } from '@iconify/vue'
import { useI18n } from 'vue-i18n'
import type { AgentPlanStepStatus } from '@shared/types/agent-plan'
import type { DisplayAssistantMessageBlock } from '@/components/chat/messageListItems'

type NormalizedPlanEntry = {
  label: string
  status: AgentPlanStepStatus
}

const props = defineProps<{
  block: DisplayAssistantMessageBlock
}>()

const { t } = useI18n()

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const normalizeStatus = (value: unknown): AgentPlanStepStatus => {
  if (value === 'completed' || value === 'done') {
    return 'completed'
  }
  if (value === 'in_progress') {
    return 'in_progress'
  }
  return 'pending'
}

const entries = computed<NormalizedPlanEntry[]>(() => {
  const rawEntries = props.block.extra?.plan_entries
  if (!Array.isArray(rawEntries)) {
    return []
  }

  return rawEntries
    .map((entry) => {
      if (!isRecord(entry)) {
        return null
      }

      const rawLabel = typeof entry.step === 'string' ? entry.step : entry.content
      const label = typeof rawLabel === 'string' ? rawLabel.trim() : ''
      if (!label) {
        return null
      }

      return {
        label,
        status: normalizeStatus(entry.status)
      }
    })
    .filter((entry): entry is NormalizedPlanEntry => entry !== null)
})

const explanation = computed(() => {
  const value = props.block.extra?.plan_explanation
  if (typeof value === 'string' && value.trim()) {
    return value.trim()
  }

  return props.block.content?.trim() ?? ''
})

const totalCount = computed(() => entries.value.length)

const completedCount = computed(
  () => entries.value.filter((entry) => entry.status === 'completed').length
)

const progressPercent = computed(() => {
  if (totalCount.value === 0) return 0
  return Math.round((completedCount.value / totalCount.value) * 100)
})

const getStatusIcon = (status: AgentPlanStepStatus): string => {
  if (status === 'completed') return 'lucide:circle-check'
  if (status === 'in_progress') return 'lucide:loader-circle'
  return 'lucide:circle'
}

const getStatusIconClass = (status: AgentPlanStepStatus): string => {
  if (status === 'completed') return 'text-muted-foreground'
  if (status === 'in_progress') return 'animate-spin text-primary'
  return 'text-muted-foreground/80'
}

const getEntryAriaLabel = (entry: NormalizedPlanEntry): string =>
  t('chat.workspace.plan.itemAriaLabel', {
    status: t(`chat.workspace.plan.status.${entry.status}`),
    step: entry.label
  })
</script>
