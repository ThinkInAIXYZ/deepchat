<template>
  <!-- One-time notice for users who relied on the retired OpenAI Codex sign-in. -->
  <AlertDialog :open="open">
    <AlertDialogContent class="w-[calc(100vw-2rem)] max-w-md" data-testid="chatgpt-notice">
      <AlertDialogHeader>
        <AlertDialogTitle>{{ t('chatgpt.codexRetiredTitle') }}</AlertDialogTitle>
        <AlertDialogDescription>{{ t('chatgpt.codexRetiredDescription') }}</AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter class="flex flex-wrap items-center gap-2 sm:justify-end">
        <AlertDialogCancel data-testid="chatgpt-notice-later" @click="dismiss">
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
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@shadcn/components/ui/alert-dialog'
import ContinueWithChatGPTButton from './ContinueWithChatGPTButton.vue'
import { useChatGPTAuth } from '@/composables/useChatGPTAuth'

const { t } = useI18n()
const { status, startLogin, dismissNotice } = useChatGPTAuth()

const open = computed(
  () => status.value.notices.codexRetired && status.value.state !== 'pending-browser'
)

const dismiss = () => {
  void dismissNotice('codexRetired').catch((error) =>
    console.warn('[ChatGPT] Dismiss failed:', error)
  )
}

const continueWithChatGPT = async () => {
  dismiss()
  await startLogin()
}
</script>
