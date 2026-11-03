<template>
  <McpSettingsView
    :market="route.query.view === 'market'"
    @open-market="openMarket"
    @close-market="closeMarket"
    @continue-onboarding="continueOnboarding"
    @open-knowledge-settings="openKnowledgeSettings"
  />
</template>

<script setup lang="ts">
import { useRoute, useRouter } from 'vue-router'
import { createOnboardingClient } from '@api/OnboardingClient'
import { createSettingsClient } from '@api/SettingsClient'
import { createWindowClient } from '@api/WindowClient'
import type { GuidedOnboardingState } from '@shared/contracts/routes'
import { resolveGuidedOnboardingStepTarget } from '@shared/guidedOnboarding'
import McpSettingsView from '@/features/mcp/McpSettingsView.vue'
import { persistGuidedOnboardingResumeIntent } from '@/lib/onboardingResume'

const route = useRoute()
const router = useRouter()
const settingsClient = createSettingsClient()
const onboardingClient = createOnboardingClient()
const windowClient = createWindowClient()

const openMarket = () =>
  router.push({ name: 'plugins-mcp', query: { ...route.query, view: 'market' } })

const closeMarket = () => {
  const query = { ...route.query }
  delete query.view
  return router.replace({ name: 'plugins-mcp', query })
}

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

const openKnowledgeSettings = (subtab: string) =>
  settingsClient.openSettings({ routeName: 'settings-knowledge-base', section: subtab })
</script>
