<template>
  <SettingsPageShell
    :title="t('routes.settings-debug')"
    :description="t('settings.debug.description')"
    :eyebrow="t('settings.controlCenter.groups.system')"
    data-testid="settings-debug-page"
  >
    <section class="rounded-xl border border-border bg-card p-4">
      <div class="flex flex-col gap-1">
        <h2 class="text-base font-semibold text-foreground">
          {{ t('settings.debug.guidance.title') }}
        </h2>
        <p class="text-sm text-muted-foreground">{{ t('settings.debug.guidance.description') }}</p>
      </div>

      <div class="mt-4 flex flex-wrap gap-2">
        <Button variant="outline" @click="startGuidedOnboarding">
          <Icon icon="lucide:route" class="mr-2 size-4" />
          {{ t('about.mockOnboardingButton') }}
        </Button>
        <Button variant="outline" :disabled="isCreatingMockChat" @click="createMockChat">
          <Spinner v-if="isCreatingMockChat" class="mr-2 size-4" />
          <Icon v-else icon="lucide:database" class="mr-2 size-4" />
          {{ isCreatingMockChat ? t('about.mockChatCreating') : t('about.mockChatButton') }}
        </Button>
        <Button v-if="!upgrade.isMockUpdate" variant="outline" @click="mockDownloadedUpdate">
          <Icon icon="lucide:download" class="mr-2 size-4" />
          {{ t('about.mockUpdateButton') }}
        </Button>
        <Button v-else variant="outline" @click="clearMockUpdate">
          <Icon icon="lucide:rotate-ccw" class="mr-2 size-4" />
          {{ t('about.clearMockUpdateButton') }}
        </Button>
      </div>
    </section>
  </SettingsPageShell>
</template>

<script setup lang="ts">
import { Icon } from '@iconify/vue'
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Button } from '@shadcn/components/ui/button'
import { Spinner } from '@shadcn/components/ui/spinner'
import { useToast } from '@/components/use-toast'
import { createDebugClient } from '@api/DebugClient'
import { createUpgradeClient } from '@api/UpgradeClient'
import { createWindowClient } from '@api/WindowClient'
import { useUpgradeStore } from '@/stores/upgrade'
import SettingsPageShell from './control-center/SettingsPageShell.vue'

const { t } = useI18n()
const { toast } = useToast()
const debugClient = createDebugClient()
const upgradeClient = createUpgradeClient()
const windowClient = createWindowClient()
const upgrade = useUpgradeStore()
const isCreatingMockChat = ref(false)

const showToastError = (description: string) => {
  toast({
    title: t('common.error.operationFailed'),
    description,
    variant: 'destructive'
  })
}

const startGuidedOnboarding = async () => {
  try {
    const result = await windowClient.startGuidedOnboarding()
    if (!result.started) {
      showToastError(t('settings.debug.unavailableDescription'))
    }
  } catch (error) {
    console.error('[DebugSettings] Failed to start guided onboarding', error)
    showToastError(error instanceof Error ? error.message : t('settings.debug.guidance.failed'))
  }
}

const createMockChat = async () => {
  if (isCreatingMockChat.value) {
    return
  }

  isCreatingMockChat.value = true
  try {
    const result = await debugClient.createMockChatSession()
    if (!result.created || !result.sessionId) {
      showToastError(t('about.mockChatCreateUnavailable'))
      return
    }
    toast({
      title: t('about.mockChatCreated'),
      description: t('about.mockChatCreatedDesc', {
        title: result.title ?? result.sessionId,
        count: result.messageCount
      })
    })
  } catch (error) {
    console.error('[DebugSettings] Failed to create mock chat', error)
    showToastError(error instanceof Error ? error.message : t('about.mockChatCreateFailed'))
  } finally {
    isCreatingMockChat.value = false
  }
}

const mockDownloadedUpdate = async () => {
  try {
    const updated = await upgradeClient.mockDownloadedUpdate()
    if (!updated) {
      showToastError(t('settings.debug.unavailableDescription'))
    }
  } catch (error) {
    console.error('[DebugSettings] Failed to create mock update', error)
    showToastError(error instanceof Error ? error.message : t('settings.debug.guidance.failed'))
  }
}

const clearMockUpdate = async () => {
  try {
    const updated = await upgradeClient.clearMockUpdate()
    if (!updated) {
      showToastError(t('settings.debug.unavailableDescription'))
    }
  } catch (error) {
    console.error('[DebugSettings] Failed to clear mock update', error)
    showToastError(error instanceof Error ? error.message : t('settings.debug.guidance.failed'))
  }
}

onMounted(() => {
  void upgrade.refreshStatus()
})
</script>
