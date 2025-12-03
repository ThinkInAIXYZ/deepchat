<template>
  <div class="rounded-lg border bg-card text-card-foreground p-4 space-y-3">
    <!-- Header with title and toggle -->
    <div
      class="flex items-center justify-between cursor-pointer select-none"
      @click="toggleExpanded"
    >
      <div class="flex items-center gap-2">
        <Icon icon="lucide:list-checks" class="w-4 h-4 text-primary" />
        <span class="text-sm font-medium">{{ t('plan.title') }}</span>
        <span class="text-xs text-muted-foreground">
          {{ completedCount }}/{{ totalCount }} {{ t('plan.completed') }}
        </span>
      </div>
      <Icon
        :icon="isExpanded ? 'lucide:chevron-down' : 'lucide:chevron-right'"
        class="w-4 h-4 text-muted-foreground"
      />
    </div>

    <!-- Progress bar -->
    <div v-if="totalCount > 0" class="w-full bg-muted rounded-full h-1.5">
      <div
        class="bg-primary h-1.5 rounded-full transition-all duration-300"
        :style="{ width: `${progressPercent}%` }"
      />
    </div>

    <!-- Plan entries list -->
    <transition
      enter-active-class="transition duration-200 ease-out"
      enter-from-class="opacity-0 -translate-y-2"
      enter-to-class="opacity-100 translate-y-0"
      leave-active-class="transition duration-150 ease-in"
      leave-from-class="opacity-100 translate-y-0"
      leave-to-class="opacity-0 -translate-y-2"
    >
      <div v-show="isExpanded" class="space-y-2">
        <div
          v-for="(entry, index) in planEntries"
          :key="index"
          class="flex items-start gap-2 text-sm"
        >
          <!-- Status icon -->
          <span class="text-base leading-none mt-0.5">{{ getStatusIcon(entry.status) }}</span>

          <!-- Content -->
          <div class="flex-1 min-w-0">
            <span :class="getStatusTextClass(entry.status)">
              {{ entry.content }}
            </span>

            <!-- Priority badge -->
            <span
              v-if="entry.priority"
              class="ml-2 px-1.5 py-0.5 text-xs rounded-md bg-primary/10 text-primary"
            >
              {{ entry.priority }}
            </span>
          </div>
        </div>
      </div>
    </transition>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { Icon } from '@iconify/vue'
import { useI18n } from 'vue-i18n'
import { AssistantMessageBlock } from '@shared/chat'

interface PlanEntry {
  content: string
  priority?: string | null
  status?: string | null
}

const props = defineProps<{
  block: AssistantMessageBlock
}>()

const { t } = useI18n()
const isExpanded = ref(true)

const planEntries = computed<PlanEntry[]>(() => {
  return (props.block.extra?.plan_entries as PlanEntry[]) || []
})

const totalCount = computed(() => planEntries.value.length)

const completedCount = computed(() => {
  return planEntries.value.filter((e) => e.status === 'completed' || e.status === 'done').length
})

const progressPercent = computed(() => {
  if (totalCount.value === 0) return 0
  return Math.round((completedCount.value / totalCount.value) * 100)
})

const toggleExpanded = () => {
  isExpanded.value = !isExpanded.value
}

const getStatusIcon = (status?: string | null): string => {
  switch (status) {
    case 'pending':
      return '○'
    case 'in_progress':
      return '◐'
    case 'completed':
    case 'done':
      return '●'
    case 'skipped':
      return '⊘'
    case 'failed':
      return '✕'
    default:
      return '○'
  }
}

const getStatusTextClass = (status?: string | null): string => {
  switch (status) {
    case 'completed':
    case 'done':
      return 'text-muted-foreground line-through'
    case 'in_progress':
      return 'text-foreground font-medium'
    case 'failed':
      return 'text-destructive'
    case 'skipped':
      return 'text-muted-foreground'
    default:
      return 'text-foreground'
  }
}
</script>
