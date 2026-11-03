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
import { createWindowClient } from '@api/WindowClient'
import type { GuidedOnboardingState } from '@shared/contracts/routes'
import McpSettingsView from '@/features/mcp/McpSettingsView.vue'
import { continueGuidedOnboardingFromSettings } from '../lib/guidedOnboardingSettings'

const route = useRoute()
const router = useRouter()
const windowClient = createWindowClient()

const openMarket = () =>
  router.push({ name: 'settings-mcp', query: { ...route.query, view: 'market' } })

const closeMarket = () => {
  const query = { ...route.query }
  delete query.view
  return router.replace({ name: 'settings-mcp', query })
}

const continueOnboarding = (state: GuidedOnboardingState | null) =>
  continueGuidedOnboardingFromSettings({ state, router, windowClient })

const openKnowledgeSettings = (subtab: string) =>
  router.push({ name: 'settings-knowledge-base', query: { subtab } })
</script>
