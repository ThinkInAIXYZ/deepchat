<template>
  <div class="flex w-full flex-col items-center gap-2" data-testid="agent-interaction-dock">
    <Transition name="interaction-dock-panel">
      <div
        v-if="expandedPanel"
        id="agent-interaction-dock-panel"
        class="interaction-dock-panel dc-overscroll-contain pointer-events-auto w-full max-w-2xl rounded-[20px] text-foreground"
        data-testid="agent-interaction-dock-panel"
      >
        <div class="interaction-dock-panel__backdrop" aria-hidden="true" />
        <AgentProgressFloat
          v-if="expandedPanel === 'plan'"
          :snapshot="planSnapshot"
          :collapsed="false"
          :embedded="true"
          @dismiss="emit('dismiss-plan')"
          @toggle-collapse="setPlanExpanded(false)"
        />
        <ChatToolInteractionOverlay
          v-else-if="interaction"
          :embedded="true"
          :interaction="interaction"
          :processing="processing"
          @respond="emit('respond', $event)"
        />
      </div>
    </Transition>

    <div
      class="interaction-dock-bar pointer-events-auto flex h-10 w-full max-w-2xl shrink-0 items-center gap-1.5 rounded-full px-2"
      data-testid="agent-interaction-dock-bar"
    >
      <button
        v-if="hasPlan"
        type="button"
        class="interaction-dock-chip"
        :data-expanded="expandedPanel === 'plan'"
        :aria-expanded="expandedPanel === 'plan'"
        aria-controls="agent-interaction-dock-panel"
        data-testid="agent-interaction-dock-plan-chip"
        @click="onPlanChipClick"
      >
        <Icon
          icon="lucide:chevron-right"
          class="interaction-dock-chip__caret h-3.5 w-3.5 shrink-0"
          :class="expandedPanel === 'plan' ? 'rotate-90' : ''"
          aria-hidden="true"
        />
        <Icon
          icon="lucide:list-checks"
          class="h-3.5 w-3.5 shrink-0 text-primary"
          aria-hidden="true"
        />
        <span class="truncate text-xs font-medium">{{ t('chat.workspace.plan.section') }}</span>
        <span class="interaction-dock-chip__badge">
          {{
            t('chat.workspace.plan.completedCount', {
              completed: planCompletedCount,
              total: planEntries.length
            })
          }}
        </span>
      </button>

      <button
        v-if="interaction"
        type="button"
        class="interaction-dock-chip"
        :data-expanded="expandedPanel === 'question'"
        :aria-expanded="expandedPanel === 'question'"
        aria-controls="agent-interaction-dock-panel"
        data-testid="agent-interaction-dock-question-chip"
        @click="onQuestionChipClick"
      >
        <Icon
          icon="lucide:chevron-right"
          class="interaction-dock-chip__caret h-3.5 w-3.5 shrink-0"
          :class="expandedPanel === 'question' ? 'rotate-90' : ''"
          aria-hidden="true"
        />
        <Icon
          :icon="questionChipIcon"
          class="h-3.5 w-3.5 shrink-0 text-primary"
          aria-hidden="true"
        />
        <span class="truncate text-xs font-medium">{{ questionChipText }}</span>
        <span
          v-if="expandedPanel !== 'question'"
          class="interaction-dock-chip__pulse"
          aria-hidden="true"
        />
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
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

const interactionKey = computed(() =>
  props.interaction
    ? `${props.interaction.sessionId}:${props.interaction.messageId}:${props.interaction.toolCallId}`
    : null
)

const collapseBoth = () => {
  questionExpanded.value = false
  if (hasPlan.value && !props.planCollapsed) {
    emit('set-plan-collapsed', true)
  }
}

// Defaults: a question alone opens immediately; when plan and question are
// active together both start docked so the user picks which one to expand.
watch(
  interactionKey,
  (key) => {
    if (!key) {
      questionExpanded.value = false
      return
    }
    if (hasPlan.value) {
      collapseBoth()
    } else {
      questionExpanded.value = true
    }
  },
  { immediate: true }
)

watch(hasPlan, (now, before) => {
  if (now && !before && interactionKey.value) {
    collapseBoth()
  }
})

const setPlanExpanded = (expanded: boolean) => {
  if (expanded) {
    questionExpanded.value = false
  }
  emit('set-plan-collapsed', !expanded)
}

const onPlanChipClick = () => {
  setPlanExpanded(expandedPanel.value !== 'plan')
}

const onQuestionChipClick = () => {
  if (expandedPanel.value === 'question') {
    questionExpanded.value = false
    return
  }
  questionExpanded.value = true
  if (hasPlan.value && !props.planCollapsed) {
    emit('set-plan-collapsed', true)
  }
}

const planEntries = computed(() =>
  (props.planSnapshot?.plan ?? []).filter((entry) => entry.step.trim().length > 0)
)

const planCompletedCount = computed(
  () => planEntries.value.filter((entry) => entry.status === 'completed').length
)

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
</script>

<style scoped>
.interaction-dock-bar {
  isolation: isolate;
  border: 1px solid color-mix(in srgb, white 26%, hsl(var(--border)) 74%);
  backdrop-filter: blur(var(--dc-blur-overlay));
  -webkit-backdrop-filter: blur(var(--dc-blur-overlay));
  background: linear-gradient(
    180deg,
    color-mix(in srgb, white 80%, hsl(var(--background)) 20%) 0%,
    color-mix(in srgb, white 62%, hsl(var(--background)) 38%) 100%
  );
  box-shadow:
    0 14px 30px -24px rgb(15 23 42 / 0.22),
    inset 0 1px 0 rgb(255 255 255 / 0.42);
}

.dark .interaction-dock-bar {
  border-color: color-mix(in srgb, white 9%, hsl(var(--border)) 91%);
  background: linear-gradient(
    180deg,
    color-mix(in srgb, hsl(var(--background)) 88%, rgb(51 65 85) 12%) 0%,
    color-mix(in srgb, hsl(var(--background)) 94%, rgb(15 23 42) 6%) 100%
  );
  box-shadow:
    0 18px 36px -28px rgb(0 0 0 / 0.5),
    inset 0 1px 0 rgb(255 255 255 / 0.08);
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

.interaction-dock-chip[data-expanded='true'] {
  background: color-mix(in srgb, hsl(var(--primary)) 10%, transparent);
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
  border: 1px solid transparent;
  max-height: min(70vh, calc(100vh - 12rem));
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  backdrop-filter: blur(var(--dc-blur-overlay));
  -webkit-backdrop-filter: blur(var(--dc-blur-overlay));
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
      color-mix(in srgb, white 88%, hsl(var(--background)) 12%) 0%,
      color-mix(in srgb, white 64%, hsl(var(--muted)) 36%) 100%
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
    inset 0 0 0 1px color-mix(in srgb, white 22%, hsl(var(--border)) 78%),
    inset 0 1px 0 rgb(255 255 255 / 0.24);
  opacity: 0.82;
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
  opacity: 0.92;
  pointer-events: none;
}

.dark .interaction-dock-panel {
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
  opacity: 0.88;
}

.dark .interaction-dock-panel::after {
  box-shadow:
    inset 0 0 0 1px color-mix(in srgb, white 8%, hsl(var(--border)) 92%),
    inset 0 1px 0 rgb(255 255 255 / 0.08);
  opacity: 0.74;
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
  opacity: 0.84;
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
