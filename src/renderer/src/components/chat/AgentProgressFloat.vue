<template>
  <div
    v-if="snapshot && entries.length > 0"
    class="pointer-events-auto w-full max-w-sm overflow-hidden rounded-lg border bg-background/95 shadow-lg backdrop-blur"
    data-testid="agent-progress-float"
  >
    <button
      type="button"
      class="flex w-full items-center gap-2 px-3 py-2 text-left"
      :aria-expanded="String(!collapsed)"
      :aria-label="t('chat.workspace.plan.section')"
      @click="emit('toggle-collapse')"
    >
      <Icon icon="lucide:list-checks" class="h-4 w-4 text-primary" />
      <span class="min-w-0 flex-1 truncate text-sm font-medium">
        {{ t('chat.workspace.plan.section') }}
      </span>
      <span class="shrink-0 text-xs text-muted-foreground">
        {{ completedCount }}/{{ entries.length }}
      </span>
      <Icon
        :icon="collapsed ? 'lucide:chevron-down' : 'lucide:chevron-up'"
        class="h-4 w-4 text-muted-foreground"
      />
    </button>

    <Transition name="agent-progress-panel">
      <div
        v-show="!collapsed"
        class="agent-progress-panel border-t px-3 pb-3 pt-2"
        data-testid="agent-progress-float-body"
      >
        <p v-if="snapshot.explanation" class="mb-2 text-xs leading-5 text-muted-foreground">
          {{ snapshot.explanation }}
        </p>

        <div class="space-y-2">
          <div
            v-for="(entry, index) in entries"
            :key="`${entry.status}-${index}-${entry.step}`"
            class="grid grid-cols-[1rem_minmax(0,1fr)] gap-2 text-sm leading-5"
            :class="entry.status === 'completed' ? 'text-muted-foreground' : 'text-foreground'"
            :aria-label="`[${entry.status}] ${entry.step}`"
          >
            <Icon
              :icon="getStatusIcon(entry.status)"
              class="mt-0.5 h-4 w-4 shrink-0"
              :class="getStatusIconClass(entry.status)"
              aria-hidden="true"
            />
            <span class="min-w-0 whitespace-pre-wrap break-words">{{ entry.step }}</span>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Icon } from '@iconify/vue'
import { useI18n } from 'vue-i18n'
import type { AgentPlanItem, AgentPlanStepStatus } from '@shared/types/agent-plan'
import type { AgentPlanViewSnapshot } from '@/stores/ui/agentPlan'

const props = defineProps<{
  snapshot: AgentPlanViewSnapshot | null
  collapsed: boolean
}>()

const emit = defineEmits<{
  'toggle-collapse': []
}>()

const { t } = useI18n()

const entries = computed<AgentPlanItem[]>(() =>
  (props.snapshot?.plan ?? []).filter((entry) => entry.step.trim().length > 0)
)

const completedCount = computed(
  () => entries.value.filter((entry) => entry.status === 'completed').length
)

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
</script>

<style scoped>
.agent-progress-panel {
  max-height: 22rem;
  overflow: hidden;
}

.agent-progress-panel-enter-active,
.agent-progress-panel-leave-active {
  transition:
    max-height 180ms ease,
    opacity 160ms ease,
    transform 180ms ease;
}

.agent-progress-panel-enter-from,
.agent-progress-panel-leave-to {
  max-height: 0;
  opacity: 0;
  transform: translateY(-4px);
}
</style>
