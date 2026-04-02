<script setup lang="ts">
import { computed, toRefs } from 'vue'
import { Icon } from '@iconify/vue'
import { useI18n } from 'vue-i18n'

import type { UISession } from '@/stores/ui/session'

type PinFeedbackMode = 'pinning' | 'unpinning'
type SessionItemRegion = 'pinned' | 'grouped'

defineOptions({
  name: 'WindowSideBarSessionItem'
})

const props = defineProps<{
  session: UISession
  active: boolean
  region: SessionItemRegion
  heroHidden?: boolean
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
    class="session-item select-none cursor-pointer no-drag flex w-full items-center gap-1 rounded-md px-2 py-1.5 text-left transition-colors duration-200"
    :class="active ? 'bg-accent text-accent-foreground' : 'text-foreground/80 hover:bg-accent/50'"
    :data-pin-fx="pinFeedbackMode ?? undefined"
    :data-hero-hidden="heroHidden ? 'true' : undefined"
    :data-session-region="region"
    :data-session-id="session.id"
    @click="emit('select', session)"
  >
    <button
      type="button"
      class="pin-button flex h-6 w-6 shrink-0 items-center justify-center rounded-md focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40"
      :class="session.isPinned ? 'pin-button--active' : 'pin-button--idle'"
      :data-pin-fx="pinFeedbackMode ?? undefined"
      :title="pinActionLabel"
      :aria-label="pinActionLabel"
      :aria-pressed="session.isPinned"
      @click.stop="emit('toggle-pin', session)"
    >
      <Icon icon="lucide:pin" class="pin-button__icon h-4 w-4" />
    </button>

    <span
      class="session-title min-w-0 flex-1 text-sm"
      :class="{ 'session-title--loading': session.status === 'working' }"
    >
      <span class="session-title__label">
        <template v-for="(segment, index) in titleSegments" :key="`${session.id}-${index}`">
          <mark v-if="segment.match" class="session-title__highlight">{{ segment.text }}</mark>
          <template v-else>{{ segment.text }}</template>
        </template>
      </span>
      <span v-if="session.status === 'working'" aria-hidden="true" class="session-title__sheen">
        {{ session.title }}
      </span>
    </span>

    <span v-if="session.status === 'completed'" class="shrink-0">
      <Icon icon="lucide:check" class="h-3.5 w-3.5 text-green-500" />
    </span>
    <span v-else-if="session.status === 'error'" class="shrink-0">
      <Icon icon="lucide:alert-circle" class="h-3.5 w-3.5 text-destructive" />
    </span>

    <span class="right-button flex shrink-0 items-center gap-2 transition-all duration-200">
      <button
        type="button"
        class="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors duration-200 hover:text-destructive focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-destructive/30"
        :title="t('thread.actions.delete')"
        :aria-label="t('thread.actions.delete')"
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
}

.session-item[data-hero-hidden='true'] {
  visibility: hidden;
}

.session-item > * {
  position: relative;
  z-index: 1;
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

.session-item[data-pin-fx='pinning'] {
  animation: none;
}

.session-item[data-pin-fx='pinning']::after {
  animation: session-item-pin-glow 420ms cubic-bezier(0.24, 0.84, 0.24, 1);
}

.session-item[data-pin-fx='unpinning'] {
  animation: none;
}

.session-item[data-pin-fx='unpinning']::after {
  animation: session-item-unpin-glow 360ms cubic-bezier(0.28, 0.11, 0.32, 1);
}

.pin-button {
  position: relative;
  overflow: hidden;
  transition:
    background-color 200ms ease,
    color 200ms ease,
    transform 200ms ease;
}

.pin-button::before {
  content: '';
  position: absolute;
  inset: 0.18rem;
  border-radius: 0.45rem;
  background: radial-gradient(circle at 50% 45%, var(--primary) 0%, transparent 72%);
  opacity: 0;
  transform: scale(0.72);
  transition:
    opacity 200ms ease,
    transform 200ms ease;
}

.pin-button:hover {
  background: var(--accent);
}

.session-item:hover .pin-button--idle,
.session-item:focus-within .pin-button--idle,
.session-item[data-pin-fx] .pin-button--idle,
.pin-button[data-pin-fx] {
  visibility: visible;
}

.sidebar-pin-flight .pin-button--idle {
  visibility: visible;
}

.pin-button--idle {
  color: var(--muted-foreground);
  visibility: hidden;
}

.pin-button--active {
  color: var(--primary);
}

.pin-button--active::before {
  opacity: 0.22;
  transform: scale(1);
}

.pin-button__icon {
  position: relative;
  z-index: 1;
  transition:
    transform 200ms ease,
    color 200ms ease;
}

.pin-button--idle .pin-button__icon {
  transform: rotate(-12deg) scale(0.92);
}

.pin-button--active .pin-button__icon {
  transform: translateY(-1px) scale(1);
}

.pin-button[data-pin-fx='pinning']::before {
  animation: pin-button-bloom 560ms cubic-bezier(0.18, 0.88, 0.24, 1);
}

.pin-button[data-pin-fx='pinning'] .pin-button__icon {
  animation: pin-icon-twist-in 560ms cubic-bezier(0.18, 0.88, 0.24, 1);
}

.pin-button[data-pin-fx='unpinning']::before {
  animation: pin-button-release 460ms cubic-bezier(0.3, 0.07, 0.34, 1);
}

.pin-button[data-pin-fx='unpinning'] .pin-button__icon {
  animation: pin-icon-twist-out 460ms cubic-bezier(0.3, 0.07, 0.34, 1);
}

.session-title {
  position: relative;
  display: block;
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
  opacity: 0;
  pointer-events: none;
  transform: translateX(4px);
}

.session-item:hover .right-button,
.session-item:focus-within .right-button {
  opacity: 1;
  pointer-events: auto;
  transform: translateX(0);
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
    opacity: 0.18;
    transform: scale(0.68);
  }

  42% {
    opacity: 0.42;
    transform: scale(1.14);
  }

  100% {
    opacity: 0.22;
    transform: scale(1);
  }
}

@keyframes pin-button-release {
  0% {
    opacity: 0.18;
    transform: scale(1);
  }

  40% {
    opacity: 0.12;
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
    transform: rotate(18deg) translateY(-1px) scale(1.12);
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
    transform: rotate(-12deg) scale(0.92);
  }
}

@media (prefers-reduced-motion: reduce) {
  .session-item,
  .session-item::after,
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
