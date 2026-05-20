<template>
  <div ref="rootRef" class="relative h-full w-full flex flex-col window-drag-region">
    <div
      v-if="showGuideCoachmark"
      data-testid="welcome-guide-coachmark"
      :data-guide-target="coachmarkTargetSurface"
      class="pointer-events-none fixed inset-0 z-70"
    >
      <div
        v-for="(blockerStyle, blockerIndex) in coachmarkBlockerStyles"
        :key="blockerIndex"
        data-testid="welcome-guide-blocker"
        class="pointer-events-auto absolute"
        :style="blockerStyle"
        @click.stop.prevent
      />

      <div
        v-if="coachmarkSpotlightStyle"
        data-testid="welcome-guide-spotlight"
        class="pointer-events-none absolute rounded-[28px] border border-primary/70 bg-transparent transition-all duration-200"
        :style="coachmarkSpotlightStyle"
      />

      <div
        data-testid="welcome-guide-panel"
        role="dialog"
        aria-modal="true"
        class="welcome-guide-coachmark pointer-events-auto absolute rounded-2xl border border-border/80 bg-background/95 p-4 shadow-2xl backdrop-blur"
        :style="coachmarkPanelStyle"
      >
        <div class="flex items-center justify-between gap-3">
          <p class="text-[11px] uppercase tracking-[0.18em] text-primary/80">
            {{ t('welcome.page.guide.title') }}
          </p>
          <span
            class="rounded-full border border-border/70 bg-muted/80 px-2 py-0.5 text-[11px] text-muted-foreground"
          >
            {{ coachmarkStepIndex }}/{{ coachmarkTotalSteps }}
          </span>
        </div>

        <h2 class="mt-3 text-sm font-semibold text-foreground">
          {{ coachmarkStepTitle }}
        </h2>
        <p class="mt-2 text-xs leading-5 text-muted-foreground">
          {{ t('welcome.page.guide.description', { step: coachmarkStepTitle }) }}
        </p>

        <div class="mt-4 flex flex-wrap items-start justify-between gap-3">
          <div class="flex max-w-full flex-wrap items-center gap-2">
            <button
              data-testid="welcome-guide-prev-action"
              type="button"
              class="whitespace-nowrap rounded-lg border border-border/80 px-3 py-1.5 text-xs transition-colors"
              :class="
                canGoToPreviousGuideStep
                  ? 'text-foreground hover:bg-accent/50'
                  : 'cursor-not-allowed text-muted-foreground/50'
              "
              :disabled="!canGoToPreviousGuideStep"
              @click="goToPreviousGuideStep"
            >
              {{ t('common.back') }}
            </button>

            <button
              data-testid="welcome-guide-next-action"
              type="button"
              class="whitespace-nowrap rounded-lg border border-border/80 px-3 py-1.5 text-xs transition-colors"
              :class="
                canGoToNextGuideStep
                  ? 'text-foreground hover:bg-accent/50'
                  : 'cursor-not-allowed text-muted-foreground/50'
              "
              :disabled="!canGoToNextGuideStep"
              @click="goToNextGuideStep"
            >
              {{ t('common.next') }}
            </button>
          </div>

          <div class="flex max-w-full flex-wrap items-center justify-end gap-2">
            <button
              data-testid="welcome-guide-close-action"
              type="button"
              class="whitespace-nowrap rounded-lg border border-border/80 px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
              @click="dismissGuideCoachmark"
            >
              {{ t('common.close') }}
            </button>

            <button
              data-testid="welcome-guide-expert-action"
              type="button"
              class="whitespace-nowrap rounded-lg border border-border/80 px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
              @click="handleExperiencedGuideAction"
            >
              {{ t('settings.skills.sync.skipAll') }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <div class="flex-1 flex flex-col items-center justify-center px-6">
      <!-- Logo -->
      <div class="mb-5">
        <img src="@/assets/logo-dark.png" class="w-16 h-16" loading="lazy" />
      </div>

      <!-- Heading -->
      <h1 class="text-3xl font-semibold text-foreground mb-2">
        {{ t('welcome.page.title') }}
      </h1>
      <p class="text-sm text-muted-foreground text-center max-w-md mb-10">
        {{ t('welcome.page.description') }}
      </p>

      <div
        ref="guideCardRef"
        v-if="onboardingState"
        data-testid="welcome-guide-card"
        class="w-full max-w-sm mb-6 rounded-2xl border border-border/70 bg-card/50 px-4 py-4 shadow-sm"
      >
        <div class="flex items-start justify-between gap-4">
          <div class="min-w-0">
            <p class="text-[11px] uppercase tracking-[0.18em] text-muted-foreground/70">
              {{ t('welcome.page.guide.title') }}
            </p>
            <p class="mt-2 text-sm text-foreground/85">
              {{ t('welcome.page.guide.description', { step: currentGuideStepTitle }) }}
            </p>
          </div>
          <button
            data-testid="welcome-guide-primary-action"
            class="shrink-0 whitespace-nowrap rounded-lg border border-border/80 px-3 py-1.5 text-xs text-foreground transition-colors hover:bg-accent/50"
            @click="handlePrimaryGuideAction"
          >
            {{ primaryGuideActionLabel }}
          </button>
        </div>

        <div class="mt-4 flex items-center justify-between text-xs text-muted-foreground">
          <span>{{ t('welcome.page.guide.coreProgress') }}</span>
          <span>{{ completedRequiredSteps }}/{{ requiredGuideSteps.length }}</span>
        </div>

        <div class="mt-3 grid grid-cols-3 gap-2">
          <div
            v-for="step in requiredGuideSteps"
            :key="step.id"
            class="rounded-xl border px-3 py-2"
            :class="guideStepClass(step.id, step.status)"
          >
            <div class="flex items-center gap-2">
              <Icon
                :icon="guideStepIcon(step.id, step.status)"
                class="h-3.5 w-3.5 shrink-0"
                :class="guideStepIconClass(step.id, step.status)"
              />
              <span class="truncate text-[11px] font-medium">
                {{ guideStepTitle(step.id) }}
              </span>
            </div>
          </div>
        </div>

        <div v-if="optionalGuideSteps.length > 0" class="mt-4">
          <p class="text-[11px] text-muted-foreground/70">
            {{ t('welcome.page.guide.optional') }}
          </p>
          <div class="mt-2 flex flex-wrap gap-2">
            <span
              v-for="step in optionalGuideSteps"
              :key="step.id"
              class="rounded-full border border-border/70 px-2.5 py-1 text-[11px] text-muted-foreground"
            >
              {{ guideStepTitle(step.id) }}
            </span>
          </div>
        </div>
      </div>

      <!-- Provider grid -->
      <div
        ref="providerGridRef"
        data-testid="welcome-provider-grid"
        class="grid grid-cols-3 gap-2 w-full max-w-sm mb-4"
      >
        <button
          v-for="provider in providers"
          :key="provider.id"
          class="flex flex-col items-center gap-2 rounded-xl border border-border/60 bg-card/40 px-3 py-4 hover:bg-accent/50 hover:border-border transition-all duration-150"
          @click="onAddProvider"
        >
          <ModelIcon :model-id="provider.id" custom-class="w-6 h-6" :is-dark="themeStore.isDark" />
          <span class="text-xs text-foreground/80">{{ t(provider.nameKey) }}</span>
        </button>

        <button
          data-testid="welcome-provider-import-action"
          type="button"
          class="col-span-3 inline-flex items-center justify-center gap-2 rounded-xl border border-primary/30 bg-primary/10 px-3 py-3 text-xs font-medium text-primary transition-all duration-150 hover:border-primary/45 hover:bg-primary/15 active:scale-[0.99]"
          @click="onImportProviders"
        >
          <Icon icon="lucide:download" class="h-3.5 w-3.5" />
          <span class="truncate">{{ t('welcome.page.importProviders') }}</span>
        </button>
      </div>

      <div class="mb-12 flex flex-wrap items-center justify-center gap-3">
        <button
          class="text-xs text-muted-foreground hover:text-foreground transition-colors"
          @click="onAddProvider"
        >
          {{ t('welcome.page.browseProviders') }}
        </button>
      </div>

      <!-- ACP agent section (optional) -->
      <div class="flex flex-col items-center gap-3 w-full max-w-sm">
        <div class="flex items-center gap-3 w-full">
          <div class="flex-1 h-px bg-border"></div>
          <span class="text-xs text-muted-foreground/60">{{ t('welcome.page.connectAgent') }}</span>
          <div class="flex-1 h-px bg-border"></div>
        </div>

        <button
          class="flex items-center gap-3 w-full rounded-xl border border-dashed border-border/60 px-4 py-3 hover:bg-accent/30 hover:border-border transition-all duration-150"
          @click="onSetupAcp"
        >
          <div class="flex items-center justify-center w-8 h-8 rounded-lg bg-muted/60 shrink-0">
            <Icon icon="lucide:terminal" class="w-4 h-4 text-muted-foreground" />
          </div>
          <div class="text-left">
            <p class="text-sm text-foreground/80">{{ t('welcome.page.acpTitle') }}</p>
            <p class="text-xs text-muted-foreground/60">{{ t('welcome.page.acpDescription') }}</p>
          </div>
          <Icon icon="lucide:chevron-right" class="w-4 h-4 text-muted-foreground/40 ml-auto" />
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Icon } from '@iconify/vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { createConfigClient } from '@api/ConfigClient'
import { createOnboardingClient } from '@api/OnboardingClient'
import { useThemeStore } from '@/stores/theme'
import { usePageRouterStore } from '@/stores/ui/pageRouter'
import {
  persistGuidedOnboardingResumeIntent,
  type GuidedOnboardingResumeTrigger
} from '@/lib/onboardingResume'
import {
  getNextGuidedOnboardingStepId,
  getPreviousGuidedOnboardingStepId,
  isGuidedOnboardingChatStepId,
  resolveGuidedOnboardingStepTarget,
  type GuidedOnboardingSettingsRouteName
} from '@shared/guidedOnboarding'
import ModelIcon from '@/components/icons/ModelIcon.vue'
import type {
  GuidedOnboardingState,
  GuidedOnboardingStepId,
  GuidedOnboardingStepStatus
} from '@shared/contracts/routes'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const configClient = createConfigClient()
const onboardingClient = createOnboardingClient()
const themeStore = useThemeStore()
const pageRouter = usePageRouterStore()
const onboardingState = ref<GuidedOnboardingState | null>(null)
const rootRef = ref<HTMLElement | null>(null)
const guideCardRef = ref<HTMLElement | null>(null)
const providerGridRef = ref<HTMLElement | null>(null)
const guideCoachmarkDismissed = ref(false)
const coachmarkSpotlightStyle = ref<Record<string, string> | null>(null)
const coachmarkBlockerStyles = ref<Record<string, string>[]>([
  {
    inset: '0'
  }
])
const coachmarkPanelStyle = ref<Record<string, string>>({
  top: '24px',
  left: '24px',
  width: 'min(320px, calc(100% - 32px))'
})

const providers = [
  { id: 'claude', nameKey: 'welcome.page.providers.claude' },
  { id: 'openai', nameKey: 'welcome.page.providers.openai' },
  { id: 'deepseek', nameKey: 'welcome.page.providers.deepseek' },
  { id: 'gemini', nameKey: 'welcome.page.providers.gemini' },
  { id: 'ollama', nameKey: 'welcome.page.providers.ollama' },
  { id: 'openrouter', nameKey: 'welcome.page.providers.openrouter' }
]

type SettingsRouteName = GuidedOnboardingSettingsRouteName | 'settings-acp' | 'settings-database'

const requiredGuideSteps = computed(
  () => onboardingState.value?.steps?.filter((step) => step.required) ?? []
)
const optionalGuideSteps = computed(
  () => onboardingState.value?.steps?.filter((step) => !step.required) ?? []
)
const completedRequiredSteps = computed(
  () => requiredGuideSteps.value.filter((step) => step.status === 'completed').length
)
const guideStepTitle = (stepId: GuidedOnboardingStepId) => {
  switch (stepId) {
    case 'select-provider':
      return t('welcome.provider.select')
    case 'provider-api-key':
      return t('welcome.provider.apiKey')
    case 'provider-model':
      return t('settings.provider.center.tabs.models')
    case 'switch-agent':
      return t('chat.onboarding.agentSwitch.title')
    case 'mcp':
    case 'skills':
    case 'switch-model':
    case 'first-chat':
      return t(`welcome.page.guide.steps.${stepId}`)
    default:
      return stepId
  }
}
const currentGuideStepId = computed<GuidedOnboardingStepId>(() => {
  if (onboardingState.value?.currentStepId) {
    return onboardingState.value.currentStepId
  }

  return (
    onboardingState.value?.steps?.find((step) => step.status === 'pending')?.id ?? 'select-provider'
  )
})
const currentGuideStepTitle = computed(() => guideStepTitle(currentGuideStepId.value))
const primaryGuideActionLabel = computed(() =>
  isGuidedOnboardingChatStepId(currentGuideStepId.value)
    ? t('welcome.page.guide.actions.goToChat')
    : t('welcome.page.guide.actions.continueSetup')
)
const guideStepIds = computed(() => onboardingState.value?.steps?.map((step) => step.id) ?? [])
const coachmarkStepId = computed<GuidedOnboardingStepId>(() => currentGuideStepId.value)
const coachmarkStepTitle = computed(() => guideStepTitle(coachmarkStepId.value))
const showGuideCoachmark = computed(
  () => onboardingState.value?.status === 'active' && !guideCoachmarkDismissed.value
)
const coachmarkTargetSurface = computed<'guide-card' | 'providers'>(() =>
  coachmarkStepId.value === 'select-provider' ? 'providers' : 'guide-card'
)
const coachmarkStepIndex = computed(() => {
  const stepIndex = guideStepIds.value.findIndex((stepId) => stepId === coachmarkStepId.value)
  return stepIndex != null && stepIndex >= 0 ? stepIndex + 1 : 1
})
const coachmarkTotalSteps = computed(() => onboardingState.value?.steps?.length ?? 1)
const canGoToPreviousGuideStep = computed(() =>
  Boolean(getPreviousGuidedOnboardingStepId(currentGuideStepId.value))
)
const canGoToNextGuideStep = computed(() => coachmarkStepIndex.value < coachmarkTotalSteps.value)

const resolveCoachmarkTargetElement = () =>
  coachmarkTargetSurface.value === 'providers' ? providerGridRef.value : guideCardRef.value

const persistGuideResumeIntent = (
  trigger: GuidedOnboardingResumeTrigger,
  stepId: GuidedOnboardingStepId = currentGuideStepId.value
) => {
  if (onboardingState.value?.status !== 'active') {
    return
  }

  persistGuidedOnboardingResumeIntent({ stepId, trigger })
}

const updateGuideCoachmarkLayout = async () => {
  await nextTick()

  const targetElement = resolveCoachmarkTargetElement()
  if (!targetElement) {
    coachmarkSpotlightStyle.value = null
    coachmarkBlockerStyles.value = [{ inset: '0' }]
    coachmarkPanelStyle.value = {
      top: '24px',
      left: '24px',
      width: 'min(320px, calc(100% - 32px))'
    }
    return
  }

  const targetRect = targetElement.getBoundingClientRect()
  const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0
  if (viewportWidth < 1 || viewportHeight < 1 || targetRect.width < 1 || targetRect.height < 1) {
    coachmarkSpotlightStyle.value = null
    coachmarkBlockerStyles.value = [{ inset: '0' }]
    coachmarkPanelStyle.value = {
      top: '24px',
      left: '24px',
      width: 'min(320px, calc(100% - 32px))'
    }
    return
  }

  const padding = 12
  const spotlightTop = Math.max(targetRect.top - padding, 16)
  const spotlightLeft = Math.max(targetRect.left - padding, 16)
  const spotlightWidth = Math.min(
    targetRect.width + padding * 2,
    Math.max(viewportWidth - spotlightLeft - 16, 0)
  )
  const spotlightHeight = Math.min(
    targetRect.height + padding * 2,
    Math.max(viewportHeight - spotlightTop - 16, 0)
  )

  coachmarkSpotlightStyle.value = {
    top: `${spotlightTop}px`,
    left: `${spotlightLeft}px`,
    width: `${spotlightWidth}px`,
    height: `${spotlightHeight}px`,
    boxShadow: '0 0 0 9999px rgba(15, 23, 42, 0.56)'
  }
  const spotlightRight = spotlightLeft + spotlightWidth
  const spotlightBottom = spotlightTop + spotlightHeight
  coachmarkBlockerStyles.value = [
    {
      top: '0px',
      left: '0px',
      right: '0px',
      height: `${spotlightTop}px`
    },
    {
      top: `${spotlightTop}px`,
      left: '0px',
      width: `${spotlightLeft}px`,
      height: `${spotlightHeight}px`
    },
    {
      top: `${spotlightTop}px`,
      left: `${spotlightRight}px`,
      right: '0px',
      height: `${spotlightHeight}px`
    },
    {
      top: `${spotlightBottom}px`,
      left: '0px',
      right: '0px',
      bottom: '0px'
    }
  ]

  const panelWidth = Math.min(320, Math.max(180, viewportWidth - 32))
  const panelHeightEstimate = 168
  const desiredTop = spotlightTop + spotlightHeight + 20
  const placeAbove = desiredTop + panelHeightEstimate > viewportHeight - 16
  const panelTop = placeAbove
    ? Math.max(16, spotlightTop - panelHeightEstimate - 20)
    : Math.min(Math.max(16, viewportHeight - panelHeightEstimate - 16), desiredTop)
  const panelLeft = Math.min(
    Math.max(16, spotlightLeft),
    Math.max(16, viewportWidth - panelWidth - 16)
  )

  coachmarkPanelStyle.value = {
    top: `${panelTop}px`,
    left: `${panelLeft}px`,
    width: `${panelWidth}px`
  }
}

const dismissGuideCoachmark = () => {
  guideCoachmarkDismissed.value = true
}

const resumeGuideStep = async (stepId: GuidedOnboardingStepId) => {
  const action = resolveGuideAction(stepId)

  if (action.kind === 'chat') {
    await goToChat(action.stepId)
    return
  }

  persistGuideResumeIntent('window-focus', action.stepId)
  await openSettings(action.routeName, action.stepId)
}

const goToPreviousGuideStep = async () => {
  const previousStepId = getPreviousGuidedOnboardingStepId(currentGuideStepId.value)
  if (!previousStepId) {
    return
  }

  await resumeGuideStep(previousStepId)
}

const goToNextGuideStep = async () => {
  if (!canGoToNextGuideStep.value) {
    return
  }

  await handlePrimaryGuideAction()
}

const syncOnboardingState = async () => {
  try {
    const state = await onboardingClient.getState()
    onboardingState.value = state.status === 'idle' ? await onboardingClient.start() : state
    guideCoachmarkDismissed.value = false
  } catch (error) {
    console.error('Failed to sync welcome onboarding state:', error)
  }
}

const syncOnboardingStep = async (stepId?: GuidedOnboardingStepId) => {
  if (!stepId) {
    return
  }

  try {
    onboardingState.value = await onboardingClient.start({ stepId })
  } catch (error) {
    console.error(`Failed to start onboarding step ${stepId}:`, error)
  }
}

const goToChat = async (stepId?: GuidedOnboardingStepId) => {
  await syncOnboardingStep(stepId)
  pageRouter.goToNewThread()

  if (route.name === 'welcome') {
    await router.replace({ name: 'chat' })
  }
}

const openSettings = async (
  routeName: SettingsRouteName,
  stepId?: GuidedOnboardingStepId,
  section?: string
) => {
  await syncOnboardingStep(stepId)
  await configClient.openSettings({ routeName, section })
}

const resolveGuideAction = (
  stepId: GuidedOnboardingStepId
):
  | { kind: 'chat'; stepId: GuidedOnboardingStepId }
  | { kind: 'settings'; routeName: SettingsRouteName; stepId: GuidedOnboardingStepId } => {
  const target = resolveGuidedOnboardingStepTarget(stepId)

  if (target?.surface === 'chat') {
    return {
      kind: 'chat',
      stepId: target.stepId
    }
  }

  if (target?.surface === 'settings' && target.routeName) {
    return {
      kind: 'settings',
      routeName: target.routeName,
      stepId: target.stepId
    }
  }

  return {
    kind: 'settings',
    routeName: 'settings-provider',
    stepId: 'select-provider'
  }
}

const guideStepClass = (_stepId: GuidedOnboardingStepId, status: GuidedOnboardingStepStatus) => {
  if (status === 'completed') {
    return 'border-emerald-500/50 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
  }

  if (status === 'in_progress') {
    return 'border-primary/60 bg-primary/10 text-foreground'
  }

  return 'border-border/70 bg-background/60 text-muted-foreground'
}

const guideStepIcon = (_stepId: GuidedOnboardingStepId, status: GuidedOnboardingStepStatus) => {
  if (status === 'completed') {
    return 'lucide:check-circle-2'
  }

  if (status === 'in_progress') {
    return 'lucide:circle-dot'
  }

  return 'lucide:circle'
}

const guideStepIconClass = (
  _stepId: GuidedOnboardingStepId,
  status: GuidedOnboardingStepStatus
) => {
  if (status === 'completed') {
    return 'text-emerald-600 dark:text-emerald-300'
  }

  if (status === 'in_progress') {
    return 'text-primary'
  }

  return 'text-muted-foreground/70'
}

const handlePrimaryGuideAction = async () => {
  const action = resolveGuideAction(currentGuideStepId.value)

  if (action.kind === 'chat') {
    await goToChat(action.stepId)
    return
  }

  persistGuideResumeIntent('window-focus', action.stepId)
  await openSettings(action.routeName, action.stepId)
}

const handleExperiencedGuideAction = async () => {
  try {
    onboardingState.value = await onboardingClient.complete({ force: true })
    pageRouter.goToNewThread({ refresh: true })

    if (route.name === 'welcome') {
      await router.replace({ name: 'chat' })
    }
  } catch (error) {
    console.error('Failed to skip guided onboarding:', error)
  }
}

const onAddProvider = async () => {
  persistGuideResumeIntent('window-focus', 'select-provider')
  await openSettings('settings-provider', 'select-provider')
}

const getProviderImportGuideStepId = (): GuidedOnboardingStepId => {
  if (onboardingState.value?.status !== 'active') {
    return 'select-provider'
  }

  if (currentGuideStepId.value !== 'select-provider') {
    return currentGuideStepId.value
  }

  return getNextGuidedOnboardingStepId('select-provider') ?? 'provider-api-key'
}

const onImportProviders = async () => {
  const stepId = getProviderImportGuideStepId()
  persistGuideResumeIntent('window-focus', stepId)
  await openSettings('settings-database', stepId, 'provider-import')
}

const onSetupAcp = async () => {
  await openSettings('settings-acp')
}

onMounted(() => {
  void syncOnboardingState()
  window.addEventListener('resize', updateGuideCoachmarkLayout)
})

watch(
  () => [showGuideCoachmark.value, coachmarkTargetSurface.value, coachmarkStepId.value] as const,
  ([visible]) => {
    if (!visible) {
      return
    }

    void updateGuideCoachmarkLayout()
  },
  { flush: 'post', immediate: true }
)

onBeforeUnmount(() => {
  window.removeEventListener('resize', updateGuideCoachmarkLayout)
})
</script>

<style scoped>
.window-drag-region {
  -webkit-app-region: drag;
}

.welcome-guide-coachmark,
.welcome-guide-coachmark * {
  -webkit-app-region: no-drag;
}

button,
a,
input,
select,
textarea,
[role='button'] {
  -webkit-app-region: no-drag;
}
</style>
