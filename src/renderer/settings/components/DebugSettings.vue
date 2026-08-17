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
        <DcButton variant="outline" :disabled="guidancePending" @click="startGuidedOnboarding">
          <Spinner
            v-if="isGuidanceOperation(guidanceOperationIds.onboarding)"
            class="mr-2 size-4"
          />
          <Icon v-else icon="lucide:route" class="mr-2 size-4" />
          {{ t('about.mockOnboardingButton') }}
        </DcButton>
        <DcSubmitButton
          variant="outline"
          data-testid="debug-create-mock-chat"
          :status="mockChatStatus"
          :disabled="guidancePending"
          @click="createMockChat"
        >
          {{ isCreatingMockChat ? t('about.mockChatCreating') : t('about.mockChatButton') }}
        </DcSubmitButton>
        <DcButton
          v-if="!upgrade.isMockUpdate"
          variant="outline"
          :disabled="guidancePending"
          @click="mockDownloadedUpdate"
        >
          <Spinner
            v-if="isGuidanceOperation(guidanceOperationIds.mockUpdate)"
            class="mr-2 size-4"
          />
          <Icon v-else icon="lucide:download" class="mr-2 size-4" />
          {{ t('about.mockUpdateButton') }}
        </DcButton>
        <DcButton v-else variant="outline" :disabled="guidancePending" @click="clearMockUpdate">
          <Spinner
            v-if="isGuidanceOperation(guidanceOperationIds.clearUpdate)"
            class="mr-2 size-4"
          />
          <Icon v-else icon="lucide:rotate-ccw" class="mr-2 size-4" />
          {{ t('about.clearMockUpdateButton') }}
        </DcButton>
      </div>
      <DcInlineError v-if="mockChatError" :error="mockChatError" class="mt-2" />
    </section>

    <section class="rounded-xl border border-border bg-card p-4">
      <div class="flex flex-col gap-1">
        <h2 class="text-base font-semibold text-foreground">
          {{ t('settings.debug.splash.title') }}
        </h2>
        <p class="text-sm text-muted-foreground">{{ t('settings.debug.splash.description') }}</p>
      </div>
      <div class="mt-4 flex flex-wrap gap-2">
        <DcButton
          v-for="scenario in splashScenarios"
          :key="scenario.mode"
          variant="outline"
          :disabled="splashPending"
          @click="showSplashScenario(scenario.mode)"
        >
          <Spinner v-if="isSplashOperation(splashOperationId(scenario.mode))" class="mr-2 size-4" />
          {{ scenario.label }}
        </DcButton>
        <DcButton
          variant="outline"
          :disabled="splashPending || !isSplashPreviewOpen"
          @click="closeSplashScenario"
        >
          <Spinner v-if="isSplashOperation(splashOperationIds.close)" class="mr-2 size-4" />
          {{ t('common.close') }}
        </DcButton>
      </div>
    </section>
  </SettingsPageShell>
</template>

<script setup lang="ts">
import { Icon } from '@iconify/vue'
import { computed, onMounted, ref } from 'vue'
import type { SplashDebugMode } from '@shared/contracts/splash'
import { useI18n } from 'vue-i18n'
import { DcButton } from '@dc-ui/components/button'
import { Spinner } from '@shadcn/components/ui/spinner'
import { DcInlineError } from '@dc-ui/components/inline-error'
import { DcSubmitButton, useDcFormSubmit } from '@dc-ui/components/form'
import { createDebugClient } from '@api/DebugClient'
import { createUpgradeClient } from '@api/UpgradeClient'
import { createWindowClient } from '@api/WindowClient'
import { useUpgradeStore } from '@/stores/upgrade'
import { notifyRenderer } from '@renderer-notifications/rendererNotificationPort'
import SettingsPageShell from './control-center/SettingsPageShell.vue'

const { t } = useI18n()
const debugClient = createDebugClient()
const upgradeClient = createUpgradeClient()
const windowClient = createWindowClient()
const upgrade = useUpgradeStore()
const guidanceOperationIds = Object.freeze({
  onboarding: 'settings.debug.onboarding',
  mockChat: 'settings.debug.mockChat',
  mockUpdate: 'settings.debug.mockUpdate',
  clearUpdate: 'settings.debug.clearUpdate'
})
const splashOperationIds = Object.freeze({
  close: 'settings.debug.splash.close'
})
const pendingGuidanceOperationId = ref<string | null>(null)
const pendingSplashOperationId = ref<string | null>(null)
const isSplashPreviewOpen = ref(false)
const mockChatError = ref<string | null>(null)
const { status: mockChatStatus, run: runMockChat } = useDcFormSubmit()
const splashScenarios = computed<Array<{ mode: SplashDebugMode; label: string }>>(() => [
  { mode: 'loading', label: t('settings.debug.splash.loading') },
  { mode: 'system-unlock', label: t('settings.debug.splash.systemUnlock') },
  { mode: 'unlock', label: t('settings.debug.splash.unlock') },
  { mode: 'recovery', label: t('settings.debug.splash.recovery') }
])

const splashOperationId = (mode: SplashDebugMode) => `settings.debug.splash.${mode}`

const isGuidanceOperation = (operationId: string) =>
  pendingGuidanceOperationId.value === operationId

const isSplashOperation = (operationId: string) => pendingSplashOperationId.value === operationId

const guidancePending = computed(
  () => pendingGuidanceOperationId.value !== null || mockChatStatus.value === 'submitting'
)
const splashPending = computed(() => pendingSplashOperationId.value !== null)
const isCreatingMockChat = computed(() => mockChatStatus.value === 'submitting')

type GuidanceActionOptions = Readonly<{
  operationId: string
  code: string
  pendingLabel: string
  action: () => Promise<boolean>
  unavailableTitle: string
  failureTitle: string
  success?: () => { code: string; title: string; description?: string }
}>

const runGuidanceAction = async ({
  operationId,
  code,
  pendingLabel,
  action,
  unavailableTitle,
  failureTitle,
  success
}: GuidanceActionOptions) => {
  if (guidancePending.value) {
    return
  }

  pendingGuidanceOperationId.value = operationId
  try {
    if (!(await action())) {
      notifyRenderer({
        kind: 'error',
        code: `${code}.unavailable`,
        title: unavailableTitle
      })
      return
    }
    const result = success?.()
    if (result) {
      notifyRenderer({
        kind: 'success',
        code: result.code,
        title: result.title,
        description: result.description
      })
    } else {
      notifyRenderer({
        kind: 'success',
        code,
        title: pendingLabel
      })
    }
  } catch (error) {
    console.error(
      '[DebugSettings] Guidance action failed',
      {
        code
      },
      error
    )
    notifyRenderer({
      kind: 'error',
      code: `${code}.failed`,
      title: failureTitle
    })
  } finally {
    pendingGuidanceOperationId.value = null
  }
}

const startGuidedOnboarding = () =>
  runGuidanceAction({
    operationId: guidanceOperationIds.onboarding,
    code: 'settings.debug.onboarding',
    pendingLabel: t('about.mockOnboardingButton'),
    action: async () => (await windowClient.startGuidedOnboarding()).started,
    unavailableTitle: t('settings.debug.unavailableDescription'),
    failureTitle: t('settings.debug.guidance.failed')
  })

const createMockChat = () => {
  if (guidancePending.value) return

  mockChatError.value = null
  void runMockChat(async () => {
    const result = await debugClient.createMockChatSession()
    if (!result.created || !result.sessionId) {
      mockChatError.value = t('about.mockChatCreateUnavailable')
      throw new Error('mock chat session unavailable')
    }
  }).catch((error: unknown) => {
    console.error(
      '[DebugSettings] Guidance action failed',
      { code: 'settings.debug.mockChat' },
      error
    )
    if (mockChatError.value === null) {
      mockChatError.value = t('about.mockChatCreateFailed')
    }
  })
}

const showSplashScenario = async (mode: SplashDebugMode) => {
  if (splashPending.value) {
    return
  }

  const operationId = splashOperationId(mode)
  pendingSplashOperationId.value = operationId
  try {
    const result = await debugClient.showSplashScenario(mode)
    if (!result.shown) {
      notifyRenderer({
        kind: 'error',
        code: 'settings.debug.splash.unavailable',
        title: t('settings.debug.unavailableDescription')
      })
      return
    }
    isSplashPreviewOpen.value = true
    notifyRenderer({
      kind: 'success',
      code: 'settings.debug.splash.shown',
      title: t(`settings.debug.splash.${mode}`)
    })
  } catch (error) {
    console.error('[DebugSettings] Failed to show Splash preview', error)
    notifyRenderer({
      kind: 'error',
      code: 'settings.debug.splash.showFailed',
      title: t('settings.debug.guidance.failed')
    })
  } finally {
    pendingSplashOperationId.value = null
  }
}

const closeSplashScenario = async () => {
  if (splashPending.value || !isSplashPreviewOpen.value) {
    return
  }

  pendingSplashOperationId.value = splashOperationIds.close
  try {
    const result = await debugClient.closeSplashScenario()
    if (!result.closed) {
      notifyRenderer({
        kind: 'error',
        code: 'settings.debug.splash.closeUnavailable',
        title: t('settings.debug.unavailableDescription')
      })
      return
    }
    isSplashPreviewOpen.value = false
    notifyRenderer({
      kind: 'success',
      code: 'settings.debug.splash.closed',
      title: t('common.close')
    })
  } catch (error) {
    console.error('[DebugSettings] Failed to close Splash preview', error)
    notifyRenderer({
      kind: 'error',
      code: 'settings.debug.splash.closeFailed',
      title: t('settings.debug.guidance.failed')
    })
  } finally {
    pendingSplashOperationId.value = null
  }
}

const mockDownloadedUpdate = () =>
  runGuidanceAction({
    operationId: guidanceOperationIds.mockUpdate,
    code: 'settings.debug.mockUpdate',
    pendingLabel: t('about.mockUpdateButton'),
    action: upgradeClient.mockDownloadedUpdate,
    unavailableTitle: t('settings.debug.unavailableDescription'),
    failureTitle: t('settings.debug.guidance.failed')
  })

const clearMockUpdate = () =>
  runGuidanceAction({
    operationId: guidanceOperationIds.clearUpdate,
    code: 'settings.debug.clearUpdate',
    pendingLabel: t('about.clearMockUpdateButton'),
    action: upgradeClient.clearMockUpdate,
    unavailableTitle: t('settings.debug.unavailableDescription'),
    failureTitle: t('settings.debug.guidance.failed')
  })

onMounted(() => {
  void upgrade.refreshStatus().catch((error) => {
    console.error('[DebugSettings] Failed to refresh update status', error)
  })
})
</script>
