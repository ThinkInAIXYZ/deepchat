<template>
  <div
    v-if="snapshot && entries.length > 0"
    :class="[
      'pointer-events-auto relative w-full overflow-hidden text-foreground',
      props.embedded
        ? ''
        : 'agent-progress-float ml-auto max-w-[25rem] rounded-[20px] border border-transparent bg-transparent backdrop-blur-[26px]'
    ]"
    data-testid="agent-progress-float"
  >
    <div v-if="!props.embedded" class="agent-progress-float__backdrop" aria-hidden="true" />

    <div class="relative flex items-center gap-1.5 px-3 pb-2.5 pt-2.5">
      <button
        type="button"
        class="agent-progress-trigger group flex min-w-0 flex-1 items-center gap-2.5 rounded-2xl px-2 py-1.5 text-left transition-all duration-200 hover:bg-foreground/[0.035] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/50"
        data-testid="agent-progress-float-trigger"
        :aria-expanded="!collapsed"
        :aria-controls="panelId"
        :aria-label="t('chat.workspace.plan.section')"
        @click="emit('toggle-collapse')"
      >
        <span
          class="flex h-8.5 w-8.5 shrink-0 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10 text-primary shadow-inner shadow-primary/10 transition-transform duration-200 group-hover:scale-[0.98] dark:border-primary/25 dark:bg-primary/15"
        >
          <Icon icon="lucide:list-checks" class="h-4 w-4" />
        </span>

        <span class="min-w-0 flex-1">
          <span class="flex min-w-0 items-center gap-1.5">
            <span class="min-w-0 truncate text-[13px] font-semibold tracking-[0.01em]">
              {{ t('chat.workspace.plan.section') }}
            </span>
            <span
              class="shrink-0 rounded-full border border-border/70 bg-background/70 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground dark:bg-background/60"
            >
              {{
                t('chat.workspace.plan.completedCount', {
                  completed: completedCount,
                  total: entries.length
                })
              }}
            </span>
          </span>

          <span
            v-if="snapshot.explanation"
            class="agent-progress-summary mt-0.5 block text-sm leading-4 text-muted-foreground"
          >
            {{ snapshot.explanation }}
          </span>
        </span>
      </button>

      <div class="flex shrink-0 items-center gap-1">
        <button
          type="button"
          class="agent-progress-action inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground"
          :aria-label="t('common.close')"
          @click="emit('dismiss')"
        >
          <Icon icon="lucide:x" class="h-3 w-3" />
        </button>
      </div>
    </div>

    <Transition name="agent-progress-panel">
      <div
        :id="panelId"
        v-show="!collapsed"
        class="agent-progress-panel relative border-t border-border/60 px-3 pb-3 pt-2.5"
        data-testid="agent-progress-float-body"
        role="status"
        aria-live="polite"
      >
        <div class="space-y-2">
          <div
            v-for="(entry, index) in entries"
            :key="`${entry.status}-${index}-${entry.step}`"
            class="agent-progress-item flex items-center gap-2.5 rounded-2xl px-2.5 py-1 text-[13px] leading-5"
            :class="resolveStepPresentation(entry.status, { terminal: isTerminal }).textClass"
            :aria-label="getEntryAriaLabel(entry)"
          >
            <span
              class="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border"
              :class="resolveStepPresentation(entry.status, { terminal: isTerminal }).badgeClass"
            >
              <Icon
                :icon="resolveStepPresentation(entry.status, { terminal: isTerminal }).icon"
                class="h-3 w-3 shrink-0"
                :class="resolveStepPresentation(entry.status, { terminal: isTerminal }).iconClass"
                aria-hidden="true"
              />
            </span>
            <span class="min-w-0 flex-1 whitespace-pre-wrap break-words">{{ entry.step }}</span>
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
import type { AgentPlanItem } from '@shared/types/agent-plan'
import type { AgentPlanViewSnapshot } from '@/stores/ui/agentPlan'
import { entryAriaLabel, resolveStepPresentation } from '@/composables/useAgentPlanStatus'

const props = defineProps<{
  snapshot: AgentPlanViewSnapshot | null
  collapsed: boolean
  embedded?: boolean
}>()

const emit = defineEmits<{
  'toggle-collapse': []
  dismiss: []
}>()

const { t } = useI18n()

const entries = computed<AgentPlanItem[]>(() =>
  (props.snapshot?.plan ?? []).filter((entry) => entry.step.trim().length > 0)
)

const completedCount = computed(
  () => entries.value.filter((entry) => entry.status === 'completed').length
)

const isTerminal = computed(() => Boolean(props.snapshot?.terminalReason))
const panelId = computed(() => `agent-progress-panel-${props.snapshot?.messageId ?? 'current'}`)

const getEntryAriaLabel = (entry: AgentPlanItem): string =>
  entryAriaLabel(t, entry, { terminal: isTerminal.value })
</script>

<style scoped>
.agent-progress-float {
  isolation: isolate;
  border-color: transparent;
  background: linear-gradient(
    180deg,
    color-mix(in srgb, white 78%, hsl(var(--background)) 22%) 0%,
    color-mix(in srgb, white 58%, hsl(var(--background)) 42%) 100%
  );
  box-shadow:
    0 20px 40px -30px rgb(15 23 42 / 0.2),
    0 8px 18px -18px rgb(15 23 42 / 0.08),
    inset 0 1px 0 rgb(255 255 255 / 0.42),
    inset 0 -10px 20px -18px rgb(148 163 184 / 0.18);
}

.agent-progress-float::before {
  content: '';
  position: absolute;
  inset: 1px;
  z-index: 0;
  border-radius: inherit;
  pointer-events: none;
  background:
    linear-gradient(
      160deg,
      rgb(255 255 255 / 0.58) 0%,
      transparent 36%,
      rgb(255 255 255 / 0.12) 100%
    ),
    linear-gradient(
      180deg,
      color-mix(in srgb, white 88%, hsl(var(--background)) 12%) 0%,
      color-mix(in srgb, white 64%, hsl(var(--muted)) 36%) 100%
    );
  opacity: 0.92;
}

.agent-progress-float::after {
  content: '';
  position: absolute;
  inset: 0;
  z-index: 2;
  border-radius: inherit;
  pointer-events: none;
  box-shadow:
    inset 0 0 0 1px color-mix(in srgb, white 22%, hsl(var(--border)) 78%),
    inset 0 1px 0 rgb(255 255 255 / 0.24);
  opacity: 0.82;
}

.agent-progress-float > :not(.agent-progress-float__backdrop) {
  position: relative;
  z-index: 3;
}

.agent-progress-float__backdrop {
  position: absolute;
  inset: 0;
  z-index: 0;
  background:
    radial-gradient(
      circle at 12% 14%,
      color-mix(in srgb, white 78%, hsl(var(--primary)) 22%) 0%,
      transparent 34%
    ),
    radial-gradient(circle at 88% 12%, rgb(255 255 255 / 0.62) 0%, transparent 26%),
    radial-gradient(
      circle at 72% 100%,
      color-mix(in srgb, white 44%, hsl(var(--muted)) 56%) 0%,
      transparent 42%
    );
  filter: saturate(1.06);
  opacity: 0.92;
  pointer-events: none;
}

.dark .agent-progress-float {
  border-color: transparent;
  background: linear-gradient(
    180deg,
    color-mix(in srgb, hsl(var(--background)) 88%, rgb(51 65 85) 12%) 0%,
    color-mix(in srgb, hsl(var(--background)) 94%, rgb(15 23 42) 6%) 100%
  );
  box-shadow:
    0 24px 48px -34px rgb(0 0 0 / 0.48),
    0 12px 24px -22px rgb(0 0 0 / 0.26),
    inset 0 1px 0 rgb(255 255 255 / 0.08),
    inset 0 -14px 24px -22px rgb(0 0 0 / 0.36);
}

.dark .agent-progress-float::before {
  background:
    linear-gradient(
      160deg,
      rgb(255 255 255 / 0.12) 0%,
      transparent 40%,
      rgb(255 255 255 / 0.03) 100%
    ),
    linear-gradient(
      180deg,
      color-mix(in srgb, hsl(var(--background)) 82%, rgb(30 41 59) 18%) 0%,
      color-mix(in srgb, hsl(var(--background)) 92%, rgb(2 6 23) 8%) 100%
    );
  opacity: 0.88;
}

.dark .agent-progress-float::after {
  box-shadow:
    inset 0 0 0 1px color-mix(in srgb, white 8%, hsl(var(--border)) 92%),
    inset 0 1px 0 rgb(255 255 255 / 0.08);
  opacity: 0.74;
}

.dark .agent-progress-float__backdrop {
  background:
    radial-gradient(
      circle at 14% 16%,
      color-mix(in srgb, hsl(var(--primary)) 30%, white 70%) 0%,
      transparent 34%
    ),
    radial-gradient(circle at 88% 14%, rgb(255 255 255 / 0.12) 0%, transparent 24%),
    radial-gradient(circle at 78% 100%, rgb(15 23 42 / 0.42) 0%, transparent 42%);
  filter: saturate(1.08);
  opacity: 0.84;
}

.agent-progress-summary {
  display: -webkit-box;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 1;
}

.agent-progress-action:hover {
  background: color-mix(in srgb, white 54%, hsl(var(--accent)) 46%);
  border-color: color-mix(in srgb, white 34%, hsl(var(--border)) 66%);
  color: hsl(var(--foreground));
}

.dark .agent-progress-action:hover {
  background: color-mix(in srgb, hsl(var(--background)) 70%, hsl(var(--accent)) 30%);
  border-color: color-mix(in srgb, white 12%, hsl(var(--border)) 88%);
}

.agent-progress-action:focus-visible {
  outline: none;
  box-shadow:
    inset 0 1px 0 color-mix(in srgb, hsl(var(--foreground)) 6%, transparent),
    0 0 0 1px color-mix(in srgb, hsl(var(--primary)) 24%, transparent);
}

.agent-progress-action:active,
.agent-progress-trigger:active {
  transform: translateY(1px);
}

.agent-progress-panel {
  max-height: min(24rem, calc(100vh - 18rem));
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
}

.agent-progress-panel-enter-active,
.agent-progress-panel-leave-active {
  transition:
    max-height 220ms ease,
    opacity 160ms ease,
    transform 180ms ease;
}

.agent-progress-panel-enter-from,
.agent-progress-panel-leave-to {
  max-height: 0;
  opacity: 0;
  transform: translateY(-6px);
}
</style>
