<script setup lang="ts">
import { Icon } from '@iconify/vue'
import { computed, onBeforeUnmount, ref, shallowRef } from 'vue'
import { useI18n } from 'vue-i18n'
import type { ObservableNotificationRecord } from './notificationRecord'

const props = defineProps<{
  record: ObservableNotificationRecord
  isPaused?: boolean
  onAction: () => void
  onCloseToast: () => void
}>()

const { t } = useI18n()
const snapshot = shallowRef(props.record.getSnapshot())
const actionPending = ref(false)
const actionFailed = ref(false)
const unsubscribe = props.record.subscribe((next) => {
  snapshot.value = next
  actionFailed.value = false
})

onBeforeUnmount(unsubscribe)

const visualKind = computed(() => {
  if (snapshot.value.kind === 'actionable') return 'actionable'
  return snapshot.value.kind
})

const icon = computed(() => {
  switch (snapshot.value.kind) {
    case 'success':
      return 'lucide:circle-check'
    case 'info':
      return 'lucide:info'
    case 'warning':
      return 'lucide:triangle-alert'
    case 'error':
      return 'lucide:circle-x'
    case 'actionable':
      return 'lucide:circle-alert'
    case 'progress':
      return 'lucide:loader-circle'
  }
})

const progressPercent = computed(() => {
  if (snapshot.value.progress === undefined) return undefined
  return Math.round(snapshot.value.progress * 100)
})

const detail = computed(() => {
  if (actionFailed.value) return t('common.notifications.actionFailed')
  if (snapshot.value.description?.trim()) return snapshot.value.description
  if (progressPercent.value !== undefined) return `${progressPercent.value}%`
  if (snapshot.value.entityCount > 1) {
    return t('common.notifications.entities', { count: snapshot.value.entityCount })
  }
  return '\u00a0'
})

const cappedCount = (count: number) => (count > 99 ? '99+' : String(count))

const occurrenceLabel = computed(() =>
  t('common.notifications.occurrences', { count: snapshot.value.occurrenceCount })
)
const pendingLabel = computed(() =>
  t('common.notifications.pending', { count: snapshot.value.pendingCount })
)

const accessibleLabel = computed(() => {
  const parts = [snapshot.value.title]
  if (detail.value.trim()) parts.push(detail.value)
  if (snapshot.value.occurrenceCount > 1) parts.push(occurrenceLabel.value)
  if (snapshot.value.pendingCount > 0) parts.push(pendingLabel.value)
  return parts.join('. ')
})

const handleAction = async () => {
  const action = snapshot.value.action
  if (!action || actionPending.value) return

  actionPending.value = true
  actionFailed.value = false
  try {
    await action.onClick()
    props.onAction()
    props.onCloseToast()
  } catch (error) {
    actionFailed.value = true
    console.error('[ManagedNotificationToast] action failed', error)
  } finally {
    actionPending.value = false
  }
}
</script>

<template>
  <div
    class="notification-toast"
    :data-kind="visualKind"
    :aria-label="accessibleLabel"
    :role="
      snapshot.kind === 'error' || snapshot.kind === 'warning' || snapshot.kind === 'actionable'
        ? 'alert'
        : 'status'
    "
  >
    <Icon
      :icon="icon"
      class="notification-toast__icon"
      :class="{ 'notification-toast__icon--spinning': snapshot.kind === 'progress' }"
      :style="{ animationPlayState: isPaused ? 'paused' : 'running' }"
      aria-hidden="true"
    />

    <div class="notification-toast__copy">
      <div class="notification-toast__title" :title="snapshot.title">
        {{ snapshot.title }}
      </div>
      <div
        class="notification-toast__detail"
        :class="{ 'notification-toast__detail--error': actionFailed }"
      >
        <span class="notification-toast__detail-text" :title="detail.trim() || undefined">
          {{ detail }}
        </span>
        <span
          v-if="snapshot.occurrenceCount > 1"
          class="notification-toast__count"
          :aria-label="occurrenceLabel"
          :title="occurrenceLabel"
        >
          ×{{ cappedCount(snapshot.occurrenceCount) }}
        </span>
      </div>
    </div>

    <div class="notification-toast__controls">
      <button
        type="button"
        class="notification-toast__close"
        :aria-label="t('common.close')"
        :title="t('common.close')"
        @click="onCloseToast"
      >
        <Icon icon="lucide:x" aria-hidden="true" />
      </button>
      <button
        v-if="snapshot.action"
        type="button"
        class="notification-toast__action"
        :disabled="actionPending"
        :aria-label="snapshot.action.ariaLabel || snapshot.action.label"
        :title="snapshot.action.label"
        @click="handleAction"
      >
        <Icon
          v-if="actionPending"
          icon="lucide:loader-circle"
          class="notification-toast__action-spinner"
          aria-hidden="true"
        />
        <span v-else class="notification-toast__action-label">{{ snapshot.action.label }}</span>
        <span
          v-if="snapshot.pendingCount > 0"
          class="notification-toast__pending"
          :aria-label="pendingLabel"
          :title="pendingLabel"
        >
          +{{ cappedCount(snapshot.pendingCount) }}
        </span>
      </button>
    </div>

    <div
      v-if="snapshot.kind === 'progress'"
      class="notification-toast__progress"
      role="progressbar"
      :aria-valuemin="0"
      :aria-valuemax="100"
      :aria-valuenow="progressPercent"
    >
      <div
        class="notification-toast__progress-value"
        :class="{
          'notification-toast__progress-value--indeterminate': progressPercent === undefined
        }"
        :style="{
          width: progressPercent === undefined ? '40%' : `${progressPercent}%`,
          animationPlayState: isPaused ? 'paused' : 'running'
        }"
      />
    </div>
  </div>
</template>

<style scoped>
.notification-toast {
  --notification-bg: var(--dc-notification-info-bg);
  --notification-text: var(--dc-notification-info-text);
  --notification-border: var(--dc-notification-info-border);
  position: relative;
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  width: min(356px, calc(100vw - 32px));
  height: 80px;
  padding: 12px;
  overflow: hidden;
  box-sizing: border-box;
  color: var(--notification-text);
  background: var(--notification-bg);
  border: 1px solid var(--notification-border);
  border-radius: 10px;
  box-shadow: 0 8px 24px hsl(0 0% 0% / 0.12);
  font-family: var(--dc-font-family);
}

.notification-toast[data-kind='success'] {
  --notification-bg: var(--dc-notification-success-bg);
  --notification-text: var(--dc-notification-success-text);
  --notification-border: var(--dc-notification-success-border);
}

.notification-toast[data-kind='warning'],
.notification-toast[data-kind='actionable'] {
  --notification-bg: var(--dc-notification-warning-bg);
  --notification-text: var(--dc-notification-warning-text);
  --notification-border: var(--dc-notification-warning-border);
}

.notification-toast[data-kind='error'] {
  --notification-bg: var(--dc-notification-error-bg);
  --notification-text: var(--dc-notification-error-text);
  --notification-border: var(--dc-notification-error-border);
}

.notification-toast__icon {
  width: 18px;
  height: 18px;
  align-self: start;
  margin-top: 2px;
}

.notification-toast__icon--spinning,
.notification-toast__action-spinner {
  animation: notification-spin 1s linear infinite;
}

.notification-toast__copy {
  display: grid;
  grid-template-rows: 20px 18px;
  align-content: center;
  min-width: 0;
  gap: 2px;
}

.notification-toast__title,
.notification-toast__detail-text,
.notification-toast__action-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.notification-toast__title {
  font-size: 13px;
  font-weight: 600;
  line-height: 20px;
}

.notification-toast__detail {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 6px;
  color: color-mix(in srgb, var(--notification-text) 72%, transparent);
  font-size: 12px;
  line-height: 18px;
}

.notification-toast__detail--error {
  color: var(--dc-notification-error-text);
}

.notification-toast__detail-text {
  flex: 1;
}

.notification-toast__count,
.notification-toast__pending {
  flex: none;
  font-variant-numeric: tabular-nums;
}

.notification-toast__count {
  min-width: 20px;
  text-align: end;
  font-size: 11px;
  font-weight: 600;
}

.notification-toast__controls {
  display: flex;
  width: max-content;
  max-width: 108px;
  height: 54px;
  flex-direction: column;
  align-items: flex-end;
  justify-content: space-between;
}

.notification-toast__close {
  display: grid;
  width: 20px;
  height: 20px;
  padding: 0;
  place-items: center;
  color: color-mix(in srgb, var(--notification-text) 64%, transparent);
  background: transparent;
  border: 0;
  border-radius: 5px;
  cursor: pointer;
}

.notification-toast__close:hover,
.notification-toast__close:focus-visible {
  color: var(--notification-text);
  background: color-mix(in srgb, var(--notification-text) 9%, transparent);
  outline: none;
}

.notification-toast__action {
  display: flex;
  max-width: 108px;
  height: 26px;
  align-items: center;
  gap: 5px;
  padding: 0 8px;
  color: var(--notification-bg);
  background: var(--notification-text);
  border: 0;
  border-radius: 6px;
  cursor: pointer;
  font-size: 11px;
  font-weight: 600;
  line-height: 26px;
}

.notification-toast__action:hover,
.notification-toast__action:focus-visible {
  opacity: 0.88;
  outline: 2px solid color-mix(in srgb, var(--notification-text) 38%, transparent);
  outline-offset: 1px;
}

.notification-toast__action:disabled {
  cursor: wait;
  opacity: 0.64;
}

.notification-toast__action-spinner {
  width: 12px;
  height: 12px;
  flex: none;
}

.notification-toast__pending {
  min-width: 16px;
  padding-inline-start: 5px;
  border-inline-start: 1px solid color-mix(in srgb, var(--notification-bg) 35%, transparent);
  text-align: center;
}

.notification-toast__progress {
  position: absolute;
  right: 12px;
  bottom: 5px;
  left: 40px;
  height: 3px;
  overflow: hidden;
  background: color-mix(in srgb, var(--notification-text) 12%, transparent);
  border-radius: 99px;
}

.notification-toast__progress-value {
  height: 100%;
  background: currentColor;
  border-radius: inherit;
  transition: width var(--dc-motion-default) var(--dc-ease-out-soft);
}

.notification-toast__progress-value--indeterminate {
  animation: notification-progress 1.2s ease-in-out infinite;
}

@keyframes notification-spin {
  to {
    transform: rotate(360deg);
  }
}

@keyframes notification-progress {
  from {
    transform: translateX(-120%);
  }
  to {
    transform: translateX(320%);
  }
}

@media (prefers-reduced-motion: reduce) {
  .notification-toast__icon--spinning,
  .notification-toast__action-spinner,
  .notification-toast__progress-value--indeterminate {
    animation: none;
  }
}
</style>
