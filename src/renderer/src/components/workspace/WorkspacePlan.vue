<template>
  <section v-if="store.planEntries.length > 0" class="px-0">
    <button
      class="flex w-full items-center gap-2 px-4 py-2 text-left text-xs text-muted-foreground transition hover:bg-muted/40"
      type="button"
      @click="showPlan = !showPlan"
    >
      <Icon icon="lucide:list-checks" class="h-3.5 w-3.5" />
      <span
        class="flex-1 text-[12px] font-medium tracking-wide text-foreground/80 dark:text-white/80"
      >
        {{ t(sectionKey) }}
      </span>
      <span class="text-[10px] text-muted-foreground">
        {{ store.completedPlanCount }}/{{ store.totalPlanCount }}
      </span>
      <Icon
        :icon="showPlan ? 'lucide:chevron-down' : 'lucide:chevron-up'"
        class="h-3 w-3 text-muted-foreground"
      />
    </button>

    <Transition name="workspace-collapse">
      <div v-if="showPlan" class="space-y-0 overflow-hidden">
        <!-- Progress bar -->
        <div v-if="store.totalPlanCount > 0" class="mx-4 mb-2 h-1.5 rounded-full bg-muted">
          <div
            class="h-1.5 rounded-full bg-primary transition-all duration-300"
            :style="{ width: `${store.planProgress}%` }"
          />
        </div>

        <ul class="m-0 list-none p-0">
          <li
            v-for="entry in store.planEntries"
            :key="entry.id"
            class="flex items-center gap-2 px-4 py-1.5 w-full cursor-default select-none transition-colors"
          >
            <span class="text-base leading-none" aria-hidden="true">{{
              getStatusIcon(entry.status)
            }}</span>
            <span class="text-xs truncate" :class="getStatusTextClass(entry.status)">
              {{ entry.content }}
            </span>
            <span
              v-if="entry.priority"
              class="ml-auto px-1.5 py-0.5 text-[10px] rounded-md bg-primary/10 text-primary"
            >
              {{ entry.priority }}
            </span>
          </li>
        </ul>
      </div>
    </Transition>
  </section>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { Icon } from '@iconify/vue'
import { useI18n } from 'vue-i18n'
import { useWorkspaceStore } from '@/stores/workspace'
import type { WorkspacePlanStatus } from '@shared/presenter'

const { t } = useI18n()
const store = useWorkspaceStore()
const showPlan = ref(true)

const i18nPrefix = computed(() => 'chat.workspace')
const sectionKey = computed(() => `${i18nPrefix.value}.plan.section`)

const getStatusIcon = (status: WorkspacePlanStatus): string => {
  switch (status) {
    case 'pending':
      return '○'
    case 'in_progress':
      return '◐'
    case 'completed':
      return '●'
    case 'skipped':
      return '⊘'
    case 'failed':
      return '✕'
    default:
      return '○'
  }
}

const getStatusTextClass = (status: WorkspacePlanStatus): string => {
  switch (status) {
    case 'completed':
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

<style scoped>
.workspace-collapse-enter-active,
.workspace-collapse-leave-active {
  transition: all 0.18s ease;
}

.workspace-collapse-enter-from,
.workspace-collapse-leave-to {
  opacity: 0;
  transform: translateY(-4px);
  max-height: 0;
}

.workspace-collapse-enter-to,
.workspace-collapse-leave-from {
  opacity: 1;
  transform: translateY(0);
  max-height: 300px;
}
</style>
