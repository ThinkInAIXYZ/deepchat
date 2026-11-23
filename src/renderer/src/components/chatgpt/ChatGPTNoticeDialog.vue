<template>
  <!-- One-time notices owed by the main process: plan-use welcome, then the Codex retirement. -->
  <AlertDialog :open="notice !== null">
    <AlertDialogContent class="w-[calc(100vw-2rem)] max-w-md" data-testid="chatgpt-notice">
      <AlertDialogHeader>
        <img :src="chatgptMark" alt="" aria-hidden="true" class="mb-2 size-10 dark:invert" />
        <AlertDialogTitle>
          {{ notice === 'welcome' ? t('chatgpt.welcomeTitle') : t('chatgpt.codexRetiredTitle') }}
        </AlertDialogTitle>
        <AlertDialogDescription>
          {{
            notice === 'welcome'
              ? t('chatgpt.welcomeDescription')
              : t('chatgpt.codexRetiredDescription')
          }}
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter v-if="notice === 'welcome'">
        <AlertDialogAction data-testid="chatgpt-notice-ack" @click="dismiss('welcome')">
          {{ t('chatgpt.gotIt') }}
        </AlertDialogAction>
      </AlertDialogFooter>
      <AlertDialogFooter v-else class="flex flex-wrap items-center gap-2 sm:justify-end">
        <AlertDialogCancel data-testid="chatgpt-notice-later" @click="dismiss('codexRetired')">
          {{ t('chatgpt.later') }}
        </AlertDialogCancel>
        <ContinueWithChatGPTButton @click="continueWithChatGPT" />
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@shadcn/components/ui/alert-dialog'
import chatgptMark from '@/assets/chatgpt/chatgpt-mark-black.svg?url'
import ContinueWithChatGPTButton from './ContinueWithChatGPTButton.vue'
import { useChatGPTAuth } from '@/composables/useChatGPTAuth'

const { t } = useI18n()
const { status, startLogin, dismissNotice } = useChatGPTAuth()

const notice = computed<'welcome' | 'codexRetired' | null>(() =>
  status.value.notices.welcome
    ? 'welcome'
    : status.value.notices.codexRetired && status.value.state !== 'pending-browser'
      ? 'codexRetired'
      : null
)

const dismiss = (value: 'welcome' | 'codexRetired') => {
  void dismissNotice(value).catch((error) => console.warn('[ChatGPT] Dismiss failed:', error))
}

const continueWithChatGPT = async () => {
  dismiss('codexRetired')
  await startLogin()
}
</script>
