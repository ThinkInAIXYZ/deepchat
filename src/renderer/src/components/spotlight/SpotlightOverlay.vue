<template>
  <Teleport to="body">
    <div
      v-if="spotlightStore.open"
      class="window-no-drag-region fixed inset-0 z-[90] flex items-start justify-center px-4 pt-16"
      @mousedown.self="spotlightStore.closeSpotlight()"
    >
      <div
        class="spotlight-panel window-no-drag-region flex w-full max-w-3xl flex-col overflow-hidden rounded-2xl backdrop-blur-[26px]"
      >
        <div class="flex items-center gap-3 border-b border-border/60 px-4 py-3">
          <Icon icon="lucide:search" class="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            ref="inputRef"
            :value="spotlightStore.query"
            class="h-9 w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
            :placeholder="t('chat.spotlight.placeholder')"
            @input="spotlightStore.setQuery(($event.target as HTMLInputElement).value)"
            @keydown="handleKeydown"
          />
        </div>

        <div ref="resultsContainerRef" class="max-h-[28rem] overflow-y-auto p-2">
          <template v-if="spotlightStore.results.length > 0">
            <button
              v-for="(item, index) in spotlightStore.results"
              :key="item.id"
              v-memo="[item, index === spotlightStore.activeIndex, spotlightStore.query]"
              type="button"
              class="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left"
              :class="
                index === spotlightStore.activeIndex
                  ? 'bg-accent text-accent-foreground'
                  : 'text-foreground/90'
              "
              :data-spotlight-active="index === spotlightStore.activeIndex ? 'true' : undefined"
              @mouseenter="handleItemMouseEnter(item)"
              @mousedown="handleItemMouseDown($event, item)"
              @click="handleItemClick(item)"
            >
              <span
                class="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-background"
              >
                <Icon :icon="item.icon" class="h-4 w-4 text-muted-foreground" />
              </span>

              <span class="min-w-0 flex-1">
                <span class="flex items-center gap-2">
                  <span class="truncate text-sm font-medium">
                    <template
                      v-for="(segment, segmentIndex) in highlightSegments(resolveItemTitle(item))"
                      :key="`${item.id}-title-${segmentIndex}`"
                    >
                      <mark v-if="segment.match" class="rounded bg-primary/15 px-0.5 text-inherit">
                        {{ segment.text }}
                      </mark>
                      <template v-else>{{ segment.text }}</template>
                    </template>
                  </span>
                  <span
                    class="shrink-0 rounded-full border border-border/70 px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground"
                  >
                    {{ t(`chat.spotlight.kind.${item.kind}`) }}
                  </span>
                </span>

                <span
                  v-if="item.subtitle"
                  class="mt-0.5 block truncate text-xs text-muted-foreground"
                >
                  {{ item.subtitle }}
                </span>
                <span
                  v-if="item.snippet"
                  class="mt-1 block line-clamp-2 text-xs text-muted-foreground"
                >
                  {{ item.snippet }}
                </span>
              </span>
            </button>
          </template>

          <div
            v-else
            class="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center text-muted-foreground"
          >
            <Icon
              :icon="spotlightStore.loading ? 'lucide:loader-circle' : 'lucide:search-x'"
              class="h-5 w-5"
              :class="{ 'animate-spin': spotlightStore.loading }"
            />
            <p class="text-sm font-medium">
              {{
                spotlightStore.loading
                  ? t('chat.spotlight.searching')
                  : t('chat.spotlight.emptyTitle')
              }}
            </p>
            <p class="text-xs">
              {{ t('chat.spotlight.emptyDescription') }}
            </p>
          </div>
        </div>

        <div class="border-t border-border/60 px-4 py-2 text-[11px] text-muted-foreground">
          {{ t('chat.spotlight.hints') }}
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { Icon } from '@iconify/vue'
import { nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useSpotlightStore, type SpotlightItem } from '@/stores/ui/spotlight'

const spotlightStore = useSpotlightStore()
const { t } = useI18n()
const inputRef = ref<HTMLInputElement | null>(null)
const resultsContainerRef = ref<HTMLElement | null>(null)
const pointerActivatedItemId = ref<string | null>(null)
let activeChangeSource: 'keyboard' | 'mouse' = 'keyboard'
let mouseEnterRaf = 0
let pendingMouseEnterId: string | number | null = null

const focusInput = () => {
  nextTick(() => {
    inputRef.value?.focus()
    inputRef.value?.select()
  })
}

const resolveItemTitle = (item: SpotlightItem): string => {
  if (item.title) {
    return item.title
  }

  if (item.titleKey) {
    return t(item.titleKey)
  }

  return ''
}

const highlightSegments = (value: string) => {
  const query = spotlightStore.query.trim()
  if (!query) {
    return [{ text: value, match: false }]
  }

  const lowerValue = value.toLowerCase()
  const lowerQuery = query.toLowerCase()
  const segments: Array<{ text: string; match: boolean }> = []
  let searchIndex = 0
  let matchIndex = lowerValue.indexOf(lowerQuery)

  while (matchIndex !== -1) {
    if (matchIndex > searchIndex) {
      segments.push({
        text: value.slice(searchIndex, matchIndex),
        match: false
      })
    }

    segments.push({
      text: value.slice(matchIndex, matchIndex + query.length),
      match: true
    })

    searchIndex = matchIndex + query.length
    matchIndex = lowerValue.indexOf(lowerQuery, searchIndex)
  }

  if (searchIndex < value.length) {
    segments.push({
      text: value.slice(searchIndex),
      match: false
    })
  }

  return segments.length > 0 ? segments : [{ text: value, match: false }]
}

const handleKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Escape') {
    event.preventDefault()
    spotlightStore.closeSpotlight()
    return
  }

  if (event.key === 'ArrowDown') {
    event.preventDefault()
    activeChangeSource = 'keyboard'
    spotlightStore.moveActiveItem(1)
    return
  }

  if (event.key === 'ArrowUp') {
    event.preventDefault()
    activeChangeSource = 'keyboard'
    spotlightStore.moveActiveItem(-1)
    return
  }

  if (event.key === 'Home') {
    event.preventDefault()
    activeChangeSource = 'keyboard'
    spotlightStore.setActiveItem(0)
    return
  }

  if (event.key === 'End') {
    event.preventDefault()
    activeChangeSource = 'keyboard'
    spotlightStore.setActiveItem(spotlightStore.results.length - 1)
    return
  }

  if (event.key === 'Enter') {
    event.preventDefault()
    void spotlightStore.executeActiveItem()
  }
}

const handleItemMouseEnter = (item: SpotlightItem) => {
  const currentIndex = spotlightStore.results.findIndex((r) => r.id === item.id)
  if (currentIndex === -1 || spotlightStore.activeIndex === currentIndex) {
    return
  }
  pendingMouseEnterId = item.id
  if (mouseEnterRaf !== 0) {
    return
  }
  mouseEnterRaf = window.requestAnimationFrame(() => {
    mouseEnterRaf = 0
    const targetId = pendingMouseEnterId
    pendingMouseEnterId = null
    if (targetId === null) {
      return
    }
    const foundItem = spotlightStore.results.find((r) => r.id === targetId)
    if (!foundItem) {
      return
    }
    const targetIndex = spotlightStore.results.findIndex((r) => r.id === targetId)
    if (targetIndex < 0 || spotlightStore.activeIndex === targetIndex) {
      return
    }
    activeChangeSource = 'mouse'
    spotlightStore.setActiveItem(targetIndex)
  })
}

const handleItemMouseDown = (event: MouseEvent, item: SpotlightItem) => {
  if (event.button !== 0) {
    return
  }

  event.preventDefault()
  pointerActivatedItemId.value = item.id
  void spotlightStore.executeItem(item)
  window.setTimeout(() => {
    if (pointerActivatedItemId.value === item.id) {
      pointerActivatedItemId.value = null
    }
  }, 0)
}

const handleItemClick = (item: SpotlightItem) => {
  if (pointerActivatedItemId.value === item.id) {
    pointerActivatedItemId.value = null
    return
  }

  void spotlightStore.executeItem(item)
}

watch(
  () => [spotlightStore.open, spotlightStore.activationKey] as const,
  ([isOpen]) => {
    if (isOpen) {
      focusInput()
    }
  }
)

watch(
  () => [spotlightStore.open, spotlightStore.activeIndex, spotlightStore.results.length] as const,
  ([isOpen, activeIndex, resultsLength]) => {
    if (!isOpen || activeIndex < 0 || activeIndex >= resultsLength) {
      return
    }

    if (activeChangeSource === 'mouse') {
      return
    }

    nextTick(() => {
      resultsContainerRef.value
        ?.querySelector<HTMLElement>('[data-spotlight-active="true"]')
        ?.scrollIntoView({
          block: 'nearest'
        })
    })
  }
)
</script>

<style scoped>
.window-no-drag-region {
  -webkit-app-region: no-drag;
}

button,
input {
  -webkit-app-region: no-drag;
}

.spotlight-panel {
  isolation: isolate;
  position: relative;
  border: 1px solid transparent;
  background: linear-gradient(
    180deg,
    color-mix(in srgb, white 95%, hsl(var(--background)) 5%) 0%,
    color-mix(in srgb, white 88%, hsl(var(--background)) 12%) 100%
  );
  box-shadow:
    0 32px 64px -24px rgb(15 23 42 / 0.28),
    0 16px 32px -16px rgb(15 23 42 / 0.12),
    inset 0 1px 0 rgb(255 255 255 / 0.48),
    inset 0 -12px 24px -20px rgb(148 163 184 / 0.18);
}

.spotlight-panel::before {
  content: '';
  position: absolute;
  inset: 1px;
  z-index: 0;
  border-radius: inherit;
  pointer-events: none;
  background:
    linear-gradient(
      160deg,
      rgb(255 255 255 / 0.64) 0%,
      transparent 38%,
      rgb(255 255 255 / 0.14) 100%
    ),
    linear-gradient(
      180deg,
      color-mix(in srgb, white 97%, hsl(var(--background)) 3%) 0%,
      color-mix(in srgb, white 90%, hsl(var(--muted)) 10%) 100%
    );
  opacity: 0.98;
}

.spotlight-panel::after {
  content: '';
  position: absolute;
  inset: 0;
  z-index: 2;
  border-radius: inherit;
  pointer-events: none;
  box-shadow:
    inset 0 0 0 1px color-mix(in srgb, white 26%, hsl(var(--border)) 74%),
    inset 0 1px 0 rgb(255 255 255 / 0.28);
  opacity: 0.84;
}

.spotlight-panel > * {
  position: relative;
  z-index: 3;
}

.dark .spotlight-panel {
  border-color: transparent;
  background: linear-gradient(
    180deg,
    color-mix(in srgb, hsl(var(--background)) 96%, rgb(51 65 85) 4%) 0%,
    color-mix(in srgb, hsl(var(--background)) 98%, rgb(15 23 42) 2%) 100%
  );
  box-shadow:
    0 32px 64px -28px rgb(0 0 0 / 0.56),
    0 16px 32px -20px rgb(0 0 0 / 0.32),
    inset 0 1px 0 rgb(255 255 255 / 0.08),
    inset 0 -14px 28px -22px rgb(0 0 0 / 0.4);
}

.dark .spotlight-panel::before {
  background:
    linear-gradient(
      160deg,
      rgb(255 255 255 / 0.1) 0%,
      transparent 40%,
      rgb(255 255 255 / 0.03) 100%
    ),
    linear-gradient(
      180deg,
      color-mix(in srgb, hsl(var(--background)) 94%, rgb(30 41 59) 6%) 0%,
      color-mix(in srgb, hsl(var(--background)) 97%, rgb(2 6 23) 3%) 100%
    );
  opacity: 0.97;
}

.dark .spotlight-panel::after {
  box-shadow:
    inset 0 0 0 1px color-mix(in srgb, white 9%, hsl(var(--border)) 91%),
    inset 0 1px 0 rgb(255 255 255 / 0.08);
  opacity: 0.88;
}
</style>
