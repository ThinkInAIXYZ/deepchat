<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { FloatingWidgetSnapshot } from '@shared/types/floating-widget'
import FloatingSessionItem from './components/FloatingSessionItem.vue'

defineOptions({
  name: 'FloatingButton'
})

interface DragState {
  isDragging: boolean
  isMouseDown: boolean
  startX: number
  startY: number
  startScreenX: number
  startScreenY: number
  dragTimer: number | null
  lastMoveTime: number
}

const props = defineProps<{
  theme: 'dark' | 'light'
}>()

const DRAG_DELAY = 180
const DRAG_THRESHOLD = 4
const CLOSE_MOTION_SETTLE_MS = 240

const { t } = useI18n()

const isDragging = ref(false)
const isHovering = ref(false)
const isClosing = ref(false)
const snapshot = ref<FloatingWidgetSnapshot>({
  expanded: false,
  activeCount: 0,
  sessions: []
})

let closingTimer: number | null = null

const dragState = ref<DragState>({
  isDragging: false,
  isMouseDown: false,
  startX: 0,
  startY: 0,
  startScreenX: 0,
  startScreenY: 0,
  dragTimer: null,
  lastMoveTime: 0
})

const hasActiveTasks = computed(() => snapshot.value.activeCount > 0)
const activeCountDisplay = computed(() =>
  snapshot.value.activeCount > 99 ? '99+' : String(snapshot.value.activeCount)
)
const sessionCountLabel = computed(() =>
  t('chat.floatingWidget.sessionCount', { count: snapshot.value.sessions.length })
)

const clearDragTimer = () => {
  if (dragState.value.dragTimer) {
    clearTimeout(dragState.value.dragTimer)
    dragState.value.dragTimer = null
  }
}

const clearClosingTimer = () => {
  if (closingTimer) {
    clearTimeout(closingTimer)
    closingTimer = null
  }
}

const syncCloseMotionState = (nextExpanded: boolean) => {
  if (nextExpanded) {
    clearClosingTimer()
    isClosing.value = false
    return
  }

  if (!snapshot.value.expanded) {
    return
  }

  clearClosingTimer()
  isClosing.value = true
  closingTimer = window.setTimeout(() => {
    isClosing.value = false
    closingTimer = null
  }, CLOSE_MOTION_SETTLE_MS)
}

const handleSnapshotUpdate = (nextSnapshot: FloatingWidgetSnapshot) => {
  syncCloseMotionState(nextSnapshot.expanded)
  snapshot.value = nextSnapshot
}

const setExpanded = (expanded: boolean) => {
  syncCloseMotionState(expanded)
  snapshot.value = {
    ...snapshot.value,
    expanded
  }
  window.floatingButtonAPI.setExpanded(expanded)
}

const toggleExpanded = () => {
  setExpanded(!snapshot.value.expanded)
}

const setHovering = (hovering: boolean) => {
  if (isHovering.value === hovering) {
    return
  }

  isHovering.value = hovering
  window.floatingButtonAPI.setHovering(hovering)
}

const startDragging = () => {
  dragState.value.isDragging = true
  isDragging.value = true
  window.floatingButtonAPI.onDragStart(dragState.value.startScreenX, dragState.value.startScreenY)
}

const handleMouseEnter = () => {
  setHovering(true)
}

const handleMouseLeave = () => {
  if (dragState.value.isDragging) {
    return
  }

  setHovering(false)
}

const handleMouseDown = (event: MouseEvent) => {
  if (event.button !== 0) {
    return
  }

  const target = event.target as HTMLElement | null
  if (target?.closest('[data-no-drag]')) {
    return
  }

  event.preventDefault()

  dragState.value.isMouseDown = true
  dragState.value.startX = event.clientX
  dragState.value.startY = event.clientY
  dragState.value.startScreenX = event.screenX
  dragState.value.startScreenY = event.screenY
  dragState.value.lastMoveTime = Date.now()

  dragState.value.dragTimer = window.setTimeout(() => {
    if (dragState.value.isMouseDown) {
      startDragging()
    }
  }, DRAG_DELAY)

  document.addEventListener('mousemove', handleMouseMove)
  document.addEventListener('mouseup', handleMouseUp)
}

const handleMouseMove = (event: MouseEvent) => {
  if (!dragState.value.isMouseDown) return

  const deltaX = Math.abs(event.clientX - dragState.value.startX)
  const deltaY = Math.abs(event.clientY - dragState.value.startY)

  if (!dragState.value.isDragging && (deltaX > DRAG_THRESHOLD || deltaY > DRAG_THRESHOLD)) {
    clearDragTimer()
    startDragging()
  }

  if (dragState.value.isDragging) {
    const now = Date.now()
    if (now - dragState.value.lastMoveTime >= 16) {
      dragState.value.lastMoveTime = now
      window.floatingButtonAPI.onDragMove(event.screenX, event.screenY)
    }
  }
}

const handleMouseUp = (event: MouseEvent) => {
  if (event.button !== 0) {
    return
  }

  const wasDragging = dragState.value.isDragging
  clearDragTimer()
  dragState.value.isMouseDown = false

  if (wasDragging) {
    dragState.value.isDragging = false
    isDragging.value = false
    window.floatingButtonAPI.onDragEnd(event.screenX, event.screenY)
  } else if (!snapshot.value.expanded) {
    toggleExpanded()
  }

  document.removeEventListener('mousemove', handleMouseMove)
  document.removeEventListener('mouseup', handleMouseUp)
}

const handleRightClick = (event: MouseEvent) => {
  event.preventDefault()
  clearDragTimer()
  dragState.value.isMouseDown = false
  dragState.value.isDragging = false
  isDragging.value = false
  document.removeEventListener('mousemove', handleMouseMove)
  document.removeEventListener('mouseup', handleMouseUp)
  window.floatingButtonAPI.onRightClick()
}

const handleOpenSession = (sessionId: string) => {
  window.floatingButtonAPI.openSession(sessionId)
}

const handleWindowBlur = () => {
  if (snapshot.value.expanded) {
    setExpanded(false)
  }
}

onMounted(async () => {
  try {
    snapshot.value = await window.floatingButtonAPI.getSnapshot()
  } catch (error) {
    console.warn('Failed to initialize floating widget snapshot:', error)
  }

  window.floatingButtonAPI.onSnapshotUpdate(handleSnapshotUpdate)
  window.addEventListener('blur', handleWindowBlur)
})

onUnmounted(() => {
  clearDragTimer()
  clearClosingTimer()
  setHovering(false)
  document.removeEventListener('mousemove', handleMouseMove)
  document.removeEventListener('mouseup', handleMouseUp)
  window.removeEventListener('blur', handleWindowBlur)
  window.floatingButtonAPI.removeAllListeners()
})
</script>

<template>
  <div
    class="widget-stage h-screen w-screen overflow-hidden bg-transparent"
    :data-theme="props.theme"
    :data-motion="isClosing ? 'closing' : 'idle'"
    :class="{ dark: props.theme === 'dark' }"
  >
    <div
      class="relative h-full w-full select-none"
      :class="[
        snapshot.expanded ? 'cursor-grab' : 'cursor-pointer',
        isDragging ? 'cursor-grabbing' : ''
      ]"
      @mouseenter="handleMouseEnter"
      @mouseleave="handleMouseLeave"
      @mousedown="handleMouseDown"
      @contextmenu="handleRightClick"
    >
      <div class="relative h-full w-full overflow-hidden">
        <div
          class="collapsed-layer absolute inset-0 flex h-full w-full items-center justify-center overflow-hidden"
          :class="[
            snapshot.expanded
              ? 'collapsed-layer-hidden pointer-events-none'
              : 'pointer-events-auto',
            { 'floating-shell-dragging': isDragging }
          ]"
        >
          <div
            class="logo-orb logo-orb-hero relative isolate flex h-full w-full items-center justify-center overflow-hidden rounded-full"
            :class="hasActiveTasks ? 'status-orb-busy' : 'status-orb-idle'"
          >
            <div
              class="status-orb-face status-orb-logo absolute inset-0 flex items-center justify-center"
            >
              <img
                src="../src/assets/logo.png"
                :alt="t('chat.floatingWidget.title')"
                class="logo-orb-image status-orb-logo-image h-9 w-9"
              />
            </div>

            <div
              class="status-orb-face status-orb-active absolute inset-0 flex items-center justify-center"
              :aria-label="t('chat.floatingWidget.executing')"
            >
              <div
                class="status-orb-orbit-shell flex h-[46px] w-[46px] items-center justify-center rounded-full"
              >
                <div class="relative flex h-8 w-8 items-center justify-center">
                  <span class="busy-orbit-ring status-orb-ring"></span>
                  <span
                    class="busy-orbit-ring busy-orbit-ring-delayed status-orb-ring status-orb-ring-inner"
                  ></span>
                  <span
                    class="status-orb-count-shell inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1"
                  >
                    <span
                      class="status-orb-count text-[12px] font-bold leading-none tracking-[0.01em]"
                      :class="{
                        'text-[10px]': activeCountDisplay.length > 1,
                        'text-[8px] tracking-[0]': activeCountDisplay.length > 2
                      }"
                    >
                      {{ activeCountDisplay }}
                    </span>
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div
          class="floating-shell floating-shell-expanded absolute inset-0 flex h-full w-full flex-col overflow-hidden p-3"
          :class="[
            snapshot.expanded
              ? 'floating-shell-expanded-active pointer-events-auto'
              : 'floating-shell-expanded-hidden pointer-events-none',
            { 'floating-shell-dragging': isDragging }
          ]"
        >
          <div
            class="panel-header relative z-[1] flex items-center justify-between gap-3 px-1 pb-3 pt-1"
          >
            <div class="flex min-w-0 items-center gap-3">
              <div class="flex h-11 w-11 shrink-0 items-center justify-center">
                <img
                  src="../src/assets/logo.png"
                  :alt="t('chat.floatingWidget.title')"
                  class="h-6 w-6"
                />
              </div>

              <div class="min-w-0">
                <p class="panel-title truncate text-[15px] font-semibold tracking-[0.01em]">
                  {{ t('chat.floatingWidget.title') }}
                </p>
                <div class="mt-1 flex items-center gap-2">
                  <p class="panel-meta truncate text-[12px]">{{ sessionCountLabel }}</p>
                  <span
                    v-if="hasActiveTasks"
                    class="live-chip inline-flex items-center justify-center gap-1.5 rounded-full px-2 py-1 text-[11px] font-semibold leading-none"
                  >
                    <span class="live-chip-dot size-1.5 rounded-full"></span>
                    {{ snapshot.activeCount }}
                  </span>
                </div>
              </div>
            </div>

            <button
              type="button"
              data-no-drag
              class="panel-close flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-all duration-200"
              :aria-label="t('chat.floatingWidget.collapse')"
              @click.stop="setExpanded(false)"
            >
              <span class="text-lg leading-none">×</span>
            </button>
          </div>

          <div class="panel-list relative z-[1] min-h-0 flex-1 overflow-y-auto px-1 pb-1">
            <div
              v-if="snapshot.sessions.length === 0"
              class="empty-panel flex h-full min-h-[110px] items-center justify-center rounded-[12px] px-5 text-center text-sm"
            >
              {{ t('chat.floatingWidget.empty') }}
            </div>

            <div v-else class="flex flex-col space-y-2">
              <div
                v-for="(session, index) in snapshot.sessions"
                :key="session.id"
                class="session-row"
                :style="{ '--session-index': Math.min(index, 6) }"
              >
                <FloatingSessionItem :session="session" @select="handleOpenSession" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.widget-stage {
  --widget-radius: 16px;
  --widget-ease-smooth: cubic-bezier(0.16, 1, 0.3, 1);
  --widget-ease-soft: cubic-bezier(0.22, 1, 0.36, 1);
  --transition-collapsed-layer:
    opacity 260ms ease, transform 620ms var(--widget-ease-smooth),
    filter 520ms var(--widget-ease-smooth);
  --transition-expanded-shell:
    opacity 320ms ease, transform 640ms var(--widget-ease-smooth),
    filter 520ms var(--widget-ease-smooth);
  --transition-panel:
    opacity 280ms ease, transform 620ms var(--widget-ease-smooth),
    filter 420ms var(--widget-ease-soft);
  --transition-session:
    opacity 320ms ease, transform 640ms var(--widget-ease-smooth),
    filter 460ms var(--widget-ease-soft);
  --transition-logo-hero:
    opacity 240ms ease, transform 700ms var(--widget-ease-smooth),
    filter 560ms var(--widget-ease-smooth), border-color 220ms ease;
  --transition-logo:
    opacity 240ms ease, transform 640ms var(--widget-ease-smooth), filter 320ms ease;
  --transition-status-face:
    opacity 260ms ease, transform 620ms var(--widget-ease-smooth),
    filter 420ms var(--widget-ease-soft);
  --transition-status-logo:
    opacity 260ms ease, transform 620ms var(--widget-ease-smooth), filter 320ms ease;
  border-radius: var(--widget-radius);
}

.widget-stage[data-motion='closing'] {
  --transition-collapsed-layer:
    opacity 180ms ease, transform 220ms var(--widget-ease-soft);
  --transition-expanded-shell:
    opacity 200ms ease, transform 220ms var(--widget-ease-soft);
  --transition-panel: opacity 170ms ease, transform 180ms var(--widget-ease-soft);
  --transition-session: opacity 160ms ease, transform 180ms var(--widget-ease-soft);
  --transition-logo-hero:
    opacity 180ms ease, transform 220ms var(--widget-ease-soft), border-color 180ms ease;
  --transition-logo: opacity 160ms ease, transform 180ms var(--widget-ease-soft);
  --transition-status-face: opacity 170ms ease, transform 180ms var(--widget-ease-soft);
  --transition-status-logo: opacity 160ms ease, transform 160ms ease;
}

.widget-stage[data-theme='dark'] {
  --collapsed-orb-border: rgba(255, 255, 255, 0.09);
  --collapsed-orb-idle-bg:
    radial-gradient(circle at 30% 24%, rgba(16, 185, 129, 0.18), transparent 36%),
    linear-gradient(160deg, #171e24 0%, #0d1115 52%, #07090b 100%);
  --collapsed-orb-inner-ring-border: rgba(255, 255, 255, 0.08);
  --collapsed-orb-overlay: transparent;
  --collapsed-orb-busy-border: rgba(35, 67, 51, 0.96);
  --collapsed-orb-busy-bg:
    radial-gradient(circle at 32% 34%, rgba(16, 185, 129, 0.22), transparent 34%),
    linear-gradient(160deg, #162019 0%, #0d1210 52%, #080a09 100%);
  --collapsed-logo-shadow-busy: drop-shadow(0 6px 10px rgba(0, 0, 0, 0.18));
  --collapsed-orbit-shell-border: rgba(52, 211, 153, 0.12);
  --collapsed-orbit-shell-bg:
    radial-gradient(circle at 50% 50%, rgba(16, 185, 129, 0.18), transparent 68%),
    linear-gradient(180deg, #18241d 0%, #101712 100%);
  --collapsed-count-border: rgba(50, 91, 70, 0.94);
  --collapsed-count-bg: linear-gradient(180deg, #193227 0%, #101a15 100%);
  --collapsed-count-color: #f6faf7;
  --expanded-shell-border: rgba(255, 255, 255, 0.14);
  --expanded-shell-bg-color: #0b0f12;
  --expanded-shell-bg-image: linear-gradient(180deg, #0f1418 0%, #080b0e 100%);
  --expanded-shell-before:
    radial-gradient(circle at top left, rgba(16, 185, 129, 0.16), transparent 34%),
    radial-gradient(circle at 85% 0%, rgba(255, 255, 255, 0.08), transparent 24%);
  --expanded-shell-after: linear-gradient(180deg, rgba(255, 255, 255, 0.035), transparent 22%);
  --panel-title-color: #ffffff;
  --panel-meta-color: rgba(255, 255, 255, 0.52);
  --panel-close-color: rgba(255, 255, 255, 0.72);
  --panel-close-hover-color: #ffffff;
  --panel-close-border: rgba(255, 255, 255, 0.08);
  --panel-close-bg: linear-gradient(180deg, #171d23 0%, #10151a 100%);
  --panel-close-hover-border: rgba(255, 255, 255, 0.14);
  --panel-close-hover-bg: linear-gradient(180deg, #1c232a 0%, #12191f 100%);
  --live-chip-border: rgba(16, 185, 129, 0.18);
  --live-chip-bg: #0d2118;
  --live-chip-color: rgba(209, 250, 229, 0.96);
  --live-chip-dot: #6ee7b7;
  --empty-panel-border: rgba(255, 255, 255, 0.07);
  --empty-panel-bg: linear-gradient(180deg, #12181d 0%, #0c1014 100%), #12181d;
  --empty-panel-color: rgba(255, 255, 255, 0.48);
  --panel-scrollbar-thumb: rgba(255, 255, 255, 0.14);
}

.widget-stage[data-theme='light'] {
  --collapsed-orb-border: rgba(148, 163, 184, 0.26);
  --collapsed-orb-idle-bg:
    radial-gradient(circle at 26% 22%, rgba(59, 130, 246, 0.22), transparent 34%),
    radial-gradient(circle at 74% 78%, rgba(16, 185, 129, 0.14), transparent 42%),
    linear-gradient(
      165deg,
      rgba(255, 255, 255, 0.99) 0%,
      rgba(248, 250, 252, 0.99) 42%,
      #e2e8f0 100%
    );
  --collapsed-orb-inner-ring-border: rgba(148, 163, 184, 0.22);
  --collapsed-orb-overlay:
    linear-gradient(180deg, rgba(255, 255, 255, 0.86), transparent 46%),
    radial-gradient(circle at 72% 82%, rgba(191, 219, 254, 0.24), transparent 38%);
  --collapsed-orb-busy-border: rgba(5, 150, 105, 0.26);
  --collapsed-orb-busy-bg:
    radial-gradient(circle at 24% 22%, rgba(16, 185, 129, 0.22), transparent 34%),
    radial-gradient(circle at 76% 74%, rgba(14, 165, 233, 0.16), transparent 42%),
    linear-gradient(165deg, #ffffff 0%, #f7fef9 56%, #dcfce7 100%);
  --collapsed-logo-shadow-busy: drop-shadow(0 3px 8px rgba(148, 163, 184, 0.18));
  --collapsed-orbit-shell-border: rgba(16, 185, 129, 0.16);
  --collapsed-orbit-shell-bg:
    radial-gradient(circle at 50% 50%, rgba(16, 185, 129, 0.12), transparent 66%),
    linear-gradient(180deg, #ffffff 0%, #ecfdf5 100%);
  --collapsed-count-border: rgba(16, 185, 129, 0.22);
  --collapsed-count-bg: linear-gradient(180deg, #ffffff 0%, #dcfce7 100%);
  --collapsed-count-color: #065f46;
  --expanded-shell-border: rgba(148, 163, 184, 0.28);
  --expanded-shell-bg-color: #ffffff;
  --expanded-shell-bg-image:
    radial-gradient(circle at 0% 0%, rgba(59, 130, 246, 0.1), transparent 24%),
    radial-gradient(circle at 100% 0%, rgba(16, 185, 129, 0.12), transparent 20%),
    linear-gradient(180deg, #ffffff 0%, #f8fafc 100%);
  --expanded-shell-before:
    radial-gradient(circle at top left, rgba(59, 130, 246, 0.12), transparent 32%),
    radial-gradient(circle at 86% 0%, rgba(16, 185, 129, 0.14), transparent 28%);
  --expanded-shell-after: linear-gradient(180deg, rgba(255, 255, 255, 0.74), transparent 24%);
  --panel-title-color: #0f172a;
  --panel-meta-color: rgba(71, 85, 105, 0.88);
  --panel-close-color: rgba(71, 85, 105, 0.82);
  --panel-close-hover-color: #0f172a;
  --panel-close-border: rgba(148, 163, 184, 0.22);
  --panel-close-bg: linear-gradient(180deg, #ffffff 0%, #eef2f7 100%);
  --panel-close-hover-border: rgba(100, 116, 139, 0.34);
  --panel-close-hover-bg: linear-gradient(180deg, #ffffff 0%, #e2e8f0 100%);
  --live-chip-border: rgba(16, 185, 129, 0.22);
  --live-chip-bg: #ecfdf5;
  --live-chip-color: #047857;
  --live-chip-dot: #10b981;
  --empty-panel-border: rgba(148, 163, 184, 0.18);
  --empty-panel-bg: linear-gradient(180deg, #ffffff 0%, #f8fafc 100%);
  --empty-panel-color: rgba(100, 116, 139, 0.88);
  --panel-scrollbar-thumb: rgba(148, 163, 184, 0.34);
}

.floating-shell {
  border-radius: var(--widget-radius);
  user-select: none;
  -webkit-user-select: none;
  backface-visibility: hidden;
  transform: translateZ(0);
  will-change: transform, opacity;
  transition:
    transform 160ms ease,
    border-color 200ms ease,
    background-color 200ms ease;
}

.collapsed-layer {
  opacity: 1;
  transform: translate3d(0, 0, 0) scale(1);
  filter: blur(0);
  transform-origin: 36px 30px;
  transition: var(--transition-collapsed-layer);
  will-change: transform, opacity, filter;
}

.collapsed-layer-hidden {
  opacity: 0;
  transform: translate3d(-18px, -12px, 0) scale(0.84);
  filter: blur(10px);
}

.widget-stage[data-motion='closing'] .collapsed-layer-hidden {
  filter: none;
}

.collapsed-layer.floating-shell-dragging {
  transform: translate3d(0, 0, 0) scale(0.985);
}

.collapsed-layer-hidden.floating-shell-dragging {
  transform: translate3d(-18px, -12px, 0) scale(0.82);
}

.floating-shell-expanded {
  position: relative;
  opacity: 1;
  transform: translate3d(0, 0, 0) scale(1);
  filter: blur(0);
  border: 1px solid var(--expanded-shell-border);
  border-radius: var(--widget-radius);
  background-color: var(--expanded-shell-bg-color);
  background-image: var(--expanded-shell-bg-image);
  transform-origin: top center;
  transition: var(--transition-expanded-shell);
  will-change: transform, opacity, filter;
}

.floating-shell-expanded-hidden {
  opacity: 0;
  transform: translate3d(0, 18px, 0) scale(0.972);
  filter: blur(16px);
}

.widget-stage[data-motion='closing'] .floating-shell-expanded-hidden {
  filter: none;
}

.floating-shell-expanded.floating-shell-dragging {
  transform: translate3d(0, 0, 0) scale(0.985);
}

.floating-shell-expanded-hidden.floating-shell-dragging {
  transform: translate3d(0, 18px, 0) scale(0.958);
}

.floating-shell-expanded::before,
.floating-shell-expanded::after,
.logo-orb::before,
.logo-orb::after {
  content: '';
  position: absolute;
  pointer-events: none;
}

.floating-shell-expanded::before {
  inset: 0;
  border-radius: inherit;
  background: var(--expanded-shell-before);
}

.floating-shell-expanded::after {
  inset: 1px;
  border-radius: calc(var(--widget-radius) - 1px);
  background: var(--expanded-shell-after);
  opacity: 0.7;
}

.logo-orb-hero {
  transition: var(--transition-logo-hero);
  will-change: transform, opacity, filter;
}

.logo-orb {
  border: 1px solid var(--collapsed-orb-border);
  background: var(--collapsed-orb-idle-bg);
}

.collapsed-layer-hidden .logo-orb-hero {
  opacity: 0;
  transform: translate3d(-134px, -82px, 0) scale(0.44);
  filter: blur(8px);
}

.widget-stage[data-motion='closing'] .collapsed-layer-hidden .logo-orb-hero {
  filter: none;
}

.logo-orb::before {
  inset: 6px;
  border-radius: 9999px;
}

.logo-orb::after {
  inset: 0;
  border-radius: inherit;
  background: var(--collapsed-orb-overlay);
}

.logo-orb-image {
  position: relative;
  z-index: 1;
  transition: var(--transition-logo);
}

.collapsed-layer-hidden .logo-orb-image {
  opacity: 0.42;
  transform: scale(0.9) rotate(-4deg);
}

.status-orb-busy {
  border-color: var(--collapsed-orb-busy-border);
  background: var(--collapsed-orb-busy-bg);
}

.status-orb-face {
  transition: var(--transition-status-face);
  will-change: opacity, transform, filter;
}

.status-orb-logo {
  opacity: 1;
  transform: scale(1);
  filter: blur(0);
}

.status-orb-active {
  opacity: 0;
  transform: scale(0.64) rotate(-12deg);
  filter: blur(10px);
}

.status-orb-busy .status-orb-logo {
  opacity: 0;
  transform: scale(0.54) rotate(-10deg);
  filter: blur(8px);
}

.status-orb-busy .status-orb-active {
  opacity: 1;
  transform: scale(1);
  filter: blur(0);
}

.status-orb-idle .status-orb-active .busy-orbit-ring {
  animation-play-state: paused;
}

.status-orb-logo-image {
  transition: var(--transition-status-logo);
}

.status-orb-busy .status-orb-logo-image {
  opacity: 0.4;
  transform: scale(0.88) rotate(-4deg);
  filter: var(--collapsed-logo-shadow-busy);
}

.status-orb-orbit-shell {
  border: 1px solid var(--collapsed-orbit-shell-border);
  background: var(--collapsed-orbit-shell-bg);
}

.status-orb-count-shell {
  border: 1px solid var(--collapsed-count-border);
  background: var(--collapsed-count-bg);
}

.status-orb-count {
  color: var(--collapsed-count-color);
}

.busy-orbit-ring {
  position: absolute;
  inset: 0;
  border-radius: 9999px;
  border: 1px solid rgba(74, 222, 128, 0.25);
  border-top-color: rgba(110, 231, 183, 0.95);
  animation: spin 1s linear infinite;
}

.busy-orbit-ring-delayed {
  inset: 5px;
  border-top-color: rgba(167, 243, 208, 0.85);
  animation-duration: 1.4s;
  animation-direction: reverse;
}

.status-orb-ring {
  border-color: rgba(74, 222, 128, 0.22);
  border-top-color: rgba(110, 231, 183, 0.95);
}

.status-orb-ring-inner {
  border-color: rgba(167, 243, 208, 0.16);
  border-top-color: rgba(167, 243, 208, 0.84);
}

.panel-header,
.panel-list,
.session-row {
  opacity: 1;
  transform: translate3d(0, 0, 0) scale(1);
  filter: blur(0);
}

.panel-header,
.panel-list {
  transition: var(--transition-panel);
}

.floating-shell-expanded-hidden .panel-header {
  opacity: 0;
  transform: translate3d(0, -10px, 0) scale(0.986);
  filter: blur(8px);
}

.widget-stage[data-motion='closing'] .floating-shell-expanded-hidden .panel-header {
  filter: none;
}

.floating-shell-expanded-hidden .panel-list {
  opacity: 0;
  transform: translate3d(0, 14px, 0) scale(0.992);
  filter: blur(10px);
}

.widget-stage[data-motion='closing'] .floating-shell-expanded-hidden .panel-list {
  filter: none;
}

.floating-shell-expanded-active .panel-header {
  transition-delay: 120ms;
}

.floating-shell-expanded-active .panel-list {
  transition-delay: 180ms;
}

.panel-close {
  color: var(--panel-close-color);
  border: 1px solid var(--panel-close-border);
  background: var(--panel-close-bg);
}

.panel-close:hover {
  color: var(--panel-close-hover-color);
  border-color: var(--panel-close-hover-border);
  background: var(--panel-close-hover-bg);
}

.panel-title {
  color: var(--panel-title-color);
}

.panel-meta {
  color: var(--panel-meta-color);
}

.live-chip {
  border: 1px solid var(--live-chip-border);
  background: var(--live-chip-bg);
  color: var(--live-chip-color);
}

.live-chip-dot {
  background: var(--live-chip-dot);
  animation: pulse-dot 1.6s ease-in-out infinite;
}

.empty-panel {
  color: var(--empty-panel-color);
  border: 1px solid var(--empty-panel-border);
  background: var(--empty-panel-bg);
}

.session-row {
  transition: var(--transition-session);
}

.floating-shell-expanded-hidden .session-row {
  opacity: 0;
  transform: translate3d(0, 14px, 0) scale(0.985);
  filter: blur(8px);
}

.widget-stage[data-motion='closing'] .floating-shell-expanded-hidden .session-row {
  filter: none;
}

.floating-shell-expanded-active .session-row {
  transition-delay: calc(150ms + var(--session-index, 0) * 55ms);
}

.panel-list {
  scrollbar-width: thin;
  scrollbar-color: var(--panel-scrollbar-thumb) transparent;
}

.panel-list::-webkit-scrollbar {
  width: 8px;
}

.panel-list::-webkit-scrollbar-thumb {
  border-radius: 9999px;
  background: var(--panel-scrollbar-thumb);
}

.panel-list::-webkit-scrollbar-track {
  background: transparent;
}

@keyframes pulse-dot {
  0%,
  100% {
    transform: scale(1);
    opacity: 1;
  }

  50% {
    transform: scale(0.78);
    opacity: 0.72;
  }
}

@keyframes spin {
  from {
    transform: rotate(0deg);
  }

  to {
    transform: rotate(360deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .collapsed-layer,
  .floating-shell,
  .panel-header,
  .panel-list,
  .session-row,
  .logo-orb-hero,
  .logo-orb-image {
    transition-duration: 1ms !important;
    transition-delay: 0ms !important;
    animation-duration: 1ms !important;
  }
}
</style>
