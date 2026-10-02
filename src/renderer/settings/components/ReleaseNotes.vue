<template>
  <section
    :aria-label="t('update.releaseNotes')"
    tabindex="0"
    class="release-notes prose prose-sm max-h-72 min-w-0 max-w-none overflow-auto overscroll-contain rounded-sm pr-3 text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring dark:prose-invert"
    @click="openReleaseLink"
    @auxclick="openReleaseLink"
  >
    <NodeRenderer
      :content="content"
      :is-dark="themeStore.isDark"
      mode="minimal"
      :final="true"
      :smooth-streaming="false"
      :batch-rendering="false"
      :defer-nodes-until-visible="false"
      :render-code-blocks-as-pre="true"
      html-policy="safe"
    />
  </section>
</template>

<script setup lang="ts">
import { createBrowserClient } from '@api/BrowserClient'
import { useThemeStore } from '@/stores/theme'
import NodeRenderer from 'markstream-vue'
import { useI18n } from 'vue-i18n'

const props = defineProps<{
  content: string
  releaseUrl?: string
}>()

const { t } = useI18n()
const themeStore = useThemeStore()
const browserClient = createBrowserClient()

const openReleaseLink = (event: MouseEvent) => {
  if (event.button > 1 || !(event.target instanceof Element)) return
  const anchor = event.target.closest('a[href]')
  if (!anchor) return

  // Atom HTML and Markdown links must use the same native navigation boundary.
  // Relative links belong to the release page, never to the Electron app origin.
  event.preventDefault()
  let url: URL
  try {
    url = new URL(anchor.getAttribute('href') ?? '', props.releaseUrl)
  } catch {
    return
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return

  void browserClient.openExternal(url.href).catch((error) => {
    console.warn('[ReleaseNotes] Failed to open release link', error)
  })
}
</script>

<style scoped>
@reference '../../src/assets/style.css';

.release-notes {
  overflow-wrap: anywhere;
  --tw-prose-headings: var(--foreground);
  --tw-prose-links: var(--primary);
  --tw-prose-bold: var(--foreground);
  --tw-prose-counters: var(--muted-foreground);
  --tw-prose-bullets: var(--muted-foreground);
}

.release-notes :deep(.markstream-vue) {
  font-size: inherit;
  line-height: inherit;
}

.release-notes :deep(h1),
.release-notes :deep(h2) {
  @apply my-3 text-base font-semibold;
}

.release-notes :deep(h3),
.release-notes :deep(h4),
.release-notes :deep(h5),
.release-notes :deep(h6) {
  @apply my-2 text-sm font-semibold;
}

.release-notes :deep(p),
.release-notes :deep(ul),
.release-notes :deep(ol) {
  @apply my-2;
}

.release-notes :deep(li) {
  @apply my-1;
}

.release-notes :deep(li > p) {
  @apply my-0;
}

.release-notes :deep(a:focus-visible) {
  @apply rounded-sm outline-2 outline-offset-2 outline-ring;
}
</style>
