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
  </div>
</template>

<script setup lang="ts">
import { Icon } from '@iconify/vue'
import { useRouter, useRoute, RouterView } from 'vue-router'
import { onMounted, Ref, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useTitle } from '@vueuse/core'
import { usePresenter } from '../src/composables/usePresenter'
import CloseIcon from './icons/CloseIcon.vue'
import { useSettingsStore } from '../src/stores/settings'
import { useLanguageStore } from '../src/stores/language'
import { useModelCheckStore } from '../src/stores/modelCheck'
import { Button } from '@shadcn/components/ui/button'
import ModelCheckDialog from '@/components/settings/ModelCheckDialog.vue'
import { useDeviceVersion } from '../src/composables/useDeviceVersion'

const devicePresenter = usePresenter('devicePresenter')
const windowPresenter = usePresenter('windowPresenter')
const configPresenter = usePresenter('configPresenter')

// Initialize stores
const settingsStore = useSettingsStore()
const languageStore = useLanguageStore()
const modelCheckStore = useModelCheckStore()

// Detect platform to apply proper styling
const { isMacOS, isWinMacOS } = useDeviceVersion()
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
  () => settingsStore.fontSizeClass,
  (newClass, oldClass) => {
    if (oldClass) document.documentElement.classList.remove(oldClass)
    document.documentElement.classList.add(newClass)
  }
)

onMounted(() => {
  // Listen for window maximize/unmaximize events
  devicePresenter.getDeviceInfo().then((deviceInfo: any) => {
    isMacOS.value = deviceInfo.platform === 'darwin'
  })
})

const closeWindow = () => {
  windowPresenter.closeSettingsWindow()
}
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
