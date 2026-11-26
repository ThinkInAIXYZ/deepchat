<template>
  <McpSettingsView
    scope="agent"
    :agent-id="agentStore.selectedAgentId ?? undefined"
    @open-global-settings="settingsClient.openSettings({ routeName: 'settings-mcp' })"
    @continue-onboarding="continueOnboarding"
  />
</template>

<script setup lang="ts">
import { useRouter } from 'vue-router'
import { createOnboardingClient } from '@api/OnboardingClient'
import { createSettingsClient } from '@api/SettingsClient'
import { createWindowClient } from '@api/WindowClient'
import type { GuidedOnboardingState } from '@shared/contracts/routes'
import { resolveGuidedOnboardingStepTarget } from '@shared/guidedOnboarding'
import McpSettingsView from '@/features/mcp/McpSettingsView.vue'
import { useAgentStore } from '@/stores/ui/agent'
import { persistGuidedOnboardingResumeIntent } from '@/lib/onboardingResume'

const router = useRouter()
const agentStore = useAgentStore()
const settingsClient = createSettingsClient()
const onboardingClient = createOnboardingClient()
const windowClient = createWindowClient()

const continueOnboarding = async (state: GuidedOnboardingState | null) => {
  if (state?.status !== 'completed' && (state?.status !== 'active' || !state.currentStepId)) {
    try {
      state = await onboardingClient.getState()
    } catch (error) {
      console.warn('[McpPluginsPage] Failed to refresh onboarding state:', error)
    }
  }
  const stepId =
    state?.status === 'completed'
      ? 'first-chat'
      : state?.status === 'active'
        ? state.currentStepId
        : null
  const target = resolveGuidedOnboardingStepTarget(stepId)
  if (target?.surface === 'plugins') {
    await router.push({ name: target.routeName })
  } else if (target?.surface === 'settings') {
    if (target.routeName === 'settings-mcp') {
      await router.push({ name: 'plugins-mcp' })
    } else {
      persistGuidedOnboardingResumeIntent({ stepId: target.stepId, trigger: 'window-focus' })
      await settingsClient.openSettings({ routeName: target.routeName })
    }
  } else {
    await windowClient.resumeGuidedOnboarding()
  }
}
</script>
