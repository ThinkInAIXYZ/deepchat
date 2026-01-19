<template>
  <div class="w-full h-screen flex flex-col" :class="isWinMacOS ? '' : 'bg-background'">
    <div
      class="w-full h-9 window-drag-region shrink-0 justify-end flex flex-row relative border border-b-0 border-window-inner-border box-border rounded-t-[10px]"
      :class="[
        isMacOS ? '' : ' ounded-t-none',
        isMacOS ? 'bg-window-background' : 'bg-window-background/10'
      ]"
    >
      <div class="absolute bottom-0 left-0 w-full h-[1px] bg-border z-10"></div>
      <Button
        v-if="!isMacOS"
        class="window-no-drag-region shrink-0 w-12 bg-transparent shadow-none rounded-none hover:bg-red-700/80 hover:text-white text-xs font-medium text-foreground flex items-center justify-center transition-all duration-200 group"
        @click="closeWindow"
      >
        <CloseIcon class="h-3! w-3!" />
      </Button>
    </div>
    <div class="w-full h-0 flex-1 flex flex-row bg-background relative">
      <div
        class="border-x border-b border-window-inner-border rounded-b-[10px] absolute z-10 top-0 left-0 bottom-0 right-0 pointer-events-none"
      ></div>
      <div class="w-52 h-full border-r border-border p-4 space-y-1 shrink-0 overflow-y-auto">
        <div
          v-for="setting in settings"
          :key="setting.name"
          :class="[
            'flex flex-row items-center hover:bg-accent gap-2 rounded-lg p-2 cursor-pointer',
            route.name === setting.name ? 'bg-accent' : ''
          ]"
          @click="handleClick(setting.path)"
        >
          <Icon :icon="setting.icon" class="w-4 h-4 text-muted-foreground" />
          <span class="text-sm font-medium">{{ t(setting.title) }}</span>
        </div>
      </div>
      <RouterView />
    </div>
    <ModelCheckDialog
      :open="modelCheckStore.isDialogOpen"
      :provider-id="modelCheckStore.currentProviderId"
      @update:open="
        (open) => {
          if (!open) modelCheckStore.closeDialog()
        }
      "
    />
    <Toaster :theme="toasterTheme" />
  </div>
</template>

<script setup lang="ts">
import { Icon } from '@iconify/vue'
import { useRouter, useRoute, RouterView } from 'vue-router'
import { onMounted, onBeforeUnmount, Ref, ref, watch, computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { useTitle } from '@vueuse/core'
import { usePresenter } from '../src/composables/usePresenter'
import CloseIcon from './icons/CloseIcon.vue'
import { useUiSettingsStore } from '../src/stores/uiSettingsStore'
import { useLanguageStore } from '../src/stores/language'
import { useModelCheckStore } from '../src/stores/modelCheck'
import { useWindowStore } from '../src/stores/windowStore'
import { Button } from '@shadcn/components/ui/button'
import ModelCheckDialog from '@/components/settings/ModelCheckDialog.vue'
import { Toaster } from '@shadcn/components/ui/sonner'
import 'vue-sonner/style.css'
import { NOTIFICATION_EVENTS } from '@/events'
import { useToast } from '@/components/use-toast'
import { useThemeStore } from '@/stores/theme'
import { useProviderStore } from '@/stores/providerStore'
import { useModelStore } from '@/stores/modelStore'
import { useOllamaStore } from '@/stores/ollamaStore'
import { useSearchAssistantStore } from '@/stores/searchAssistantStore'
import { useSearchEngineStore } from '@/stores/searchEngineStore'
import { useMcpStore } from '@/stores/mcp'
import { useMcpInstallDeeplinkHandler } from '../src/lib/storeInitializer'
import { useFontManager } from '../src/composables/useFontManager'

const windowPresenter = usePresenter('windowPresenter')
const configPresenter = usePresenter('configPresenter')

// Initialize stores
const uiSettingsStore = useUiSettingsStore()
const { setupFontListener } = useFontManager()
setupFontListener()

const languageStore = useLanguageStore()
const modelCheckStore = useModelCheckStore()
const windowStore = useWindowStore()
const { isMacOS, isWinMacOS } = storeToRefs(windowStore)
const { toast } = useToast()
const themeStore = useThemeStore()
const providerStore = useProviderStore()
const modelStore = useModelStore()
const ollamaStore = useOllamaStore()
const searchAssistantStore = useSearchAssistantStore()
const searchEngineStore = useSearchEngineStore()
const mcpStore = useMcpStore()
const { setup: setupMcpDeeplink, cleanup: cleanupMcpDeeplink } = useMcpInstallDeeplinkHandler()
// Register MCP deeplink listener immediately to avoid race with incoming IPC
setupMcpDeeplink()

const errorQueue = ref<Array<{ id: string; title: string; message: string; type: string }>>([])
const currentErrorId = ref<string | null>(null)
const errorDisplayTimer = ref<number | null>(null)
const toasterTheme = computed(() =>
  themeStore.themeMode === 'system' ? (themeStore.isDark ? 'dark' : 'light') : themeStore.themeMode
)
const { t, locale } = useI18n()
const router = useRouter()
const route = useRoute()
const title = useTitle()
const settings: Ref<
  {
    title: string
    name: string
    icon: string
    path: string
  }[]
> = ref([])

// Get all routes and build settings navigation
const routes = router.getRoutes()
onMounted(() => {
  void initializeSettingsStores()
  const tempArray: {
    title: string
    name: string
    icon: string
    path: string
    position: number
  }[] = []
  routes.forEach((route) => {
    // In settings window, all routes are top-level, no parent 'settings' route
    if (route.path !== '/' && route.meta?.titleKey) {
      console.log(`Adding settings route: ${route.path} with titleKey: ${route.meta.titleKey}`)
      tempArray.push({
        title: route.meta.titleKey as string,
        icon: route.meta.icon as string,
        path: route.path,
        name: route.name as string,
        position: (route.meta.position as number) || 999
      })
    }
    // Sort by position meta field, default to 999 if not present
    tempArray.sort((a, b) => {
      return a.position - b.position
    })
    settings.value = tempArray
    console.log('Final sorted settings routes:', settings.value)
  })
})

const initializeSettingsStores = async () => {
  try {
    await providerStore.initialize()
    await modelStore.initialize()
    await ollamaStore.initialize?.()
    await searchAssistantStore.initOrUpdateSearchAssistantModel()
    await searchEngineStore.refreshSearchEngines()
    searchEngineStore.setupSearchEnginesListener()
  } catch (error) {
    console.error('Failed to initialize settings stores', error)
  }
}

// Update title function
const updateTitle = () => {
  const currentRoute = route.name as string
  const currentSetting = settings.value.find((s) => s.name === currentRoute)
  if (currentSetting) {
    title.value = t('routes.settings') + ' - ' + t(currentSetting.title)
  } else {
    title.value = t('routes.settings')
  }
}

// Watch route changes
watch(
  () => route.name,
  () => {
    updateTitle()
  },
  { immediate: true }
)

const handleClick = (path: string) => {
  router.push(path)
}

// Watch language changes and update i18n + HTML dir
watch(
  () => languageStore.language,
  async () => {
    locale.value = await configPresenter.getLanguage()
    document.documentElement.dir = languageStore.dir
  }
)

// Watch font size changes and update classes
watch(
  () => uiSettingsStore.fontSizeClass,
  (newClass, oldClass) => {
    if (oldClass) document.documentElement.classList.remove(oldClass)
    document.documentElement.classList.add(newClass)
  }
)

const handleErrorClosed = () => {
  currentErrorId.value = null

  if (errorQueue.value.length > 0) {
    const nextError = errorQueue.value.shift()
    if (nextError) {
      displayError(nextError)
    }
  } else if (errorDisplayTimer.value) {
    clearTimeout(errorDisplayTimer.value)
    errorDisplayTimer.value = null
  }
}

const displayError = (error: { id: string; title: string; message: string; type: string }) => {
  currentErrorId.value = error.id

  const { dismiss } = toast({
    title: error.title,
    description: error.message,
    variant: 'destructive',
    onOpenChange: (open) => {
      if (!open) {
        handleErrorClosed()
      }
    }
  })

  if (errorDisplayTimer.value) {
    clearTimeout(errorDisplayTimer.value)
  }

  errorDisplayTimer.value = window.setTimeout(() => {
    dismiss()
  }, 3000)
}

const showErrorToast = (error: { id: string; title: string; message: string; type: string }) => {
  const exists = errorQueue.value.findIndex((item) => item.id === error.id)
  if (exists !== -1) {
    return
  }

  if (currentErrorId.value) {
    if (errorQueue.value.length > 5) {
      errorQueue.value.shift()
    }
    errorQueue.value.push(error)
    return
  }

  displayError(error)
}

onMounted(async () => {
  window.electron.ipcRenderer.on(NOTIFICATION_EVENTS.SHOW_ERROR, (_event, error) => {
    showErrorToast(error)
  })

  await uiSettingsStore.loadSettings()

  // Wait for router to be ready
  await router.isReady()

  // Check for pending MCP install from localStorage
  try {
    const pendingMcpInstall = localStorage.getItem('pending-mcp-install')
    if (pendingMcpInstall) {
      console.log('Found pending MCP install in localStorage:', pendingMcpInstall)
      // Clear the localStorage immediately to prevent re-processing
      localStorage.removeItem('pending-mcp-install')

      // Parse and process the MCP configuration
      const mcpConfig = JSON.parse(pendingMcpInstall)

      if (!mcpConfig?.mcpServers || typeof mcpConfig.mcpServers !== 'object') {
        console.error('Invalid MCP install config, missing mcpServers')
        return
      }

      // Enable MCP if not already enabled
      if (!mcpStore.mcpEnabled) {
        await mcpStore.setMcpEnabled(true)
      }

      // Set the MCP install cache
      mcpStore.setMcpInstallCache(JSON.stringify(mcpConfig))

      // Navigate to MCP settings page
      const currentRoute = router.currentRoute.value
      if (currentRoute.name !== 'settings-mcp') {
        await router.push({ name: 'settings-mcp' })
      } else {
        await router.replace({
          name: 'settings-mcp',
          query: { ...currentRoute.query }
        })
      }

      console.log('MCP install deeplink processed successfully')
    }
  } catch (error) {
    console.error('Error processing pending MCP install:', error)
    // Clear potentially corrupted data
    localStorage.removeItem('pending-mcp-install')
  }
})

const closeWindow = () => {
  windowPresenter.closeSettingsWindow()
}

onBeforeUnmount(() => {
  if (errorDisplayTimer.value) {
    clearTimeout(errorDisplayTimer.value)
    errorDisplayTimer.value = null
  }

  window.electron.ipcRenderer.removeAllListeners(NOTIFICATION_EVENTS.SHOW_ERROR)
  cleanupMcpDeeplink()
})
</script>

<style>
html,
body {
  background-color: transparent;
}
.window-drag-region {
  -webkit-app-region: drag;
}

.window-no-drag-region {
  -webkit-app-region: no-drag;
}
</style>
