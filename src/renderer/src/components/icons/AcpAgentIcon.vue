<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { usePresenter } from '@/composables/usePresenter'

const ACP_REGISTRY_ICON_PREFIX = 'https://cdn.agentclientprotocol.com/registry/'

const iconMarkupCache = new Map<string, string | Promise<string>>()

const props = withDefaults(
  defineProps<{
    agentId?: string
    icon?: string
    alt?: string
    customClass?: string
    tone?: 'default' | 'muted'
    fallbackText?: string
  }>(),
  {
    agentId: '',
    icon: '',
    alt: '',
    customClass: 'w-4 h-4',
    tone: 'default',
    fallbackText: ''
  }
)

const svgMarkup = ref('')
const imageLoadFailed = ref(false)
const requestSeq = ref(0)
const configPresenter = usePresenter('configPresenter')

const isThemeableRegistryIcon = computed(() => {
  const icon = props.icon.trim()
  return icon.startsWith(ACP_REGISTRY_ICON_PREFIX) && icon.endsWith('.svg')
})

const fallbackLabel = computed(() => {
  const value = props.fallbackText.trim()
  return value ? value.slice(0, 1).toUpperCase() : '?'
})

const toneClass = computed(() =>
  props.tone === 'muted' ? 'text-muted-foreground' : 'text-foreground'
)

const shouldRenderInlineSvg = computed(
  () => Boolean(svgMarkup.value) && isThemeableRegistryIcon.value
)

const shouldRenderImage = computed(
  () => Boolean(props.icon.trim()) && !shouldRenderInlineSvg.value && !isThemeableRegistryIcon.value
)

const normalizeSvgMarkup = (markup: string): string => {
  const trimmed = markup.trim()
  if (!trimmed.startsWith('<svg')) {
    throw new Error('Invalid ACP registry icon markup')
  }
  return trimmed
}

const loadSvgMarkup = async () => {
  const icon = props.icon.trim()
  const agentId = props.agentId.trim()
  const seq = ++requestSeq.value
  svgMarkup.value = ''
  imageLoadFailed.value = false

  if (!icon || !agentId || !isThemeableRegistryIcon.value) {
    return
  }

  try {
    const cacheKey = `${agentId}:${icon}`
    const cached = iconMarkupCache.get(cacheKey)
    if (typeof cached === 'string') {
      if (seq === requestSeq.value) {
        svgMarkup.value = cached
      }
      return
    }

    let pending = cached
    if (!pending) {
      pending = configPresenter
        .getAcpRegistryIconMarkup(agentId, icon)
        .then((markup) => {
          const normalized = markup ? normalizeSvgMarkup(markup) : ''
          if (normalized) {
            iconMarkupCache.set(cacheKey, normalized)
          } else {
            iconMarkupCache.delete(cacheKey)
          }
          return normalized
        })
        .catch((error) => {
          iconMarkupCache.delete(cacheKey)
          throw error
        })

      iconMarkupCache.set(cacheKey, pending)
    }

    const markup = await pending
    if (seq !== requestSeq.value) {
      return
    }
    svgMarkup.value = markup
  } catch (error) {
    if (seq !== requestSeq.value) {
      return
    }
    console.warn('[ACP] Failed to load themed registry icon:', error)
    svgMarkup.value = ''
  }
}

const handleImageError = () => {
  imageLoadFailed.value = true
}

watch(
  () => [props.agentId, props.icon],
  () => {
    void loadSvgMarkup()
  },
  { immediate: true }
)
</script>

<template>
  <span
    :class="[
      'inline-flex shrink-0 items-center justify-center overflow-hidden rounded-md',
      customClass,
      toneClass
    ]"
  >
    <span v-if="shouldRenderInlineSvg" class="h-full w-full acp-registry-icon" v-html="svgMarkup" />
    <img
      v-else-if="shouldRenderImage && !imageLoadFailed"
      :src="icon"
      :alt="alt"
      class="h-full w-full object-contain"
      @error="handleImageError"
    />
    <span
      v-else
      class="flex h-full w-full items-center justify-center rounded-md bg-muted/70 text-[0.72em] font-semibold"
    >
      {{ fallbackLabel }}
    </span>
  </span>
</template>

<style scoped>
.acp-registry-icon {
  display: block;
  color: inherit;
}

.acp-registry-icon :deep(svg) {
  width: 100%;
  height: 100%;
  display: block;
  color: inherit;
}

.acp-registry-icon :deep(*) {
  color: inherit;
}
</style>
