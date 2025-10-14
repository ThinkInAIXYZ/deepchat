<template>
  <div
    class="text-muted-foreground text-sm flex flex-row gap-2 items-center py-2"
    v-if="block.status === 'cancel'"
  >
    <Icon icon="lucide:refresh-cw-off"></Icon>
    <span>{{ t(block.content || '') }}</span>
  </div>
  <div
    v-else
    class="text-xs bg-red-100 text-red-700 rounded-lg border border-red-400 flex flex-col gap-2 px-2 py-2"
  >
    <div class="flex flex-row gap-2 items-center cursor-pointer">
      <Icon icon="lucide:info" class="w-4 h-4 text-red-700" />
      <span class="grow">{{ t('common.error.requestFailed') }}</span>
    </div>
    <div class="prose prose-sm max-w-full break-all whitespace-pre-wrap leading-7">
      {{ t(block.content || '') }}
    </div>
    <div v-if="errorExplanation" class="mt-2 text-red-400 font-medium">
      {{ t('common.error.causeOfError') }} {{ t(errorExplanation) }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { computed } from 'vue'
import { AssistantMessageBlock } from '@shared/chat'
const { t } = useI18n()

const props = defineProps<{
  block: AssistantMessageBlock
}>()

const errorExplanation = computed(() => {
  const content = props.block.content || ''

  if (content.includes('400')) return 'common.error.error400'
  if (content.includes('401')) return 'common.error.error401'
  if (content.includes('403')) return 'common.error.error403'
  if (content.includes('404')) return 'common.error.error404'
  if (content.includes('429')) return 'common.error.error429'
  if (content.includes('500')) return 'common.error.error500'
  if (content.includes('502')) return 'common.error.error502'
  if (content.includes('503')) return 'common.error.error503'
  if (content.includes('504')) return 'common.error.error504'

  return ''
})
</script>
