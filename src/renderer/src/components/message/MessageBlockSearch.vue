<template>
  <div data-testid="message-block-search" class="w-full min-w-0 text-xs leading-5">
    <div class="flex min-h-7 min-w-0 items-start gap-2 text-muted-foreground">
      <Icon
        :icon="statusIcon"
        class="mt-[3px] h-3.5 w-3.5 shrink-0"
        :class="isBusy ? 'animate-spin' : ''"
      />
      <a
        v-if="actionUrl && actionType !== 'find_in_page'"
        data-testid="search-action-link"
        :href="actionUrl"
        class="min-w-0 flex-1 break-words text-foreground/80 underline-offset-2 hover:underline"
        @click.prevent="openUrl(actionUrl, $event)"
      >
        {{ displayTarget }}
      </a>
      <span
        v-else
        data-testid="search-action-text"
        class="min-w-0 flex-1 break-words text-foreground/80"
      >
        {{ displayTarget }}
      </span>
      <a
        v-if="actionType === 'find_in_page' && actionUrl"
        data-testid="search-find-page-link"
        :href="actionUrl"
        :title="actionUrl"
        class="inline-flex max-w-[40%] shrink-0 items-center gap-1 truncate text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        @click.prevent="openUrl(actionUrl, $event)"
      >
        <Icon icon="lucide:external-link" class="h-3 w-3 shrink-0" />
        <span class="truncate">{{ actionHostname }}</span>
      </a>
      <span v-if="statusText" class="max-w-[45%] shrink-0 truncate text-muted-foreground/80">
        {{ statusText }}
      </span>
    </div>

    <div v-if="pages.length > 0" class="ml-[22px] flex min-w-0 flex-col gap-0.5">
      <a
        v-for="page in pages"
        :key="page.url"
        data-testid="search-source-link"
        :href="page.url"
        class="-mx-1.5 flex min-w-0 items-center gap-2 rounded-sm px-1.5 py-0.5 text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
        @click.prevent="openUrl(page.url, $event)"
      >
        <Icon icon="lucide:external-link" class="h-3 w-3 shrink-0" />
        <span class="min-w-0 flex-1 truncate">{{ page.title }}</span>
        <span class="max-w-[40%] shrink-0 truncate text-muted-foreground/70">
          {{ page.hostname }}
        </span>
      </a>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Icon } from '@iconify/vue'
import { useI18n } from 'vue-i18n'
import type { DisplayAssistantMessageBlock } from '@/features/chat-page/model/displayMessage'
import { useMarkdownLinkNavigation } from '@/components/markdown/useMarkdownLinkNavigation'

const props = defineProps<{
  block: DisplayAssistantMessageBlock
  threadId: string
}>()

const { t } = useI18n()
const { navigateLink } = useMarkdownLinkNavigation({
  linkContext: () => ({ source: 'chat', sessionId: props.threadId })
})

type SearchPage = {
  title: string
  url: string
  hostname: string
}

type SearchActionType = 'search' | 'open_page' | 'find_in_page'

const MAX_UI_URL_LENGTH = 8192

const normalizeHttpUrl = (value: unknown): URL | null => {
  if (typeof value !== 'string' || value.length > MAX_UI_URL_LENGTH) return null
  try {
    const url = new URL(value)
    if (
      (url.protocol !== 'http:' && url.protocol !== 'https:') ||
      url.username ||
      url.password ||
      url.href.length > MAX_UI_URL_LENGTH
    ) {
      return null
    }
    return url
  } catch {
    return null
  }
}

const rawExtra = computed<Record<string, unknown>>(
  () => (props.block.extra ?? {}) as Record<string, unknown>
)

const actionType = computed<SearchActionType>(() => {
  const value = rawExtra.value.actionType
  return value === 'open_page' || value === 'find_in_page' ? value : 'search'
})

const actionUrl = computed(() => normalizeHttpUrl(rawExtra.value.actionUrl)?.href ?? '')
const actionHostname = computed(
  () => normalizeHttpUrl(rawExtra.value.actionUrl)?.hostname.replace(/^www\./, '') ?? ''
)

const displayTarget = computed(() => {
  const target = typeof props.block.content === 'string' ? props.block.content.trim() : ''
  return target.slice(0, 2048) || t('chat.features.webSearch')
})

const pages = computed<SearchPage[]>(() => {
  const rawPages = rawExtra.value.pages
  if (!Array.isArray(rawPages)) return []

  const seen = new Set<string>()
  const normalized: SearchPage[] = []
  for (const value of rawPages) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue
    const page = value as Record<string, unknown>
    const url = normalizeHttpUrl(page.url)
    if (!url || seen.has(url.href) || url.href === actionUrl.value) continue
    seen.add(url.href)
    normalized.push({
      title:
        typeof page.title === 'string' && page.title.trim()
          ? page.title.trim().slice(0, 512)
          : url.hostname,
      url: url.href,
      hostname: url.hostname.replace(/^www\./, '')
    })
    if (normalized.length >= 6) break
  }
  return normalized
})

const resultCount = computed(() => {
  const value = rawExtra.value.total
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
})

const isBusy = computed(() =>
  ['loading', 'pending', 'optimizing', 'reading'].includes(props.block.status)
)

const statusIcon = computed(() => {
  if (props.block.status === 'error') return 'lucide:circle-alert'
  if (isBusy.value) return 'lucide:loader-circle'
  if (actionType.value === 'open_page') return 'lucide:external-link'
  if (actionType.value === 'find_in_page') return 'lucide:search'
  return 'lucide:globe-2'
})

const statusText = computed(() => {
  if (props.block.status === 'error') return t('chat.search.error')
  if (props.block.status === 'optimizing') return t('chat.search.optimizing')
  if (props.block.status === 'reading') return t('chat.search.reading')
  if (props.block.status === 'loading' || props.block.status === 'pending') {
    return t('chat.search.searching')
  }
  return resultCount.value > 0 ? t('chat.search.results', [resultCount.value]) : ''
})

const openUrl = (url: string, event: MouseEvent): void => {
  void navigateLink(url, event)
}
</script>
