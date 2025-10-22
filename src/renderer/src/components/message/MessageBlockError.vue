<template>
  <div
    class="text-muted-foreground text-sm flex flex-row gap-2 items-center py-2"
    v-if="block.status === 'cancel'"
  >
    <Icon icon="lucide:refresh-cw-off"></Icon>
    <span>{{ t(block.content || '') }}</span>
  </div>
  <div v-else class="cursor-default select-none">
    <div
      class="text-xs text-red-500 flex flex-row items-center group"
      @click="isExpanded = !isExpanded"
    >
      {{ t('common.error.requestFailed')
      }}<Icon
        class="hidden group-hover:block ml-2 transition-all"
        :class="[isExpanded ? ' rotate-90' : '']"
        icon="lucide:chevron-right"
      ></Icon>
    </div>
    <div
      v-if="isExpanded"
      class="text-xs max-w-full break-all whitespace-pre-wrap leading-7 text-red-400"
    >
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
import { computed, ref } from 'vue'
import { AssistantMessageBlock } from '@shared/chat'
const { t } = useI18n()

const props = defineProps<{
  block: AssistantMessageBlock
}>()

const isExpanded = ref(false)

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
