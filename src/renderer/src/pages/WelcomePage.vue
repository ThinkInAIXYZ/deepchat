<template>
  <div class="h-full w-full flex flex-col window-drag-region">
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

      <!-- Provider grid -->
      <div class="grid grid-cols-3 gap-2 w-full max-w-sm mb-4">
        <button
          v-for="provider in providers"
          :key="provider.id"
          class="flex flex-col items-center gap-2 rounded-xl border border-border/60 bg-card/40 px-3 py-4 hover:bg-accent/50 hover:border-border transition-all duration-150"
          @click="onAddProvider"
        >
          <ModelIcon :model-id="provider.id" custom-class="w-6 h-6" :is-dark="themeStore.isDark" />
          <span class="text-xs text-foreground/80">{{ t(provider.nameKey) }}</span>
        </button>
      </div>

      <button
        class="text-xs text-muted-foreground hover:text-foreground transition-colors mb-12"
        @click="onAddProvider"
      >
        {{ t('welcome.page.browseProviders') }}
      </button>

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
import { Icon } from '@iconify/vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { usePresenter } from '@/composables/usePresenter'
import { useThemeStore } from '@/stores/theme'
import { usePageRouterStore } from '@/stores/ui/pageRouter'
import { SETTINGS_EVENTS } from '@/events'
import ModelIcon from '@/components/icons/ModelIcon.vue'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const configPresenter = usePresenter('configPresenter')
const windowPresenter = usePresenter('windowPresenter')
const themeStore = useThemeStore()
const pageRouter = usePageRouterStore()

const providers = [
  { id: 'claude', nameKey: 'welcome.page.providers.claude' },
  { id: 'openai', nameKey: 'welcome.page.providers.openai' },
  { id: 'deepseek', nameKey: 'welcome.page.providers.deepseek' },
  { id: 'gemini', nameKey: 'welcome.page.providers.gemini' },
  { id: 'ollama', nameKey: 'welcome.page.providers.ollama' },
  { id: 'openrouter', nameKey: 'welcome.page.providers.openrouter' }
]

type SettingsRouteName = 'settings-provider' | 'settings-acp'

const navigateToSettings = (windowId: number, routeName: SettingsRouteName) => {
  windowPresenter.sendToWindow(windowId, SETTINGS_EVENTS.NAVIGATE, {
    routeName
  })
}

const openSettings = async (routeName: SettingsRouteName) => {
  const windowId = window.api.getWindowId()
  if (windowId == null) {
    return
  }

  await configPresenter.setSetting('init_complete', true)
  pageRouter.goToNewThread()

  if (route.name === 'welcome') {
    await router.replace({ name: 'chat' })
  }

  const settingsWindowId = await windowPresenter.createSettingsWindow()
  if (settingsWindowId != null) {
    navigateToSettings(settingsWindowId, routeName)
  }
}

const onAddProvider = async () => {
  await openSettings('settings-provider')
}

const onSetupAcp = async () => {
  await openSettings('settings-acp')
}
</script>

<style scoped>
.window-drag-region {
  -webkit-app-region: drag;
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
