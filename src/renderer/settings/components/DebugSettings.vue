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
        <Button variant="outline" :disabled="isRunningDebugAction" @click="startGuidedOnboarding">
          <Spinner v-if="isRunningDebugAction" class="mr-2 size-4" />
          <Icon v-else icon="lucide:route" class="mr-2 size-4" />
          {{ t('about.mockOnboardingButton') }}
        </Button>
        <Button variant="outline" :disabled="isCreatingMockChat" @click="createMockChat">
          <Spinner v-if="isCreatingMockChat" class="mr-2 size-4" />
          <Icon v-else icon="lucide:database" class="mr-2 size-4" />
          {{ isCreatingMockChat ? t('about.mockChatCreating') : t('about.mockChatButton') }}
        </Button>
        <Button
          v-if="!upgrade.isMockUpdate"
          variant="outline"
          :disabled="isRunningDebugAction"
          @click="mockDownloadedUpdate"
        >
          <Spinner v-if="isRunningDebugAction" class="mr-2 size-4" />
          <Icon v-else icon="lucide:download" class="mr-2 size-4" />
          {{ t('about.mockUpdateButton') }}
        </Button>
        <Button v-else variant="outline" :disabled="isRunningDebugAction" @click="clearMockUpdate">
          <Spinner v-if="isRunningDebugAction" class="mr-2 size-4" />
          <Icon v-else icon="lucide:rotate-ccw" class="mr-2 size-4" />
          {{ t('about.clearMockUpdateButton') }}
        </Button>
      </div>
    </section>

    <section class="rounded-xl border border-border bg-card p-4">
      <div class="flex flex-col gap-1">
        <h2 class="text-base font-semibold text-foreground">
          {{ t('settings.debug.splash.title') }}
        </h2>
        <p class="text-sm text-muted-foreground">{{ t('settings.debug.splash.description') }}</p>
      </div>
      <div class="mt-4 flex flex-wrap gap-2">
        <Button
          v-for="scenario in splashScenarios"
          :key="scenario.mode"
          variant="outline"
          :disabled="isRunningSplashAction"
          @click="showSplashScenario(scenario.mode)"
        >
          <Spinner v-if="isRunningSplashAction" class="mr-2 size-4" />
          {{ scenario.label }}
        </Button>
        <Button
          variant="outline"
          :disabled="isRunningSplashAction || !isSplashPreviewOpen"
          @click="closeSplashScenario"
        >
          {{ t('common.close') }}
        </Button>
      </div>
    </section>
  </SettingsPageShell>
</template>

<script setup lang="ts">
import { Icon } from '@iconify/vue'
import { computed, onMounted, ref } from 'vue'
import type { SplashDebugMode } from '@shared/contracts/splash'
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
const isRunningDebugAction = ref(false)
const isRunningSplashAction = ref(false)
const isSplashPreviewOpen = ref(false)
const splashScenarios = computed<Array<{ mode: SplashDebugMode; label: string }>>(() => [
  { mode: 'loading', label: t('settings.debug.splash.loading') },
  { mode: 'system-unlock', label: t('settings.debug.splash.systemUnlock') },
  { mode: 'unlock', label: t('settings.debug.splash.unlock') }
])

const showToastError = (description: string) => {
  toast({
    title: t('common.error.operationFailed'),
    description,
    variant: 'destructive'
  })
}

const runDebugAction = async (
  action: () => Promise<boolean>,
  unavailableMessage: string,
  logLabel: string,
  failureMessage: string
) => {
  if (isRunningDebugAction.value) {
    return
  }

  isRunningDebugAction.value = true
  try {
    if (!(await action())) {
      showToastError(t(unavailableMessage))
    }
  } catch (error) {
    console.error(`[DebugSettings] ${logLabel}`, error)
    showToastError(error instanceof Error ? error.message : t(failureMessage))
  } finally {
    isRunningDebugAction.value = false
  }
}

const startGuidedOnboarding = () =>
  runDebugAction(
    async () => (await windowClient.startGuidedOnboarding()).started,
    'settings.debug.unavailableDescription',
    'Failed to start guided onboarding',
    'settings.debug.guidance.failed'
  )

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

const showSplashScenario = async (mode: SplashDebugMode) => {
  if (isRunningSplashAction.value) {
    return
  }

  isRunningSplashAction.value = true
  try {
    const result = await debugClient.showSplashScenario(mode)
    if (!result.shown) {
      showToastError(t('settings.debug.unavailableDescription'))
      return
    }
    isSplashPreviewOpen.value = true
  } catch (error) {
    console.error('[DebugSettings] Failed to show Splash preview', error)
    showToastError(error instanceof Error ? error.message : t('settings.debug.guidance.failed'))
  } finally {
    isRunningSplashAction.value = false
  }
}

const closeSplashScenario = async () => {
  if (isRunningSplashAction.value || !isSplashPreviewOpen.value) {
    return
  }

  isRunningSplashAction.value = true
  try {
    const result = await debugClient.closeSplashScenario()
    if (!result.closed) {
      showToastError(t('settings.debug.unavailableDescription'))
      return
    }
    isSplashPreviewOpen.value = false
  } catch (error) {
    console.error('[DebugSettings] Failed to close Splash preview', error)
    showToastError(error instanceof Error ? error.message : t('settings.debug.guidance.failed'))
  } finally {
    isRunningSplashAction.value = false
  }
}

const mockDownloadedUpdate = () =>
  runDebugAction(
    upgradeClient.mockDownloadedUpdate,
    'settings.debug.unavailableDescription',
    'Failed to create mock update',
    'settings.debug.guidance.failed'
  )

const clearMockUpdate = () =>
  runDebugAction(
    upgradeClient.clearMockUpdate,
    'settings.debug.unavailableDescription',
    'Failed to clear mock update',
    'settings.debug.guidance.failed'
  )

onMounted(() => {
  void upgrade.refreshStatus()
})
</script>
