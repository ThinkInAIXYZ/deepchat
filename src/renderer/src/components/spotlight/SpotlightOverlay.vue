<template>
  <div
    v-if="spotlightStore.open"
    class="window-no-drag-region fixed inset-0 z-[70] flex items-start justify-center bg-black/35 px-4 pt-16"
    @mousedown.self="spotlightStore.closeSpotlight()"
  >
    <div
      class="window-no-drag-region flex w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl"
    >
      <div class="flex items-center gap-3 border-b border-border/60 px-4 py-3">
        <Icon icon="lucide:search" class="h-4 w-4 shrink-0 text-muted-foreground" />
        <Input
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
          <Button
            v-for="(item, index) in spotlightStore.results"
            :key="item.id"
            type="button"
            class="flex w-full cursor-pointer items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors"
            :class="
              index === spotlightStore.activeIndex
                ? 'bg-accent text-accent-foreground'
                : 'text-foreground/90 hover:bg-accent/60'
            "
            :data-spotlight-active="index === spotlightStore.activeIndex ? 'true' : undefined"
            @mouseenter="spotlightStore.setActiveItem(index)"
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
          </Button>
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
    spotlightStore.moveActiveItem(1)
    return
  }

  if (event.key === 'ArrowUp') {
    event.preventDefault()
    spotlightStore.moveActiveItem(-1)
    return
  }

  if (event.key === 'Home') {
    event.preventDefault()
    spotlightStore.setActiveItem(0)
    return
  }

  if (event.key === 'End') {
    event.preventDefault()
    spotlightStore.setActiveItem(spotlightStore.results.length - 1)
    return
  }

  if (event.key === 'Enter') {
    event.preventDefault()
    void spotlightStore.executeActiveItem()
  }
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
</style>
