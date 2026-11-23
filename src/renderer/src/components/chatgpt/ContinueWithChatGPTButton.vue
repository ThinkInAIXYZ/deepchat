<template>
  <!-- Approved Sign in with ChatGPT button: black with the white mark, fixed label. -->
  <button
    type="button"
    data-testid="continue-with-chatgpt"
    class="inline-flex h-[45px] w-[242px] max-w-full shrink-0 items-center justify-center gap-3 rounded-xl bg-black px-5 text-[15px] font-medium text-white transition-opacity hover:opacity-85 active:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
    :disabled="disabled || loading"
    :aria-busy="loading || undefined"
  >
    <img :src="chatgptMarkWhite" alt="" aria-hidden="true" class="size-[21px] shrink-0" />
    <span>{{ loading ? t('chatgpt.opening') : t('chatgpt.continue') }}</span>
  </button>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import chatgptMarkWhite from '@/assets/chatgpt/chatgpt-mark-white.svg?url'

defineProps<{
  loading?: boolean
  disabled?: boolean
}>()

const { t } = useI18n()
</script>
