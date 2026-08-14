<template>
  <!-- The bar comes first in DOM (flex-col-reverse keeps it visually below the
       panel) so Tab moves forward from a chip into the panel it just opened. -->
  <div class="flex w-full flex-col-reverse items-center gap-2" data-testid="agent-interaction-dock">
    <div
      v-if="hasDockChips"
      class="interaction-dock-bar pointer-events-auto flex h-10 w-full max-w-2xl shrink-0 items-center gap-1.5 rounded-full px-2"
      data-testid="agent-interaction-dock-bar"
    >
      <button
        v-if="planChipVisible"
        ref="planChipRef"
        type="button"
        class="interaction-dock-chip"
        aria-expanded="false"
        aria-controls="agent-interaction-dock-panel"
        data-testid="agent-interaction-dock-plan-chip"
        @click="expandPlan"
      >
        <span class="flex h-5 w-5 shrink-0 items-center justify-center">
          <Icon
            icon="lucide:chevron-right"
            class="interaction-dock-chip__caret h-3.5 w-3.5"
            aria-hidden="true"
          />
        </span>
        <span class="flex h-5 w-5 shrink-0 items-center justify-center text-primary">
          <Icon icon="lucide:list-checks" class="h-3.5 w-3.5" aria-hidden="true" />
        </span>
        <span class="truncate text-xs font-medium">{{ t('chat.workspace.plan.section') }}</span>
        <span class="interaction-dock-chip__badge">{{ planBadgeText }}</span>
      </button>

      <button
        v-if="questionChipVisible"
        ref="questionChipRef"
        type="button"
        class="interaction-dock-chip"
        aria-expanded="false"
        aria-controls="agent-interaction-dock-panel"
        data-testid="agent-interaction-dock-question-chip"
        @click="expandQuestion"
      >
        <span class="flex h-5 w-5 shrink-0 items-center justify-center">
          <Icon
            icon="lucide:chevron-right"
            class="interaction-dock-chip__caret h-3.5 w-3.5"
            aria-hidden="true"
          />
        </span>
        <span class="flex h-5 w-5 shrink-0 items-center justify-center text-primary">
          <Icon :icon="questionChipIcon" class="h-3.5 w-3.5" aria-hidden="true" />
        </span>
        <span class="truncate text-xs font-medium">{{ questionChipText }}</span>
        <span class="interaction-dock-chip__pulse" aria-hidden="true" />
      </button>
    </div>

    <Transition name="interaction-dock-panel">
      <div
        v-if="expandedPanel"
        id="agent-interaction-dock-panel"
        class="interaction-dock-panel pointer-events-auto w-full max-w-2xl rounded-xl text-foreground"
        data-testid="agent-interaction-dock-panel"
      >
        <div class="interaction-dock-panel__backdrop" aria-hidden="true" />

        <!-- Header mirrors the chip slot grid (chevron slot, icon slot, label) so
             collapsing swaps the panel for a chip in the same columns. -->
        <div class="flex items-center gap-1.5 px-2 pb-1 pt-2">
          <button
            ref="panelHeaderRef"
            type="button"
            class="interaction-dock-chip min-w-0 flex-1"
            aria-expanded="true"
            aria-controls="agent-interaction-dock-panel"
            data-testid="agent-interaction-dock-panel-header"
            @click="collapseExpandedPanel"
          >
            <span class="flex h-5 w-5 shrink-0 items-center justify-center">
              <Icon
                icon="lucide:chevron-right"
                class="interaction-dock-chip__caret h-3.5 w-3.5 rotate-90"
                aria-hidden="true"
              />
            </span>
            <span class="flex h-5 w-5 shrink-0 items-center justify-center text-primary">
              <Icon :icon="panelIcon" class="h-3.5 w-3.5" aria-hidden="true" />
            </span>
            <span class="truncate text-xs font-medium">{{ panelTitle }}</span>
            <span v-if="expandedPanel === 'plan'" class="interaction-dock-chip__badge">
              {{ planBadgeText }}
            </span>
            <span
              v-if="expandedPanel === 'plan' && planExplanation"
              class="min-w-0 truncate text-xs text-muted-foreground"
            >
              {{ planExplanation }}
            </span>
          </button>
          <button
            v-if="expandedPanel === 'plan'"
            type="button"
            class="interaction-dock-panel__action inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground"
            :aria-label="t('common.close')"
            @click="emit('dismiss-plan')"
          >
            <Icon icon="lucide:x" class="h-3 w-3" />
          </button>
        </div>

        <div class="interaction-dock-panel__body dc-overscroll-contain border-t border-border/60">
          <AgentProgressFloat
            v-if="expandedPanel === 'plan'"
            :snapshot="planSnapshot"
            :collapsed="false"
            :embedded="true"
          />
          <ChatToolInteractionOverlay
            v-else-if="interaction"
            :embedded="true"
            :interaction="interaction"
            :processing="processing"
            @respond="emit('respond', $event)"
          />
        </div>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { Icon } from '@iconify/vue'
import { useI18n } from 'vue-i18n'
import type { ToolInteractionResponse } from '@shared/types/agent-interface'
import type { AgentPlanViewSnapshot } from '@/stores/ui/agentPlan'
import type { DisplayAssistantMessageBlock } from '@/features/chat-page/model/displayMessage'
import AgentProgressFloat from '@/components/chat/AgentProgressFloat.vue'
import ChatToolInteractionOverlay from '@/components/chat/ChatToolInteractionOverlay.vue'

type PendingInteractionView = {
  sessionId: string
  messageId: string
  toolCallId: string
  actionType: 'question_request' | 'tool_call_permission'
  toolName: string
  toolArgs: string
  block: DisplayAssistantMessageBlock
}

const props = defineProps<{
  planSnapshot: AgentPlanViewSnapshot | null
  planCollapsed: boolean
  interaction: PendingInteractionView | null
  processing?: boolean
}>()

const emit = defineEmits<{
  'set-plan-collapsed': [collapsed: boolean]
  'dismiss-plan': []
  respond: [response: ToolInteractionResponse]
}>()

const { t } = useI18n()

const hasPlan = computed(() => Boolean(props.planSnapshot))

// Question expansion is transient per interaction, so it lives here instead of
// a persisted store: every new interaction re-derives its default state below.
const questionExpanded = ref(false)

// At most one panel is open; plan wins if both flags briefly overlap so the
// panel area never stacks the two surfaces again.
const expandedPanel = computed<'plan' | 'question' | null>(() => {
  if (hasPlan.value && !props.planCollapsed) return 'plan'
  if (props.interaction && questionExpanded.value) return 'question'
  return null
})

// An expanded surface leaves the bar: its chip would duplicate the panel
// header directly above. With nothing docked the bar disappears entirely.
const planChipVisible = computed(() => hasPlan.value && expandedPanel.value !== 'plan')
const questionChipVisible = computed(
  () => Boolean(props.interaction) && expandedPanel.value !== 'question'
)
const hasDockChips = computed(() => planChipVisible.value || questionChipVisible.value)

const interactionKey = computed(() =>
  props.interaction
    ? `${props.interaction.sessionId}:${props.interaction.messageId}:${props.interaction.toolCallId}`
    : null
)

const collapsePlanIfExpanded = () => {
  if (hasPlan.value && !props.planCollapsed) {
    emit('set-plan-collapsed', true)
  }
}

// A pending question blocks the turn until the user responds, so it always
// opens expanded by default; an expanded plan yields to it.
watch(
  interactionKey,
  (key) => {
    if (!key) {
      questionExpanded.value = false
      return
    }
    questionExpanded.value = true
    collapsePlanIfExpanded()
  },
  { immediate: true }
)

// A plan arriving while the question is open stays docked instead of
// hijacking the panel (expandedPanel prefers the plan when both are open).
// A plan leaving re-expands a pending question so the blocking interaction
// never sits collapsed with nothing else on screen.
watch(hasPlan, (now, before) => {
  if (now && !before && questionExpanded.value) {
    collapsePlanIfExpanded()
  }
  if (!now && before && props.interaction) {
    questionExpanded.value = true
  }
})

// Expanding/collapsing unmounts the previously focused control, so move focus
// to its replacement explicitly instead of letting it fall to the document.
const panelHeaderRef = ref<HTMLButtonElement | null>(null)
const planChipRef = ref<HTMLButtonElement | null>(null)
const questionChipRef = ref<HTMLButtonElement | null>(null)

const focusSoon = (target: () => HTMLButtonElement | null) => {
  void nextTick(() => target()?.focus())
}

const expandPlan = () => {
  questionExpanded.value = false
  emit('set-plan-collapsed', false)
  focusSoon(() => panelHeaderRef.value)
}

const expandQuestion = () => {
  questionExpanded.value = true
  collapsePlanIfExpanded()
  focusSoon(() => panelHeaderRef.value)
}

const collapseExpandedPanel = () => {
  if (expandedPanel.value === 'plan') {
    emit('set-plan-collapsed', true)
    focusSoon(() => planChipRef.value)
    return
  }
  questionExpanded.value = false
  focusSoon(() => questionChipRef.value)
}

const planEntries = computed(() =>
  (props.planSnapshot?.plan ?? []).filter((entry) => entry.step.trim().length > 0)
)

const planCompletedCount = computed(
  () => planEntries.value.filter((entry) => entry.status === 'completed').length
)

const planBadgeText = computed(() =>
  t('chat.workspace.plan.completedCount', {
    completed: planCompletedCount.value,
    total: planEntries.value.length
  })
)

const planExplanation = computed(() => props.planSnapshot?.explanation ?? '')

const isQuestion = computed(() => props.interaction?.actionType === 'question_request')

const questionChipIcon = computed(() =>
  isQuestion.value ? 'lucide:message-circle-question' : 'lucide:shield'
)

const questionChipText = computed(() => {
  if (!props.interaction) return ''
  if (!isQuestion.value) {
    return t('components.messageBlockPermissionRequest.title')
  }
  const raw = props.interaction.block.extra?.questionHeader
  if (typeof raw === 'string' && raw.trim()) {
    return raw.includes('.') ? t(raw) : raw
  }
  return t('components.messageBlockQuestionRequest.title')
})

const panelIcon = computed(() =>
  expandedPanel.value === 'plan' ? 'lucide:list-checks' : questionChipIcon.value
)

const panelTitle = computed(() =>
  expandedPanel.value === 'plan' ? t('chat.workspace.plan.section') : questionChipText.value
)
</script>

<style scoped>
.interaction-dock-bar {
  isolation: isolate;
  border: 1px solid color-mix(in srgb, white 16%, hsl(var(--border)) 84%);
  backdrop-filter: blur(var(--dc-blur-overlay));
  -webkit-backdrop-filter: blur(var(--dc-blur-overlay));
  background: linear-gradient(
    180deg,
    color-mix(in srgb, white 90%, hsl(var(--background)) 10%) 0%,
    color-mix(in srgb, white 78%, hsl(var(--background)) 22%) 100%
  );
  box-shadow:
    0 10px 24px -8px rgb(15 23 42 / 0.14),
    0 3px 8px -3px rgb(15 23 42 / 0.1),
    inset 0 1px 0 rgb(255 255 255 / 0.45);
}

.dark .interaction-dock-bar {
  border-color: color-mix(in srgb, white 12%, hsl(var(--border)) 88%);
  background: linear-gradient(
    180deg,
    color-mix(in srgb, hsl(var(--background)) 86%, rgb(51 65 85) 14%) 0%,
    color-mix(in srgb, hsl(var(--background)) 94%, rgb(15 23 42) 6%) 100%
  );
  box-shadow:
    0 12px 28px -10px rgb(0 0 0 / 0.55),
    0 4px 10px -4px rgb(0 0 0 / 0.35),
    inset 0 1px 0 rgb(255 255 255 / 0.1);
}

.interaction-dock-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  height: 1.75rem;
  min-width: 0;
  padding: 0 0.625rem;
  border-radius: 9999px;
  color: hsl(var(--foreground));
  transition:
    background-color var(--dc-motion-fast) var(--dc-ease-out-soft),
    transform var(--dc-motion-fast) var(--dc-ease-out-soft);
}

.interaction-dock-chip:hover {
  background: color-mix(in srgb, hsl(var(--foreground)) 6%, transparent);
}

.interaction-dock-chip:active {
  transform: translateY(1px);
}

.interaction-dock-chip:focus-visible {
  outline: none;
  box-shadow: 0 0 0 1px color-mix(in srgb, hsl(var(--primary)) 32%, transparent);
}

.interaction-dock-chip__caret {
  color: hsl(var(--muted-foreground));
  transition: transform var(--dc-motion-fast) var(--dc-ease-out-soft);
}

.interaction-dock-chip__badge {
  flex-shrink: 0;
  border: 1px solid color-mix(in srgb, white 22%, hsl(var(--border)) 78%);
  border-radius: 9999px;
  padding: 0.0625rem 0.375rem;
  font-size: 10px;
  font-weight: 500;
  color: hsl(var(--muted-foreground));
  background: color-mix(in srgb, hsl(var(--background)) 70%, transparent);
}

.interaction-dock-chip__pulse {
  position: relative;
  flex-shrink: 0;
  width: 0.375rem;
  height: 0.375rem;
  border-radius: 9999px;
  background: hsl(var(--primary));
}

.interaction-dock-chip__pulse::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background: inherit;
  animation: interaction-dock-pulse 1.6s var(--dc-ease-out-soft) infinite;
}

@keyframes interaction-dock-pulse {
  0% {
    transform: scale(1);
    opacity: 0.7;
  }
  70%,
  100% {
    transform: scale(2.4);
    opacity: 0;
  }
}

.interaction-dock-panel {
  isolation: isolate;
  position: relative;
  border: 1px solid transparent;
  overflow: hidden;
  backdrop-filter: blur(var(--dc-blur-overlay));
  -webkit-backdrop-filter: blur(var(--dc-blur-overlay));
  background: linear-gradient(
    180deg,
    color-mix(in srgb, white 92%, hsl(var(--background)) 8%) 0%,
    color-mix(in srgb, white 84%, hsl(var(--background)) 16%) 100%
  );
  box-shadow:
    0 24px 48px -12px rgb(15 23 42 / 0.16),
    0 8px 20px -8px rgb(15 23 42 / 0.1),
    0 2px 6px -2px rgb(15 23 42 / 0.08),
    inset 0 1px 0 rgb(255 255 255 / 0.5);
}

/* Scrolling lives on the body so the header and the inset border/highlight
   pseudo layers stay pinned while long content scrolls. */
.interaction-dock-panel__body {
  max-height: min(60vh, calc(100vh - 14rem));
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
}

.interaction-dock-panel::before {
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
      color-mix(in srgb, white 92%, hsl(var(--background)) 8%) 0%,
      color-mix(in srgb, white 72%, hsl(var(--muted)) 28%) 100%
    );
  opacity: 0.92;
}

.interaction-dock-panel::after {
  content: '';
  position: absolute;
  inset: 0;
  z-index: 2;
  border-radius: inherit;
  pointer-events: none;
  box-shadow:
    inset 0 0 0 1px color-mix(in srgb, white 10%, hsl(var(--border)) 90%),
    inset 0 1px 0 rgb(255 255 255 / 0.3);
}

.interaction-dock-panel > :not(.interaction-dock-panel__backdrop) {
  position: relative;
  z-index: 3;
}

.interaction-dock-panel__backdrop {
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
  opacity: 0.7;
  pointer-events: none;
}

.interaction-dock-panel__action:hover {
  background: color-mix(in srgb, white 54%, hsl(var(--accent)) 46%);
  color: hsl(var(--foreground));
}

.dark .interaction-dock-panel__action:hover {
  background: color-mix(in srgb, hsl(var(--background)) 70%, hsl(var(--accent)) 30%);
}

.interaction-dock-panel__action:focus-visible {
  outline: none;
  box-shadow: 0 0 0 1px color-mix(in srgb, hsl(var(--primary)) 32%, transparent);
}

.dark .interaction-dock-panel {
  border-color: transparent;
  background: linear-gradient(
    180deg,
    color-mix(in srgb, hsl(var(--background)) 86%, rgb(51 65 85) 14%) 0%,
    color-mix(in srgb, hsl(var(--background)) 94%, rgb(15 23 42) 6%) 100%
  );
  box-shadow:
    0 24px 48px -12px rgb(0 0 0 / 0.6),
    0 10px 24px -10px rgb(0 0 0 / 0.4),
    0 2px 6px -2px rgb(0 0 0 / 0.3),
    inset 0 1px 0 rgb(255 255 255 / 0.08);
}

.dark .interaction-dock-panel::before {
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
  opacity: 0.94;
}

.dark .interaction-dock-panel::after {
  box-shadow:
    inset 0 0 0 1px color-mix(in srgb, white 14%, hsl(var(--border)) 86%),
    inset 0 1px 0 rgb(255 255 255 / 0.1);
}

.dark .interaction-dock-panel__backdrop {
  background:
    radial-gradient(
      circle at 14% 16%,
      color-mix(in srgb, hsl(var(--primary)) 30%, white 70%) 0%,
      transparent 34%
    ),
    radial-gradient(circle at 88% 14%, rgb(255 255 255 / 0.12) 0%, transparent 24%),
    radial-gradient(circle at 78% 100%, rgb(15 23 42 / 0.42) 0%, transparent 42%);
  filter: saturate(1.08);
  opacity: 0.6;
}

.interaction-dock-panel-enter-active,
.interaction-dock-panel-leave-active {
  transition:
    opacity var(--dc-motion-fast) var(--dc-ease-out-soft),
    transform var(--dc-motion-default) var(--dc-ease-out-express);
}

.interaction-dock-panel-enter-from,
.interaction-dock-panel-leave-to {
  opacity: 0;
  transform: translateY(6px);
}

@media (prefers-reduced-motion: reduce) {
  .interaction-dock-panel-enter-active,
  .interaction-dock-panel-leave-active {
    transition: none;
  }

  .interaction-dock-chip__pulse::after {
    animation: none;
  }
}
</style>
