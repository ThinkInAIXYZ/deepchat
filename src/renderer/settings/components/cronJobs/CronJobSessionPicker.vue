<template>
  <Popover v-model:open="open">
    <PopoverTrigger as-child>
      <button
        ref="triggerRef"
        type="button"
        role="combobox"
        data-testid="cron-job-reuse-session-select"
        :aria-label="label"
        :aria-expanded="open"
        :aria-controls="listboxId"
        :disabled="disabled"
        class="flex h-9 w-full min-w-0 items-center justify-between gap-2 rounded-md border px-3 py-2 text-left text-sm shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
        :class="
          isUnavailable
            ? 'border-destructive/50 bg-destructive/5 text-destructive hover:bg-destructive/10'
            : 'border-input bg-transparent text-foreground hover:bg-muted/40 dark:bg-input/30 dark:hover:bg-input/50'
        "
        @keydown="onTriggerKeydown"
      >
        <span class="flex min-w-0 flex-1 items-center gap-2">
          <Icon
            :icon="triggerIcon"
            class="size-3.5 shrink-0"
            :class="[
              isUnavailable ? 'text-destructive' : 'text-muted-foreground',
              isResolvingSelection ? 'animate-spin' : ''
            ]"
          />
          <span class="min-w-0 truncate">{{ triggerLabel }}</span>
        </span>
        <Icon icon="lucide:chevrons-up-down" class="size-3.5 shrink-0 text-muted-foreground" />
      </button>
    </PopoverTrigger>

    <PopoverContent
      align="start"
      class="w-(--reka-popover-trigger-width) min-w-[300px] p-0"
      @escape-key-down="onEscapeKeyDown"
    >
      <div class="flex h-9 items-center gap-2 border-b border-border px-2.5">
        <Icon icon="lucide:search" class="size-3.5 shrink-0 text-muted-foreground" />
        <input
          ref="searchInputRef"
          v-model="searchInput"
          type="text"
          role="combobox"
          aria-autocomplete="list"
          :aria-expanded="open"
          maxlength="200"
          data-testid="cron-job-reuse-session-search"
          class="h-full min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
          :placeholder="t('settings.cronJobs.fields.searchSessionPlaceholder')"
          :aria-label="t('settings.cronJobs.fields.searchSessionPlaceholder')"
          :aria-controls="listboxId"
          :aria-activedescendant="activeOptionId"
          autocomplete="off"
          spellcheck="false"
          @compositionstart="isComposing = true"
          @compositionend="isComposing = false"
          @keydown="onSearchKeydown"
        />
        <Icon
          v-if="isSearchPending"
          icon="lucide:loader-circle"
          class="size-3.5 shrink-0 animate-spin text-muted-foreground"
        />
        <button
          v-else-if="searchInput.length > 0"
          type="button"
          data-testid="cron-job-reuse-session-search-clear"
          class="inline-flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          :aria-label="t('settings.cronJobs.fields.clearSessionSearch')"
          @click="clearSearch"
        >
          <Icon icon="lucide:x" class="size-3.5" />
        </button>
      </div>

      <div class="max-h-[280px] overflow-y-auto p-1">
        <div :id="listboxId" role="listbox" :aria-label="label">
          <template v-if="!hasActiveQuery">
            <button
              :id="optionDomId(AUTO_OPTION_KEY)"
              type="button"
              role="option"
              tabindex="-1"
              data-testid="cron-job-reuse-session-option-auto"
              :aria-selected="modelValue === null"
              class="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors outline-none hover:bg-accent"
              :class="{
                'bg-accent': activeOptionKey === AUTO_OPTION_KEY,
                'bg-accent/60 font-medium':
                  modelValue === null && activeOptionKey !== AUTO_OPTION_KEY
              }"
              @click="selectValue(null)"
              @mouseenter="activeOptionKey = AUTO_OPTION_KEY"
            >
              <span class="flex min-w-0 items-center gap-2">
                <Icon icon="lucide:sparkles" class="size-3.5 shrink-0 text-muted-foreground" />
                <span class="truncate">{{
                  t('settings.cronJobs.fields.createSessionOnFirstRun')
                }}</span>
              </span>
              <Icon
                v-if="modelValue === null"
                icon="lucide:check"
                class="size-3.5 shrink-0 text-primary"
              />
            </button>

            <button
              v-if="isUnavailable && modelValue"
              :id="optionDomId(UNAVAILABLE_OPTION_KEY)"
              type="button"
              role="option"
              tabindex="-1"
              data-testid="cron-job-reuse-session-option-unavailable"
              aria-selected="true"
              class="mt-0.5 flex w-full items-start justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm text-destructive transition-colors outline-none hover:bg-accent"
              :class="{
                'bg-accent': activeOptionKey === UNAVAILABLE_OPTION_KEY,
                'bg-destructive/5': activeOptionKey !== UNAVAILABLE_OPTION_KEY
              }"
              @click="selectValue(modelValue)"
              @mouseenter="activeOptionKey = UNAVAILABLE_OPTION_KEY"
            >
              <span class="min-w-0 flex-1">
                <span class="flex items-center gap-2">
                  <Icon icon="lucide:triangle-alert" class="size-3.5 shrink-0 text-destructive" />
                  <span class="truncate font-medium">
                    {{ t('settings.cronJobs.fields.sessionUnavailable') }}
                  </span>
                </span>
                <span
                  class="mt-0.5 block truncate pl-5.5 font-mono text-[11px] text-destructive/80"
                >
                  {{ formatShortId(modelValue) }}
                </span>
              </span>
              <Icon icon="lucide:check" class="mt-0.5 size-3.5 shrink-0 text-destructive" />
            </button>

            <div role="separator" class="mx-1.5 my-1 h-px bg-border" />
          </template>

          <button
            v-for="session in displayedSessions"
            :id="optionDomId(sessionOptionKey(session.id))"
            :key="session.id"
            type="button"
            role="option"
            tabindex="-1"
            :data-testid="`cron-job-reuse-session-option-${session.id}`"
            :aria-selected="modelValue === session.id"
            class="flex w-full items-start justify-between gap-2 rounded-md px-2 py-1.5 text-left transition-colors outline-none hover:bg-accent"
            :class="{
              'bg-accent': activeOptionKey === sessionOptionKey(session.id),
              'bg-accent/60':
                modelValue === session.id && activeOptionKey !== sessionOptionKey(session.id)
            }"
            @click="selectValue(session.id)"
            @mouseenter="activeOptionKey = sessionOptionKey(session.id)"
          >
            <span class="min-w-0 flex-1">
              <span class="flex items-center gap-2">
                <Icon
                  :icon="session.isPinned ? 'lucide:pin' : 'lucide:message-square'"
                  class="size-3.5 shrink-0 text-muted-foreground"
                />
                <span
                  class="min-w-0 truncate text-sm leading-snug"
                  :class="modelValue === session.id ? 'font-medium' : ''"
                >
                  <template
                    v-for="(part, partIndex) in splitHighlight(
                      session.title || session.id,
                      activeQuery
                    )"
                    :key="partIndex"
                  >
                    <mark
                      v-if="part.match"
                      class="rounded-[2px] bg-primary/15 px-0.5 text-foreground"
                    >
                      {{ part.text }}
                    </mark>
                    <template v-else>{{ part.text }}</template>
                  </template>
                </span>
              </span>
              <span
                class="mt-0.5 flex items-center gap-2 pl-5.5 text-[11px] leading-tight text-muted-foreground"
              >
                <span class="shrink-0">{{ formatRelativeTime(session.updatedAt) }}</span>
                <span
                  v-if="extractDirName(session.projectDir)"
                  :title="session.projectDir ?? undefined"
                  class="inline-flex min-w-0 items-center gap-1 truncate"
                >
                  <Icon icon="lucide:folder" class="size-3 shrink-0" />
                  <span class="truncate">
                    <template
                      v-for="(part, partIndex) in splitHighlight(
                        extractDirName(session.projectDir),
                        activeQuery
                      )"
                      :key="partIndex"
                    >
                      <mark
                        v-if="part.match"
                        class="rounded-[2px] bg-primary/15 px-0.5 text-foreground"
                      >
                        {{ part.text }}
                      </mark>
                      <template v-else>{{ part.text }}</template>
                    </template>
                  </span>
                </span>
              </span>
            </span>
            <Icon
              v-if="modelValue === session.id"
              icon="lucide:check"
              class="mt-0.5 size-3.5 shrink-0 text-primary"
            />
          </button>
        </div>

        <div
          v-if="isSearchPending && displayedSessions.length === 0"
          class="flex items-center justify-center gap-2 px-3 py-5 text-xs text-muted-foreground"
        >
          <Icon icon="lucide:loader-circle" class="size-3.5 animate-spin" />
          <span>{{ t('common.loading') }}</span>
        </div>

        <div
          v-else-if="loadFailed && displayedSessions.length === 0"
          role="alert"
          class="flex flex-col items-center gap-1.5 px-3 py-5 text-center text-xs text-destructive"
        >
          <span>{{ t('common.error.requestFailed') }}</span>
          <button
            type="button"
            data-testid="cron-job-reuse-session-retry"
            class="text-xs font-medium text-primary hover:underline"
            @click="emit('retry')"
          >
            {{ t('common.retry') }}
          </button>
        </div>

        <div
          v-else-if="displayedSessions.length === 0 && !hasMore"
          class="flex flex-col items-center gap-1.5 px-3 py-5 text-center text-xs text-muted-foreground"
        >
          <span>
            {{
              hasActiveQuery
                ? t('settings.cronJobs.fields.noMatchingSessions', { query: activeQuery })
                : t('settings.cronJobs.fields.noReusableSessions')
            }}
          </span>
          <button
            v-if="hasActiveQuery"
            type="button"
            class="text-xs font-medium text-primary hover:underline"
            @click="clearSearch"
          >
            {{ t('settings.cronJobs.fields.clearSessionSearch') }}
          </button>
        </div>

        <div
          v-else-if="loadFailed && displayedSessions.length > 0"
          role="alert"
          class="mt-1 flex items-center justify-center gap-2 px-2 py-1.5 text-xs text-destructive"
        >
          <span>{{ t('common.error.requestFailed') }}</span>
          <button
            type="button"
            data-testid="cron-job-reuse-session-retry"
            class="text-xs font-medium text-primary hover:underline"
            @click="emit('retry')"
          >
            {{ t('common.retry') }}
          </button>
        </div>

        <div v-else-if="hasMore" class="pt-1">
          <button
            type="button"
            data-testid="cron-job-reuse-session-load-more"
            :disabled="loadingMore || loading"
            class="flex h-8 w-full items-center justify-center gap-1.5 rounded-md text-xs font-medium text-primary transition-colors outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
            @click="emit('loadMore')"
          >
            <Icon v-if="loadingMore" icon="lucide:loader-circle" class="size-3.5 animate-spin" />
            <span>
              {{
                loadingMore ? t('common.loading') : t('settings.cronJobs.fields.loadMoreSessions')
              }}
            </span>
          </button>
        </div>
      </div>
    </PopoverContent>
  </Popover>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { Popover, PopoverContent, PopoverTrigger } from '@shadcn/components/ui/popover'
import type { SessionListItem } from '@shared/types/agent-interface'
import { formatRelativeTime as formatSharedRelativeTime } from '../memoryRedesignUtils'

const SEARCH_DEBOUNCE_MS = 200

const props = defineProps<{
  modelValue: string | null
  label: string
  disabled: boolean
  noAgent?: boolean
  sessions: SessionListItem[]
  selectedSession: SessionListItem | null | undefined
  query: string
  loading: boolean
  loadingMore: boolean
  hasMore: boolean
  loadFailed: boolean
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: string | null): void
  (e: 'openChange', open: boolean): void
  (e: 'search', query: string): void
  (e: 'loadMore'): void
  (e: 'retry'): void
}>()

const { t, locale } = useI18n()
const listboxId = `cron-session-listbox-${useId()}`

const AUTO_OPTION_KEY = 'auto'
const UNAVAILABLE_OPTION_KEY = 'unavailable'
const sessionOptionKey = (sessionId: string) => `session:${sessionId}`

const open = ref(false)
const searchInput = ref(props.query)
const isComposing = ref(false)
const activeOptionKey = ref<string | null>(null)
const triggerRef = ref<HTMLButtonElement | null>(null)
const searchInputRef = ref<HTMLInputElement | null>(null)
let searchTimer: number | null = null

const optionDomId = (key: string) => `${listboxId}-${key}`
const activeOptionId = computed(() =>
  activeOptionKey.value &&
  selectableOptions.value.some((option) => option.key === activeOptionKey.value)
    ? optionDomId(activeOptionKey.value)
    : undefined
)

const trimmedSearchInput = computed(() => searchInput.value.trim())
const activeQuery = computed(() => props.query.trim())
const hasActiveQuery = computed(() => activeQuery.value.length > 0)
const isSearchPending = computed(
  () => props.loading || trimmedSearchInput.value !== activeQuery.value
)

const isUnavailable = computed(() => Boolean(props.modelValue) && props.selectedSession === null)
const isResolvingSelection = computed(
  () => Boolean(props.modelValue) && props.selectedSession === undefined
)

const triggerIcon = computed(() => {
  if (props.noAgent) {
    return 'lucide:ban'
  }
  if (!props.modelValue) {
    return 'lucide:sparkles'
  }
  if (isResolvingSelection.value) {
    return 'lucide:loader-circle'
  }
  if (isUnavailable.value) {
    return 'lucide:triangle-alert'
  }
  return 'lucide:message-square'
})

const triggerLabel = computed(() => {
  if (props.noAgent) {
    return t('settings.cronJobs.fields.noAgent')
  }
  if (!props.modelValue) {
    return t('settings.cronJobs.fields.createSessionOnFirstRun')
  }
  if (isResolvingSelection.value) {
    return t('common.loading')
  }
  if (isUnavailable.value) {
    return t('settings.cronJobs.fields.sessionUnavailable')
  }
  return props.selectedSession?.title || props.modelValue
})

const displayedSessions = computed(() => {
  if (hasActiveQuery.value || !props.modelValue) {
    return props.sessions
  }
  const selectedId = props.modelValue
  const selectedFromList = props.sessions.find((session) => session.id === selectedId)
  const selected = selectedFromList ?? props.selectedSession ?? null
  if (!selected) {
    return props.sessions
  }
  return [selected, ...props.sessions.filter((session) => session.id !== selectedId)]
})

const selectableOptions = computed<Array<{ key: string; value: string | null }>>(() => {
  const options: Array<{ key: string; value: string | null }> = []
  if (!hasActiveQuery.value) {
    options.push({ key: AUTO_OPTION_KEY, value: null })
    if (isUnavailable.value && props.modelValue) {
      options.push({ key: UNAVAILABLE_OPTION_KEY, value: props.modelValue })
    }
  }
  for (const session of displayedSessions.value) {
    options.push({ key: sessionOptionKey(session.id), value: session.id })
  }
  return options
})

const cancelPendingSearch = () => {
  if (searchTimer !== null) {
    window.clearTimeout(searchTimer)
    searchTimer = null
  }
}

const emitSearchNow = (nextQuery: string) => {
  cancelPendingSearch()
  if (nextQuery !== props.query) {
    emit('search', nextQuery)
  }
}

const clearSearch = () => {
  searchInput.value = ''
  activeOptionKey.value = null
  emitSearchNow('')
  void nextTick(() => searchInputRef.value?.focus())
}

const selectValue = (value: string | null) => {
  emit('update:modelValue', value)
  open.value = false
  void nextTick(() => triggerRef.value?.focus())
}

const scrollActiveOptionIntoView = () => {
  void nextTick(() => {
    const id = activeOptionId.value
    if (!id) {
      return
    }
    const el = document.getElementById(id)
    el?.scrollIntoView?.({ block: 'nearest' })
  })
}

const onTriggerKeydown = (event: KeyboardEvent) => {
  if (props.disabled) {
    return
  }
  if (!open.value && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
    event.preventDefault()
    open.value = true
  }
}

const onEscapeKeyDown = (event: KeyboardEvent) => {
  if (event.isComposing || isComposing.value) {
    event.preventDefault()
  }
}

const onSearchKeydown = (event: KeyboardEvent) => {
  if (event.isComposing || isComposing.value || event.keyCode === 229) {
    return
  }
  if (isSearchPending.value) {
    return
  }
  const options = selectableOptions.value
  const currentIndex = activeOptionKey.value
    ? options.findIndex((option) => option.key === activeOptionKey.value)
    : -1
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    if (options.length > 0) {
      const nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % options.length
      activeOptionKey.value = options[nextIndex].key
      scrollActiveOptionIntoView()
    }
    return
  }
  if (event.key === 'ArrowUp') {
    event.preventDefault()
    if (options.length > 0) {
      const nextIndex = currentIndex <= 0 ? options.length - 1 : currentIndex - 1
      activeOptionKey.value = options[nextIndex].key
      scrollActiveOptionIntoView()
    }
    return
  }
  if (event.key === 'Enter' && currentIndex >= 0) {
    event.preventDefault()
    selectValue(options[currentIndex].value)
  }
}

const splitHighlight = (text: string, query: string): Array<{ text: string; match: boolean }> => {
  const foldedQuery = query.toLowerCase().toUpperCase()
  if (!foldedQuery) {
    return [{ text, match: false }]
  }
  let foldedText = ''
  const codePointStarts: number[] = []
  for (let offset = 0; offset < text.length; ) {
    const codePoint = text.codePointAt(offset)!
    const char = String.fromCodePoint(codePoint)
    const foldedChar = char.toLowerCase().toUpperCase()
    for (let i = 0; i < foldedChar.length; i++) {
      codePointStarts.push(offset)
    }
    foldedText += foldedChar
    offset += char.length
  }
  const matchIndex = foldedText.indexOf(foldedQuery)
  if (matchIndex === -1) {
    return [{ text, match: false }]
  }
  const origStart = codePointStarts[matchIndex] ?? 0
  const lastMatchedFoldIdx = matchIndex + foldedQuery.length - 1
  const lastMatchedOrigStart = codePointStarts[lastMatchedFoldIdx] ?? origStart
  const lastCodePoint = text.codePointAt(lastMatchedOrigStart)
  const origEnd = lastMatchedOrigStart + (lastCodePoint && lastCodePoint > 0xffff ? 2 : 1)
  const parts: Array<{ text: string; match: boolean }> = []
  if (origStart > 0) {
    parts.push({ text: text.slice(0, origStart), match: false })
  }
  parts.push({ text: text.slice(origStart, origEnd), match: true })
  if (origEnd < text.length) {
    parts.push({ text: text.slice(origEnd), match: false })
  }
  return parts
}

const extractDirName = (projectDir: string | null | undefined): string => {
  if (!projectDir) {
    return ''
  }
  const trimmed = projectDir.replace(/[\\/]+$/, '')
  if (!trimmed) {
    return ''
  }
  const parts = trimmed.split(/[\\/]/)
  return parts.at(-1) ?? ''
}

const formatShortId = (id: string): string => (id.length > 10 ? `#${id.slice(-8)}` : `#${id}`)

const formatRelativeTime = (timestamp: number): string => {
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return ''
  }
  const activeLocale = locale?.value || 'en-US'
  try {
    if (Math.abs(timestamp - Date.now()) > 30 * 86_400_000) {
      return new Date(timestamp).toLocaleDateString(activeLocale)
    }
    return formatSharedRelativeTime(timestamp, activeLocale)
  } catch {
    return new Date(timestamp).toLocaleString()
  }
}

watch(searchInput, (value) => {
  if (!open.value) {
    return
  }
  activeOptionKey.value = null
  cancelPendingSearch()
  const normalized = value.trim()
  if (normalized === props.query) {
    return
  }
  searchTimer = window.setTimeout(() => {
    searchTimer = null
    emit('search', normalized)
  }, SEARCH_DEBOUNCE_MS)
})

watch(
  () => props.query,
  (nextQuery) => {
    if (!open.value && searchInput.value !== nextQuery) {
      searchInput.value = nextQuery
    }
  }
)

watch(open, (isOpen) => {
  emit('openChange', isOpen)
  activeOptionKey.value = null
  if (isOpen) {
    void nextTick(() => searchInputRef.value?.focus())
    return
  }
  isComposing.value = false
  cancelPendingSearch()
  if (searchInput.value !== '' || props.query !== '') {
    searchInput.value = ''
    emitSearchNow('')
  }
})

watch(selectableOptions, (options) => {
  if (activeOptionKey.value && !options.some((option) => option.key === activeOptionKey.value)) {
    activeOptionKey.value = null
  }
})

onBeforeUnmount(() => {
  cancelPendingSearch()
})
</script>
