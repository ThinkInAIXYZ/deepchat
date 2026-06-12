<template>
  <div class="my-1">
    <div class="rounded-lg border bg-card text-card-foreground p-4 w-fit max-w-full">
      <div class="flex flex-col space-y-2 min-w-[320px] max-w-130">
        <div class="flex items-center gap-2 text-xs text-muted-foreground">
          <Icon icon="lucide:clapperboard" class="h-4 w-4" />
          <span>{{ translate('common.video') }}</span>
        </div>

        <template v-if="resolvedVideoData">
          <div class="rounded-xl border bg-muted/30 p-2">
            <video
              :src="videoSrc"
              controls
              playsinline
              class="max-h-105 w-full rounded-lg bg-black"
              @error="videoError = true"
            />
          </div>
          <div class="text-[11px] text-muted-foreground break-all">
            {{ resolvedVideoData.mimeType }}
          </div>
          <div v-if="videoError" class="text-xs text-red-500">
            {{ translate('common.error.requestFailed') }}
          </div>
        </template>

        <div v-else class="flex items-center justify-center h-40 w-full">
          <Icon icon="lucide:loader-2" class="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { Icon } from '@iconify/vue'
import { useI18n } from 'vue-i18n'
import type { DisplayAssistantMessageBlock } from '@/components/chat/messageListItems'

const keyMap: Record<string, string> = {
  'common.video': 'Video',
  'common.error.requestFailed': 'Request failed'
}

const i18n = (() => {
  try {
    return useI18n().t
  } catch {
    return (key: string) => keyMap[key] || key
  }
})()

const translate = (key: string) => {
  const translated = i18n(key)
  return translated === key ? keyMap[key] || key : translated
}

const props = defineProps<{
  block: DisplayAssistantMessageBlock
  messageId?: string
  threadId?: string
}>()

type LegacyVideoBlockContent = {
  data?: string
  mimeType?: string
}

const videoError = ref(false)

const parseVideoDataUri = (value: string): { data: string; mimeType: string } | null => {
  const match = value.match(/^data:([^;]+);base64,(.*)$/)
  if (!match?.[1] || !match?.[2]) return null
  if (!match[1].startsWith('video/')) return null
  return { data: match[2], mimeType: match[1] }
}

const normalizeVideoData = (rawData: string, mimeType?: string) => {
  const trimmed = rawData.trim()
  if (!trimmed) return null

  if (
    trimmed.startsWith('imgcache://') ||
    trimmed.startsWith('http://') ||
    trimmed.startsWith('https://')
  ) {
    return {
      data: trimmed,
      mimeType: mimeType?.trim() || 'video/mp4'
    }
  }

  const parsed = parseVideoDataUri(trimmed)
  if (parsed) return parsed

  return {
    data: trimmed,
    mimeType: mimeType?.trim() || 'video/mp4'
  }
}

const resolvedVideoData = computed(() => {
  if (props.block.image_data?.data) {
    return normalizeVideoData(props.block.image_data.data, props.block.image_data.mimeType)
  }

  const content = props.block.content
  if (content && typeof content === 'object' && 'data' in (content as LegacyVideoBlockContent)) {
    const legacyContent = content as LegacyVideoBlockContent
    if (legacyContent.data) {
      return normalizeVideoData(legacyContent.data, legacyContent.mimeType)
    }
  }

  if (typeof content === 'string' && content.length > 0) {
    return normalizeVideoData(content)
  }

  return null
})

const videoSrc = computed(() => {
  if (!resolvedVideoData.value) return ''
  const raw = resolvedVideoData.value.data
  if (raw.startsWith('imgcache://') || raw.startsWith('http://') || raw.startsWith('https://')) {
    return raw
  }
  return `data:${resolvedVideoData.value.mimeType};base64,${raw}`
})
</script>
