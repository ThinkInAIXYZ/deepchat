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
    <div
      v-if="chatgptRecovery"
      data-testid="chatgpt-error-recovery"
      class="mt-2 flex flex-col gap-2"
    >
      <div class="flex items-center gap-1.5 text-sm font-medium text-foreground">
        <img :src="chatgptMark" alt="" aria-hidden="true" class="size-4 dark:invert" />
        <span>ChatGPT · {{ t(`chatgpt.recovery.${chatgptRecovery}.title`) }}</span>
      </div>
      <p class="text-xs leading-5 text-muted-foreground">
        {{ t(`chatgpt.recovery.${chatgptRecovery}.description`) }}
      </p>
      <div v-if="chatgptRecovery !== 'notEligible'" class="flex flex-wrap gap-2">
        <DcButton v-if="chatgptRecovery === 'usageLimit'" size="sm" @click="chatgpt?.openUsage()">
          {{ t('chatgpt.manageUsage') }}
        </DcButton>
        <DcButton v-else size="sm" @click="chatgpt?.startLogin()">
          {{ t('chatgpt.reconnect') }}
        </DcButton>
      </div>
    </div>
    <div v-else-if="errorExplanation" class="mt-2 text-red-400 font-medium">
      {{ t('common.error.causeOfError') }} {{ t(errorExplanation) }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { computed, ref, useId } from 'vue'
import type { DisplayAssistantMessageBlock } from '@/features/chat-page/model/displayMessage'
import { DcButton } from '@dc-ui/components/button'
import chatgptMark from '@/assets/chatgpt/chatgpt-mark-black.svg?url'
import { useChatGPTAuth } from '@/composables/useChatGPTAuth'
const { t } = useI18n()

const props = defineProps<{
  block: DisplayAssistantMessageBlock
  providerId?: string
}>()

// A message's provider never changes; only ChatGPT messages need the account status.
const chatgpt = props.providerId === 'chatgpt' ? useChatGPTAuth() : null

// The native turn reports only a message: Aimux's ChatGPT usage-limit reason links the usage page,
// and plan error codes are carried through verbatim. Sign-in state comes from the account owner.
const chatgptRecovery = computed<'usageLimit' | 'notEligible' | 'reconnect' | null>(() => {
  if (!chatgpt) return null
  const content = props.block.content || ''
  if (
    content.includes('subscription_sharing_usage_limit_exceeded') ||
    content.includes('chatgpt.com/settings/usage')
  )
    return 'usageLimit'
  if (content.includes('subscription_sharing_user_not_eligible')) return 'notEligible'
  const state = chatgpt.status.value.state
  if (state === 'reauth-required' || state === 'signed-out' || state === 'plan-disabled')
    return 'reconnect'
  return null
})

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
