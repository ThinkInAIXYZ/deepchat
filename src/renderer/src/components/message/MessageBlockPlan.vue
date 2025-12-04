<template>
  <div class="rounded-lg border bg-card text-card-foreground p-3 space-y-2">
    <!-- Header (summary only) -->
    <div class="flex items-center gap-2">
      <Icon icon="lucide:list-checks" class="w-4 h-4 text-primary" />
      <span class="text-sm font-medium">{{ t('plan.title') }}</span>
      <span class="text-xs text-muted-foreground">
        {{ completedCount }}/{{ totalCount }} {{ t('plan.completed') }}
      </span>
    </div>

    <!-- Progress bar -->
    <div v-if="totalCount > 0" class="w-full bg-muted rounded-full h-1.5">
      <div
        class="bg-primary h-1.5 rounded-full transition-all duration-300"
        :style="{ width: `${progressPercent}%` }"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Icon } from '@iconify/vue'
import { useI18n } from 'vue-i18n'
import { AssistantMessageBlock } from '@shared/chat'

const props = defineProps<{
  block: AssistantMessageBlock
}>()

const { t } = useI18n()

const planEntries = computed(() => {
  return (props.block.extra?.plan_entries as Array<{ status?: string | null }>) || []
})

const totalCount = computed(() => planEntries.value.length)

const completedCount = computed(() => {
  return planEntries.value.filter((e) => e.status === 'completed' || e.status === 'done').length
})

const progressPercent = computed(() => {
  if (totalCount.value === 0) return 0
  return Math.round((completedCount.value / totalCount.value) * 100)
})
</script>
