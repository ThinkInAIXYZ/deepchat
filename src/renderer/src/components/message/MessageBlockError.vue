<template>
  <div
    class="text-muted-foreground text-sm flex flex-row gap-2 items-center py-2"
    v-if="block.status === 'cancel'"
  >
    <Icon icon="lucide:refresh-cw-off"></Icon>
    <span>{{ t(block.content || '') }}</span>
  </div>
  <div v-else class="cursor-default select-none">
    <button
      type="button"
      class="flex flex-row items-center gap-1 rounded-sm text-xs text-red-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      :aria-expanded="isExpanded"
      :aria-controls="detailsId"
      @click="isExpanded = !isExpanded"
    >
      {{ t('common.error.requestFailed') }}
      <Icon
        class="h-3.5 w-3.5 transition-transform duration-[var(--dc-motion-fast)] ease-[var(--dc-ease-out-soft)] motion-reduce:transition-none"
        :class="isExpanded ? 'rotate-90' : 'rotate-0'"
        icon="lucide:chevron-right"
        aria-hidden="true"
      />
    </button>
    <div
      class="grid overflow-hidden transition-[grid-template-rows,opacity] duration-[var(--dc-motion-default)] ease-[var(--dc-ease-out-express)] motion-reduce:transition-none"
      :class="isExpanded ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'"
      :aria-hidden="!isExpanded"
      :inert="isExpanded ? undefined : true"
    >
      <div class="min-h-0 overflow-hidden">
        <div
          :id="detailsId"
          class="max-w-full break-all whitespace-pre-wrap text-xs leading-7 text-red-400"
        >
          {{ t(block.content || '') }}
        </div>
      </div>
    </div>
    <div v-if="errorExplanation" class="mt-2 text-red-400 font-medium">
      {{ t('common.error.causeOfError') }} {{ t(errorExplanation) }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { computed, ref, useId } from 'vue'
import type { DisplayAssistantMessageBlock } from '@/components/chat/messageListItems'
const { t } = useI18n()

const props = defineProps<{
  block: DisplayAssistantMessageBlock
}>()

const isExpanded = ref(false)
const detailsId = `message-error-details-${useId()}`

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
