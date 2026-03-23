<template>
  <div class="h-full w-full flex flex-col window-drag-region">
    <div class="flex-1 flex flex-col items-center justify-center px-6">
      <div class="mb-5">
        <img src="@/assets/logo-dark.png" class="w-16 h-16" loading="lazy" />
      </div>

      <h1 class="mb-2 text-3xl font-semibold text-foreground">
        {{ t('welcome.agentPage.title') }}
      </h1>
      <p class="mb-10 max-w-xl text-center text-sm text-muted-foreground">
        {{ t('welcome.agentPage.description') }}
      </p>

      <div class="grid w-full max-w-3xl gap-3 md:grid-cols-2 xl:grid-cols-3">
        <button
          v-for="agent in agentStore.enabledAgents"
          :key="agent.id"
          class="flex items-center gap-3 rounded-2xl border border-border/60 bg-card/40 px-4 py-4 text-left transition-all duration-150 hover:border-border hover:bg-accent/40"
          @click="selectAgent(agent.id)"
        >
          <div
            class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted/50 text-foreground"
          >
            <AgentAvatar :agent="agent" class-name="h-6 w-6" fallback-class-name="rounded-lg" />
          </div>
          <div class="min-w-0 flex-1">
            <div class="truncate text-sm font-semibold text-foreground">{{ agent.name }}</div>
            <div class="truncate text-xs text-muted-foreground">
              {{ agent.type === 'deepchat' ? t('welcome.agentPage.deepchatType') : 'ACP' }}
            </div>
          </div>
          <Icon icon="lucide:chevron-right" class="h-4 w-4 text-muted-foreground/50" />
        </button>
      </div>

      <div class="mt-8 flex flex-wrap items-center justify-center gap-2">
        <Button size="sm" @click="openAgentSettings">
          {{ t('welcome.agentPage.newDeepChatAgent') }}
        </Button>
        <Button size="sm" variant="outline" @click="openAgentSettings">
          {{ t('welcome.agentPage.manageAgents') }}
        </Button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Icon } from '@iconify/vue'
import { Button } from '@shadcn/components/ui/button'
import { useI18n } from 'vue-i18n'
import { usePresenter } from '@/composables/usePresenter'
import { SETTINGS_EVENTS } from '@/events'
import { useAgentStore } from '@/stores/ui/agent'
import AgentAvatar from '@/components/icons/AgentAvatar.vue'

const { t } = useI18n()
const windowPresenter = usePresenter('windowPresenter')
const agentStore = useAgentStore()

const selectAgent = (agentId: string) => {
  agentStore.setSelectedAgent(agentId)
}

const openAgentSettings = async () => {
  await windowPresenter.createSettingsWindow()
  const settingsWindowId = windowPresenter.getSettingsWindowId()
  if (settingsWindowId != null) {
    windowPresenter.sendToWindow(settingsWindowId, SETTINGS_EVENTS.NAVIGATE, {
      routeName: 'settings-deepchat-agents'
    })
  }
}
</script>

<style scoped>
.window-drag-region {
  -webkit-app-region: drag;
}

button,
[role='button'] {
  -webkit-app-region: no-drag;
}
</style>
