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
        <Button variant="outline" :disabled="guidancePending" @click="startGuidedOnboarding">
          <Spinner
            v-if="isGuidanceOperation(guidanceOperationIds.onboarding)"
            class="mr-2 size-4"
          />
          <Icon v-else icon="lucide:route" class="mr-2 size-4" />
          {{ t('about.mockOnboardingButton') }}
        </Button>
        <Button variant="outline" :disabled="guidancePending" @click="createMockChat">
          <Spinner v-if="isCreatingMockChat" class="mr-2 size-4" />
          <Icon v-else icon="lucide:database" class="mr-2 size-4" />
          {{ isCreatingMockChat ? t('about.mockChatCreating') : t('about.mockChatButton') }}
        </Button>
        <Button
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
        </Button>
        <Button v-else variant="outline" :disabled="guidancePending" @click="clearMockUpdate">
          <Spinner
            v-if="isGuidanceOperation(guidanceOperationIds.clearUpdate)"
            class="mr-2 size-4"
          />
          <Icon v-else icon="lucide:rotate-ccw" class="mr-2 size-4" />
          {{ t('about.clearMockUpdateButton') }}
        </Button>
      </div>
      <InlineOperationFeedback class="mt-3" :snapshot="guidanceFeedback" />
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
          :disabled="splashPending"
          @click="showSplashScenario(scenario.mode)"
        >
          <Spinner v-if="isSplashOperation(splashOperationId(scenario.mode))" class="mr-2 size-4" />
          {{ scenario.label }}
        </Button>
        <Button
          variant="outline"
          :disabled="splashPending || !isSplashPreviewOpen"
          @click="closeSplashScenario"
        >
          <Spinner v-if="isSplashOperation(splashOperationIds.close)" class="mr-2 size-4" />
          {{ t('common.close') }}
        </Button>
      </div>
      <InlineOperationFeedback class="mt-3" :snapshot="splashFeedback" />
    </section>
  </SettingsPageShell>
</template>

<script setup lang="ts">
import { Icon } from '@iconify/vue'
import { nanoid } from 'nanoid'
import { computed, onMounted, ref } from 'vue'
import type { SplashDebugMode } from '@shared/contracts/splash'
import { useI18n } from 'vue-i18n'
import { Button } from '@shadcn/components/ui/button'
import { Spinner } from '@shadcn/components/ui/spinner'
import { createDebugClient } from '@api/DebugClient'
import { createUpgradeClient } from '@api/UpgradeClient'
import { createWindowClient } from '@api/WindowClient'
import { useUpgradeStore } from '@/stores/upgrade'
import InlineOperationFeedback from '@renderer-notifications/InlineOperationFeedback.vue'
import { createRendererSurfaceFeedbackController } from '@renderer-notifications/rendererNotificationRuntime'
import { useSurfaceFeedback } from '@renderer-notifications/useSurfaceFeedback'
import SettingsPageShell from './control-center/SettingsPageShell.vue'

const { t } = useI18n()
const debugClient = createDebugClient()
const upgradeClient = createUpgradeClient()
const windowClient = createWindowClient()
const upgrade = useUpgradeStore()
const guidanceFeedbackController = createRendererSurfaceFeedbackController('settings')
const { snapshot: guidanceFeedback } = useSurfaceFeedback(guidanceFeedbackController)
const splashFeedbackController = createRendererSurfaceFeedbackController('settings')
const { snapshot: splashFeedback } = useSurfaceFeedback(splashFeedbackController)
const splashInstanceId = nanoid(8)
const guidanceOperationIds = Object.freeze({
  onboarding: `settings.debug.onboarding:${nanoid(8)}`,
  mockChat: `settings.debug.mockChat:${nanoid(8)}`,
  mockUpdate: `settings.debug.mockUpdate:${nanoid(8)}`,
  clearUpdate: `settings.debug.clearUpdate:${nanoid(8)}`
})
const splashOperationIds = Object.freeze({
  close: `settings.debug.splash.close:${splashInstanceId}`
})
const isSplashPreviewOpen = ref(false)
const splashScenarios = computed<Array<{ mode: SplashDebugMode; label: string }>>(() => [
  { mode: 'loading', label: t('settings.debug.splash.loading') },
  { mode: 'system-unlock', label: t('settings.debug.splash.systemUnlock') },
  { mode: 'unlock', label: t('settings.debug.splash.unlock') }
])

const splashOperationId = (mode: SplashDebugMode) =>
  `settings.debug.splash.${mode}:${splashInstanceId}`

const isGuidanceOperation = (operationId: string) =>
  guidanceFeedback.value.status === 'pending' && guidanceFeedback.value.operationId === operationId

const isSplashOperation = (operationId: string) =>
  splashFeedback.value.status === 'pending' && splashFeedback.value.operationId === operationId

const guidancePending = computed(() => guidanceFeedback.value.status === 'pending')
const splashPending = computed(() => splashFeedback.value.status === 'pending')
const isCreatingMockChat = computed(() => isGuidanceOperation(guidanceOperationIds.mockChat))

const completeWithoutConfirmation = (
  controller: typeof guidanceFeedbackController,
  code: string,
  title: string
) => {
  controller.succeed({ code, title })
  controller.clearSettled()
}

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

  guidanceFeedbackController.begin(operationId, pendingLabel)
  try {
    if (!(await action())) {
      guidanceFeedbackController.fail({
        code: `${code}.unavailable`,
        title: unavailableTitle
      })
      return
    }
    const result = success?.()
    if (result) {
      guidanceFeedbackController.succeed(result)
    } else {
      completeWithoutConfirmation(guidanceFeedbackController, code, pendingLabel)
    }
  } catch (error) {
    console.error(
      '[DebugSettings] Guidance action failed',
      {
        code
      },
      error
    )
    guidanceFeedbackController.fail({
      code: `${code}.failed`,
      title: failureTitle
    })
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

const createMockChat = async () => {
  if (guidancePending.value) {
    return
  }

  let result: Awaited<ReturnType<typeof debugClient.createMockChatSession>> | undefined
  await runGuidanceAction({
    operationId: guidanceOperationIds.mockChat,
    code: 'settings.debug.mockChat',
    pendingLabel: t('about.mockChatCreating'),
    action: async () => {
      result = await debugClient.createMockChatSession()
      return Boolean(result.created && result.sessionId)
    },
    unavailableTitle: t('about.mockChatCreateUnavailable'),
    failureTitle: t('about.mockChatCreateFailed'),
    success: () => ({
      code: 'settings.debug.mockChat.created',
      title: t('about.mockChatCreated'),
      description: t('about.mockChatCreatedDesc', {
        title: result?.title ?? result?.sessionId ?? '',
        count: result?.messageCount ?? 0
      })
    })
  })
}

const showSplashScenario = async (mode: SplashDebugMode) => {
  if (splashPending.value) {
    return
  }

  const operationId = splashOperationId(mode)
  splashFeedbackController.begin(operationId, t(`settings.debug.splash.${mode}`))
  try {
    const result = await debugClient.showSplashScenario(mode)
    if (!result.shown) {
      splashFeedbackController.fail({
        code: 'settings.debug.splash.unavailable',
        title: t('settings.debug.unavailableDescription')
      })
      return
    }
    isSplashPreviewOpen.value = true
    completeWithoutConfirmation(
      splashFeedbackController,
      'settings.debug.splash.shown',
      t(`settings.debug.splash.${mode}`)
    )
  } catch (error) {
    console.error('[DebugSettings] Failed to show Splash preview', error)
    splashFeedbackController.fail({
      code: 'settings.debug.splash.showFailed',
      title: t('settings.debug.guidance.failed')
    })
  }
}

const closeSplashScenario = async () => {
  if (splashPending.value || !isSplashPreviewOpen.value) {
    return
  }

  splashFeedbackController.begin(splashOperationIds.close, t('common.close'))
  try {
    const result = await debugClient.closeSplashScenario()
    if (!result.closed) {
      splashFeedbackController.fail({
        code: 'settings.debug.splash.closeUnavailable',
        title: t('settings.debug.unavailableDescription')
      })
      return
    }
    isSplashPreviewOpen.value = false
    completeWithoutConfirmation(
      splashFeedbackController,
      'settings.debug.splash.closed',
      t('common.close')
    )
  } catch (error) {
    console.error('[DebugSettings] Failed to close Splash preview', error)
    splashFeedbackController.fail({
      code: 'settings.debug.splash.closeFailed',
      title: t('settings.debug.guidance.failed')
    })
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
