<template>
  <div class="flex flex-col gap-3" data-testid="chatgpt-auth">
    <template v-if="status.state === 'authenticated'">
      <div class="flex items-start gap-2 rounded-md border px-3 py-2">
        <Icon icon="lucide:circle-check" class="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div class="min-w-0 text-sm">
          <p class="font-medium leading-5" data-testid="chatgpt-connected">
            {{
              status.email
                ? t('chatgpt.connectedAs', { email: status.email })
                : t('chatgpt.connected')
            }}
          </p>
          <p class="text-xs leading-5 text-muted-foreground">{{ t('chatgpt.planEnabled') }}</p>
        </div>
      </div>
      <div class="flex flex-wrap gap-2">
        <DcButton
          data-testid="chatgpt-test-connection"
          variant="outline"
          size="sm"
          :disabled="!provider.enable"
          @click="modelCheckStore.openDialog(provider.id)"
        >
          <Icon icon="lucide:check-check" class="size-4 text-muted-foreground" />
          {{ t('settings.provider.connectionEditor.test') }}
        </DcButton>
        <DcButton variant="outline" size="sm" @click="openUsage">
          <Icon icon="lucide:external-link" class="size-4 text-muted-foreground" />
          {{ t('chatgpt.manageUsage') }}
        </DcButton>
        <DcButton
          data-testid="chatgpt-sign-out"
          variant="outline"
          size="sm"
          class="text-destructive"
          :disabled="busy"
          @click="signOut"
        >
          <Icon icon="lucide:log-out" class="size-4" />
          {{ t('chatgpt.signOut') }}
        </DcButton>
      </div>
    </template>

    <template v-else>
      <div class="flex flex-col gap-1">
        <p class="text-sm font-medium">{{ t('chatgpt.offerTitle') }}</p>
        <p class="text-xs leading-5 text-muted-foreground">{{ t('chatgpt.offerDescription') }}</p>
      </div>

      <p
        v-if="status.state === 'plan-disabled'"
        data-testid="chatgpt-plan-disabled"
        class="text-sm leading-5 text-muted-foreground"
      >
        {{ t('chatgpt.planDisabled') }}
      </p>
      <p
        v-else-if="status.state === 'reauth-required'"
        data-testid="chatgpt-reauth-required"
        class="text-sm leading-5 text-muted-foreground"
      >
        {{ t('chatgpt.reauthRequired') }}
      </p>
      <DcInlineError
        v-else-if="status.state === 'error' && status.error"
        :error="status.error"
        data-testid="chatgpt-error"
      />

      <div v-if="isPending" class="flex flex-wrap items-center gap-2" data-testid="chatgpt-pending">
        <Spinner class="size-4" />
        <span class="text-sm text-muted-foreground">{{ t('chatgpt.waiting') }}</span>
        <DcButton variant="outline" size="sm" @click="reopenBrowser">
          {{ t('chatgpt.reopenBrowser') }}
        </DcButton>
        <DcButton variant="ghost" size="sm" @click="cancelLogin">
          {{ t('common.cancel') }}
        </DcButton>
      </div>
      <ContinueWithChatGPTButton
        v-else
        :loading="busy"
        @click="startLogin(status.state === 'plan-disabled')"
      />
    </template>

    <p v-if="revocationUnconfirmed" class="text-xs leading-5 text-muted-foreground">
      {{ t('chatgpt.revocationUnconfirmed') }}
    </p>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { DcButton } from '@dc-ui/components/button'
import { DcInlineError } from '@dc-ui/components/inline-error'
import { Spinner } from '@shadcn/components/ui/spinner'
import ContinueWithChatGPTButton from '@/components/chatgpt/ContinueWithChatGPTButton.vue'
import { useChatGPTAuth } from '@/composables/useChatGPTAuth'
import { useModelCheckStore } from '@/stores/modelCheck'
import type { LLM_PROVIDER } from '@shared/types/provider'

defineProps<{ provider: LLM_PROVIDER }>()

const { t } = useI18n()
const modelCheckStore = useModelCheckStore()
const { status, busy, isPending, startLogin, reopenBrowser, cancelLogin, logout, openUsage } =
  useChatGPTAuth()
const revocationUnconfirmed = ref(false)

const signOut = async () => {
  const result = await logout()
  revocationUnconfirmed.value = result ? !result.revocationConfirmed : false
}
</script>
