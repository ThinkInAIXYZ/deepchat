<template>
  <div class="my-1">
    <div class="rounded-lg border bg-card text-card-foreground p-4 w-fit">
      <div class="flex flex-col space-y-2">
        <!-- Audio area -->
        <div class="flex justify-center">
          <template v-if="resolvedAudioData">
            <div class="flex min-w-90 flex-col gap-3">
              <div class="flex items-center gap-2 text-xs text-muted-foreground">
                <Icon icon="lucide:music-2" class="h-4 w-4" />
                <span>{{ t('mcp.sampling.contentType.audio') }}</span>
              </div>
              <div class="rounded-xl border bg-muted/30 p-3">
                <audio :src="audioSrc" controls class="w-full" />
              </div>
              <div class="text-[11px] text-muted-foreground">
                {{ resolvedAudioData.mimeType }}
              </div>
              <div v-if="audioError" class="text-xs text-red-500">
                {{ t('common.error.requestFailed') }}
              </div>
            </div>
          </template>
          <div v-else class="flex items-center justify-center h-40 w-full">
            <Icon icon="lucide:loader-2" class="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { Icon } from '@iconify/vue'
import { AssistantMessageBlock } from '@shared/chat'
import { useI18n } from 'vue-i18n'

const keyMap = {
  'mcp.sampling.contentType.audio': 'Audio',
  'common.error.requestFailed': 'Request failed'
}

const t = (() => {
  try {
    const { t } = useI18n()
    return t
  } catch (e) {
    return (key: string) => keyMap[key] || key
  }
})()

const props = defineProps<{
  block: AssistantMessageBlock
  messageId?: string
  threadId?: string
}>()

type LegacyAudioBlockContent = {
  data?: string
  mimeType?: string
}

const audioError = ref(false)

const parseAudioDataUri = (value: string): { data: string; mimeType: string } | null => {
  const match = value.match(/^data:([^;]+);base64,(.*)$/)
  if (!match?.[1] || !match?.[2]) return null
  if (!match[1].startsWith('audio/')) return null
  return { data: match[2], mimeType: match[1] }
}

const normalizeAudioData = (rawData: string, mimeType?: string) => {
  const trimmed = rawData.trim()
  if (!trimmed) return null
  const parsed = parseAudioDataUri(trimmed)
  if (parsed) return parsed

  const normalizedMimeType = mimeType?.trim() || 'audio/mpeg'
  return { data: trimmed, mimeType: normalizedMimeType }
}

const resolvedAudioData = computed(() => {
  if (props.block.image_data?.data) {
    return normalizeAudioData(props.block.image_data.data, props.block.image_data.mimeType)
  }

  const content = props.block.content
  if (content && typeof content === 'object' && 'data' in (content as LegacyAudioBlockContent)) {
    const legacyContent = content as LegacyAudioBlockContent
    if (legacyContent.data) {
      return normalizeAudioData(legacyContent.data, legacyContent.mimeType)
    }
  }

  if (typeof content === 'string' && content.length > 0) {
    return normalizeAudioData(content)
  }

  return null
})

const audioSrc = computed(() => {
  if (!resolvedAudioData.value) return ''
  const raw = resolvedAudioData.value.data
  if (raw.startsWith('imgcache://') || raw.startsWith('http://') || raw.startsWith('https://')) {
    return raw
  }
  return `data:${resolvedAudioData.value.mimeType};base64,${raw}`
})
</script>
