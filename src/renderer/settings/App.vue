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
      <div class="w-52 h-full border-r border-border p-4 shrink-0 overflow-y-auto">
        <div
          v-for="(group, groupIndex) in settingsGroups"
          :key="group.key"
          :class="[groupIndex === 0 ? '' : 'mt-4']"
        >
          <div class="px-2 text-xs font-semibold uppercase text-muted-foreground tracking-wide">
            {{ t(group.titleKey) }}
          </div>
          <div class="mt-2 space-y-1">
            <div
              v-for="setting in group.items"
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
import { useWindowStoreLifecycle } from '../src/composables/useWindowStoreLifecycle'
import { Button } from '@shadcn/components/ui/button'
import ModelCheckDialog from '@/components/settings/ModelCheckDialog.vue'
import { Toaster } from '@shadcn/components/ui/sonner'
import 'vue-sonner/style.css'
import { useNotificationAdapter } from '@/composables/notifications/useNotificationAdapter'
import { useNotificationToasts } from '@/composables/notifications/useNotificationToasts'
import { SETTINGS_EVENTS } from '@/events'
import { useThemeStore } from '@/stores/theme'
import { useProviderStore } from '@/stores/providerStore'
import { useModelStore } from '@/stores/modelStore'
import { useOllamaStore } from '@/stores/ollamaStore'
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
const windowStore = useWindowStoreLifecycle()
const { isMacOS, isWinMacOS } = storeToRefs(windowStore)
const { showErrorToast } = useNotificationToasts()
const notificationAdapter = useNotificationAdapter()
const themeStore = useThemeStore()
const providerStore = useProviderStore()
const modelStore = useModelStore()
const ollamaStore = useOllamaStore()
const mcpStore = useMcpStore()
const { setup: setupMcpDeeplink, cleanup: cleanupMcpDeeplink } = useMcpInstallDeeplinkHandler()
// Register MCP deeplink listener immediately to avoid race with incoming IPC
setupMcpDeeplink()

let cleanupErrorNotifications: (() => void) | null = null
const toasterTheme = computed(() =>
  themeStore.themeMode === 'system' ? (themeStore.isDark ? 'dark' : 'light') : themeStore.themeMode
)
const { t, locale } = useI18n()
const router = useRouter()
const route = useRoute()
const title = useTitle()

const handleSettingsNavigate = async (
  _event: unknown,
  payload?: { routeName?: string; section?: string }
) => {
  const routeName = payload?.routeName
  if (!routeName || !router.hasRoute(routeName)) return
  await router.isReady()
  if (router.currentRoute.value.name !== routeName) {
    await router.push({ name: routeName })
  }
}

if (window?.electron?.ipcRenderer) {
  window.electron.ipcRenderer.on(SETTINGS_EVENTS.NAVIGATE, handleSettingsNavigate)
}
type SettingItem = {
  title: string
  name: string
  icon: string
  path: string
  position: number
  group: string
  groupPosition: number
  groupTitleKey: string
}

type SettingGroup = {
  key: string
  titleKey: string
  position: number
  items: SettingItem[]
}

const settingsItems: Ref<SettingItem[]> = ref([])
const settingsGroups = computed<SettingGroup[]>(() => {
  const grouped = new Map<string, SettingGroup>()

  settingsItems.value.forEach((setting) => {
    const existing = grouped.get(setting.group)
    if (existing) {
      existing.items.push(setting)
      return
    }

    grouped.set(setting.group, {
      key: setting.group,
      titleKey: setting.groupTitleKey,
      position: setting.groupPosition,
      items: [setting]
    })
  })

  const groups = Array.from(grouped.values())
  groups.forEach((group) => {
    group.items.sort((a, b) => a.position - b.position)
  })

  return groups.sort((a, b) => a.position - b.position)
})

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
    group: string
    groupPosition: number
    groupTitleKey: string
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
        position: (route.meta.position as number) || 999,
        group: (route.meta.group as string) || 'system',
        groupPosition: (route.meta.groupPosition as number) || 999,
        groupTitleKey: (route.meta.groupTitleKey as string) || 'settings.groups.system'
      })
    }
    // Sort by position meta field, default to 999 if not present
    tempArray.sort((a, b) => {
      return a.position - b.position
    })
    settingsItems.value = tempArray
    console.log('Final sorted settings routes:', settingsItems.value)
  })
})

const initializeSettingsStores = async () => {
  try {
    await providerStore.initialize()
    await modelStore.initialize()
    await ollamaStore.initialize?.()
  } catch (error) {
    console.error('Failed to initialize settings stores', error)
  }
}

// Update title function
const updateTitle = () => {
  const currentRoute = route.name as string
  const currentSetting = settingsItems.value.find((s) => s.name === currentRoute)
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

onMounted(async () => {
  cleanupErrorNotifications = notificationAdapter.bindErrorNotifications(showErrorToast)

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
  if (cleanupErrorNotifications) {
    cleanupErrorNotifications()
    cleanupErrorNotifications = null
  }
  window.electron.ipcRenderer.removeListener(SETTINGS_EVENTS.NAVIGATE, handleSettingsNavigate)
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
