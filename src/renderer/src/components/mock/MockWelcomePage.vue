<template>
  <div class="h-full w-full flex flex-col window-drag-region">
    <div class="flex-1 flex flex-col items-center justify-center px-6">
      <!-- Logo -->
      <div class="mb-5">
        <img src="@/assets/logo-dark.png" class="w-16 h-16" loading="lazy" />
      </div>

      <!-- Heading -->
      <h1 class="text-3xl font-semibold text-foreground mb-2">Welcome to DeepChat Agent</h1>
      <p class="text-sm text-muted-foreground text-center max-w-md mb-10">
        Connect a model provider to start build
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
          <span class="text-xs text-foreground/80">{{ provider.name }}</span>
        </button>
      </div>

      <button
        class="text-xs text-muted-foreground hover:text-foreground transition-colors mb-12"
        @click="onAddProvider"
      >
        Browse all providers...
      </button>

      <!-- ACP agent section (optional) -->
      <div class="flex flex-col items-center gap-3 w-full max-w-sm">
        <div class="flex items-center gap-3 w-full">
          <div class="flex-1 h-px bg-border"></div>
          <span class="text-xs text-muted-foreground/60">or connect an agent</span>
          <div class="flex-1 h-px bg-border"></div>
        </div>

        <button
          class="flex items-center gap-3 w-full rounded-xl border border-dashed border-border/60 px-4 py-3 hover:bg-accent/30 hover:border-border transition-all duration-150"
          @click="onAddProvider"
        >
          <div class="flex items-center justify-center w-8 h-8 rounded-lg bg-muted/60 shrink-0">
            <Icon icon="lucide:terminal" class="w-4 h-4 text-muted-foreground" />
          </div>
          <div class="text-left">
            <p class="text-sm text-foreground/80">Set up an ACP agent</p>
            <p class="text-xs text-muted-foreground/60">Claude Code, Codex, Kimi, or your own</p>
          </div>
          <Icon icon="lucide:chevron-right" class="w-4 h-4 text-muted-foreground/40 ml-auto" />
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Icon } from '@iconify/vue'
import { usePresenter } from '@/composables/usePresenter'
import { useThemeStore } from '@/stores/theme'
import ModelIcon from '../icons/ModelIcon.vue'

const windowPresenter = usePresenter('windowPresenter')
const themeStore = useThemeStore()

const providers = [
  { id: 'claude', name: 'Claude' },
  { id: 'openai', name: 'OpenAI' },
  { id: 'deepseek', name: 'DeepSeek' },
  { id: 'gemini', name: 'Gemini' },
  { id: 'ollama', name: 'Ollama' },
  { id: 'openrouter', name: 'OpenRouter' }
]

const onAddProvider = () => {
  const windowId = window.api.getWindowId()
  if (windowId != null) {
    windowPresenter.openOrFocusSettingsTab(windowId)
  }
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
