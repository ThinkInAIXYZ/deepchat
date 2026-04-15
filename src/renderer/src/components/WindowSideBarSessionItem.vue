<script setup lang="ts">
import { computed, toRefs } from 'vue'
import { Icon } from '@iconify/vue'
import { useI18n } from 'vue-i18n'

import type { UISession } from '@/stores/ui/session'

type PinFeedbackMode = 'pinning' | 'unpinning'
type SessionItemRegion = 'pinned' | 'grouped'
type SessionStatusIcon = {
  className: string
  icon: string
} | null

defineOptions({
  name: 'WindowSideBarSessionItem'
})

const props = defineProps<{
  session: UISession
  active: boolean
  region: SessionItemRegion
  heroHidden?: boolean
  forcePinDocked?: boolean
  pinFeedbackMode?: PinFeedbackMode | null
  searchQuery?: string
}>()

const emit = defineEmits<{
  select: [session: UISession]
  'toggle-pin': [session: UISession]
  delete: [session: UISession]
}>()

const { t } = useI18n()
const { session, active } = toRefs(props)

const pinActionLabel = computed(() =>
  session.value.isPinned ? t('thread.actions.unpin') : t('thread.actions.pin')
)

const deleteActionLabel = computed(() => t('thread.actions.delete'))

const isWorking = computed(() => session.value.status === 'working')

const pinState = computed<'docked' | 'overlay'>(() => {
  if (props.forcePinDocked) {
    return 'docked'
  }

  if (session.value.isPinned || props.pinFeedbackMode === 'unpinning') {
    return 'docked'
  }

  return 'overlay'
})

const statusIcon = computed<SessionStatusIcon>(() => {
  if (session.value.status === 'completed') {
    return {
      icon: 'lucide:check',
      className: 'text-green-500'
    }
  }

  if (session.value.status === 'error') {
    return {
      icon: 'lucide:alert-circle',
      className: 'text-destructive'
    }
  }

  return null
})

const titleSegments = computed(() => {
  const title = session.value.title
  const query = props.searchQuery?.trim()
  if (!query) {
    return [{ text: title, match: false }]
  }

  const lowerTitle = title.toLowerCase()
  const lowerQuery = query.toLowerCase()
  const segments: Array<{ text: string; match: boolean }> = []
  let searchIndex = 0
  let matchIndex = lowerTitle.indexOf(lowerQuery)

  while (matchIndex !== -1) {
    if (matchIndex > searchIndex) {
      segments.push({
        text: title.slice(searchIndex, matchIndex),
        match: false
      })
    }

    segments.push({
      text: title.slice(matchIndex, matchIndex + query.length),
      match: true
    })

    searchIndex = matchIndex + query.length
    matchIndex = lowerTitle.indexOf(lowerQuery, searchIndex)
  }

  if (searchIndex < title.length) {
    segments.push({
      text: title.slice(searchIndex),
      match: false
    })
  }

  return segments.length > 0 ? segments : [{ text: title, match: false }]
})
</script>

<template>
  <div
    class="session-item no-drag flex w-full cursor-pointer select-none items-center rounded-lg px-2.5 text-left transition-colors duration-200"
    :class="[
      active ? 'bg-accent text-accent-foreground' : 'text-foreground/80 hover:bg-accent/50',
      heroHidden && 'is-hero-hidden'
    ]"
    :data-pin-fx="pinFeedbackMode ?? undefined"
    :data-pin-state="pinState"
    :data-session-region="region"
    :data-session-id="session.id"
    @click="emit('select', session)"
  >
    <button
      type="button"
      class="session-action-button pin-button flex h-7 w-7 items-center justify-center rounded-lg focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40"
      :class="session.isPinned ? 'pin-button--active' : 'pin-button--idle'"
      :title="pinActionLabel"
      :aria-label="pinActionLabel"
      :aria-pressed="session.isPinned"
      @click.stop="emit('toggle-pin', session)"
    >
      <Icon icon="lucide:pin" class="pin-button__icon h-4 w-4" />
    </button>

    <div class="session-content flex min-w-0 flex-1 items-center gap-1.5">
      <span
        class="session-title min-w-0 flex-1 text-sm"
        :class="{ 'session-title--loading': isWorking }"
      >
        <span class="session-title__label">
          <template v-for="(segment, index) in titleSegments" :key="`${session.id}-${index}`">
            <mark v-if="segment.match" class="session-title__highlight">{{ segment.text }}</mark>
            <template v-else>{{ segment.text }}</template>
          </template>
        </span>
        <span v-if="isWorking" aria-hidden="true" class="session-title__sheen">
          {{ session.title }}
        </span>
      </span>

      <span v-if="statusIcon" class="session-status shrink-0">
        <Icon :icon="statusIcon.icon" class="h-3.5 w-3.5" :class="statusIcon.className" />
      </span>
    </div>

    <span class="right-button flex items-center">
      <button
        type="button"
        class="session-action-button right-button__action flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-destructive/30"
        :title="deleteActionLabel"
        :aria-label="deleteActionLabel"
        @click.stop="emit('delete', session)"
      >
        <Icon icon="lucide:trash-2" class="h-4 w-4" />
      </button>
    </span>
  </div>
</template>

<style scoped>
.no-drag {
  -webkit-app-region: no-drag;
}

.session-item {
  position: relative;
  overflow: hidden;
  isolation: isolate;
  transform: translateZ(0);
  min-height: 2.625rem;
  --pin-inline-start: 0.45rem;
  --pin-text-shift: 1.95rem;
  --action-border: color-mix(in srgb, var(--border) 82%, transparent);
  --action-surface: color-mix(in srgb, var(--background) 84%, var(--accent) 16%);
  --action-shadow: 0 12px 30px -22px rgb(15 23 42 / 0.5);
}

.session-item.is-hero-hidden {
  visibility: hidden !important;
}

.session-item.is-hero-hidden * {
  visibility: hidden !important;
}

.sidebar-pin-flight,
.sidebar-pin-flight * {
  visibility: visible !important;
}

.session-item::after {
  content: '';
  position: absolute;
  inset: 0;
  z-index: 0;
  border-radius: inherit;
  opacity: 0;
  pointer-events: none;
  transform: scale(0.97);
  background:
    linear-gradient(
      128deg,
      color-mix(in srgb, var(--primary) 20%, transparent) 0%,
      transparent 46%,
      color-mix(in srgb, var(--primary) 16%, white 8%) 100%
    ),
    radial-gradient(
      circle at 14% 50%,
      color-mix(in srgb, var(--primary) 18%, transparent) 0%,
      transparent 72%
    );
}

.session-item[data-pin-fx='pinning']::after {
  animation: session-item-pin-glow 420ms cubic-bezier(0.24, 0.84, 0.24, 1);
}

.session-item[data-pin-fx='unpinning']::after {
  animation: session-item-unpin-glow 360ms cubic-bezier(0.28, 0.11, 0.32, 1);
}

.session-content {
  position: relative;
  z-index: 1;
  min-width: 0;
  margin-left: 0;
  transition: margin-left 280ms;
}

.session-item[data-pin-state='docked'] .session-content {
  margin-left: var(--pin-text-shift);
}

.session-item[data-pin-fx] .session-content {
  will-change: margin-left;
}

.session-action-button {
  border: 1px solid var(--action-border);
  background-color: var(--action-surface);
  box-shadow:
    inset 0 1px 0 color-mix(in srgb, var(--foreground) 6%, transparent),
    var(--action-shadow);
  backdrop-filter: blur(10px);
  transition:
    background-color 180ms ease,
    border-color 180ms ease,
    color 180ms ease,
    box-shadow 220ms ease,
    transform 220ms cubic-bezier(0.2, 0.9, 0.2, 1);
}

.session-action-button:hover {
  background-color: color-mix(in srgb, var(--accent) 80%, var(--background) 20%);
  border-color: color-mix(in srgb, var(--border) 64%, var(--foreground) 8%);
  box-shadow: 0 16px 32px -24px rgb(15 23 42 / 0.58);
}

.pin-button {
  position: absolute;
  top: 50%;
  left: var(--pin-inline-start);
  z-index: 3;
  visibility: hidden;
  pointer-events: none;
  opacity: 0;
  color: var(--muted-foreground);
  transform: translate3d(-0.16rem, -50%, 0) scale(0.94);
  transition:
    opacity 160ms ease,
    visibility 0s linear 160ms,
    transform 220ms cubic-bezier(0.2, 0.9, 0.2, 1),
    background-color 180ms ease,
    border-color 180ms ease,
    color 180ms ease,
    box-shadow 220ms ease;
}

.pin-button::before {
  content: '';
  position: absolute;
  inset: 0.2rem;
  border-radius: 0.5rem;
  background: radial-gradient(
    circle at 50% 45%,
    color-mix(in srgb, var(--primary) 78%, transparent) 0%,
    transparent 72%
  );
  opacity: 0;
  transform: scale(0.72);
  transition:
    opacity 180ms ease,
    transform 180ms ease;
}

.session-item[data-pin-state='docked'] .pin-button,
.session-item[data-pin-state='overlay']:hover .pin-button,
.session-item[data-pin-state='overlay']:focus-within .pin-button,
.session-item[data-pin-fx] .pin-button {
  visibility: visible;
  pointer-events: auto;
  opacity: 1;
  transform: translate3d(0, -50%, 0) scale(1);
  transition-delay: 0s;
}

.sidebar-pin-flight .pin-button {
  visibility: visible;
  opacity: 1;
  pointer-events: none;
  border-color: transparent;
  background-color: transparent;
  box-shadow: none;
  backdrop-filter: none;
  transform: translate3d(0, -50%, 0) scale(1);
  transition: none;
}

.pin-button--idle .pin-button__icon {
  transform: rotate(-10deg) scale(0.92);
}

.pin-button--active {
  color: var(--primary);
}

.session-item[data-pin-state='docked'] .pin-button {
  border-color: transparent;
  background: transparent;
  box-shadow: none;
  backdrop-filter: none;
}

.session-item[data-pin-state='docked'] .pin-button:hover {
  background: color-mix(in srgb, var(--accent) 78%, transparent);
  border-color: transparent;
  box-shadow: none;
}

.session-item[data-pin-state='docked'] .pin-button::before {
  opacity: 0;
}

.pin-button__icon {
  position: relative;
  z-index: 1;
  transition:
    transform 180ms ease,
    color 180ms ease;
}

.pin-button--active .pin-button__icon {
  transform: translateY(-1px);
}

.session-item[data-pin-state='docked'] .pin-button:hover .pin-button__icon {
  transform: translateY(-1px) scale(1.06) 2s;
}

.session-item[data-pin-fx='pinning'] .pin-button::before {
  animation: pin-button-bloom 560ms cubic-bezier(0.18, 0.88, 0.24, 1);
}

.session-item[data-pin-fx='pinning'] .pin-button__icon {
  animation: pin-icon-twist-in 560ms cubic-bezier(0.18, 0.88, 0.24, 1);
}

.session-item[data-pin-fx='unpinning'] .pin-button::before {
  animation: pin-button-release 460ms cubic-bezier(0.3, 0.07, 0.34, 1);
}

.session-item[data-pin-fx='unpinning'] .pin-button__icon {
  animation: pin-icon-twist-out 460ms cubic-bezier(0.3, 0.07, 0.34, 1);
}

.session-title {
  position: relative;
  display: block;
  line-height: 1.35;
}

.session-title__label,
.session-title__sheen {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.session-title--loading {
  --session-loading-base: color-mix(in srgb, currentColor 66%, transparent);
  --session-loading-bright: color-mix(in srgb, currentColor 30%, white);
  contain: paint;
}

.session-title--loading .session-title__label {
  color: var(--session-loading-base);
}

.session-title__highlight {
  border-radius: 0.35rem;
  background: color-mix(in srgb, var(--primary) 14%, transparent);
  color: inherit;
  padding: 0 0.08rem;
}

.session-status {
  position: relative;
  z-index: 1;
}

.session-title__sheen {
  position: absolute;
  inset: 0;
  pointer-events: none;
  color: var(--session-loading-bright);
  opacity: 0.9;
  -webkit-mask-image: linear-gradient(
    90deg,
    transparent 0%,
    rgb(255 255 255 / 0.04) 16%,
    rgb(255 255 255 / 0.2) 34%,
    rgb(255 255 255 / 0.94) 50%,
    rgb(255 255 255 / 0.2) 66%,
    rgb(255 255 255 / 0.04) 84%,
    transparent 100%
  );
  mask-image: linear-gradient(
    90deg,
    transparent 0%,
    rgb(255 255 255 / 0.04) 16%,
    rgb(255 255 255 / 0.2) 34%,
    rgb(255 255 255 / 0.94) 50%,
    rgb(255 255 255 / 0.2) 66%,
    rgb(255 255 255 / 0.04) 84%,
    transparent 100%
  );
  -webkit-mask-repeat: no-repeat;
  mask-repeat: no-repeat;
  -webkit-mask-size: 42% 100%;
  mask-size: 42% 100%;
  -webkit-mask-position: -26% 0;
  mask-position: -26% 0;
  will-change: mask-position;
  animation: session-loading-sheen 2.5s cubic-bezier(0.4, 0.08, 0.22, 0.98) infinite;
}

.right-button {
  position: absolute;
  top: 50%;
  right: 0.45rem;
  z-index: 3;
  visibility: hidden;
  opacity: 0;
  pointer-events: none;
  transform: translate3d(0.18rem, -50%, 0) scale(0.96);
  transition:
    opacity 160ms ease,
    visibility 0s linear 160ms,
    transform 220ms cubic-bezier(0.2, 0.9, 0.2, 1);
}

.right-button__action:hover {
  color: var(--destructive);
}

.session-item:hover .right-button,
.session-item:focus-within .right-button {
  visibility: visible;
  opacity: 1;
  pointer-events: auto;
  transform: translate3d(0, -50%, 0) scale(1);
  transition-delay: 0s;
}

@keyframes session-loading-sheen {
  from {
    -webkit-mask-position: -26% 0;
    mask-position: -26% 0;
  }

  to {
    -webkit-mask-position: 126% 0;
    mask-position: 126% 0;
  }
}

@keyframes session-item-pin-glow {
  0% {
    opacity: 0;
    transform: scale(0.985);
  }

  45% {
    opacity: 0.72;
    transform: scale(1);
  }

  100% {
    opacity: 0;
    transform: scale(1.015);
  }
}

@keyframes session-item-unpin-glow {
  0% {
    opacity: 0;
    transform: scale(0.992);
  }

  40% {
    opacity: 0.32;
    transform: scale(1);
  }

  100% {
    opacity: 0;
    transform: scale(1.008);
  }
}

@keyframes pin-button-bloom {
  0% {
    opacity: 0.16;
    transform: scale(0.68);
  }

  42% {
    opacity: 0.38;
    transform: scale(1.12);
  }

  100% {
    opacity: 0.18;
    transform: scale(1);
  }
}

@keyframes pin-button-release {
  0% {
    opacity: 0.16;
    transform: scale(1);
  }

  40% {
    opacity: 0.1;
    transform: scale(0.84);
  }

  100% {
    opacity: 0;
    transform: scale(0.72);
  }
}

@keyframes pin-icon-twist-in {
  0% {
    transform: rotate(-18deg) scale(0.92);
  }

  52% {
    transform: rotate(18deg) translateY(-1px) scale(1.1);
  }

  100% {
    transform: translateY(-1px) scale(1);
  }
}

@keyframes pin-icon-twist-out {
  0% {
    transform: translateY(-1px) scale(1);
  }

  45% {
    transform: rotate(14deg) scale(0.96);
  }

  100% {
    transform: rotate(-10deg) scale(0.92);
  }
}

@media (prefers-reduced-motion: reduce) {
  .session-item,
  .session-item::after,
  .session-content,
  .session-action-button,
  .pin-button::before,
  .pin-button__icon,
  .right-button {
    animation: none;
    transition: none;
  }

  .session-title--loading .session-title__label {
    color: currentColor;
  }

  .session-title__sheen {
    display: none;
  }
}
</style>
