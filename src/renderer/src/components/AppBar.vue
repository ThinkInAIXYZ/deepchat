<template>
  <div
    class="flex flex-row h-9 min-h-9 relative overflow-hidden"
    :class="[!isFullscreened && isMacOS ? '' : ' rounded-t-none']"
    :dir="langStore.dir"
  >
    <div
      class="h-full shrink-0 w-0 flex-1 flex select-none text-center text-sm font-medium flex-row items-center justify-start window-drag-region"
    >
      <div v-if="!isFullscreened && isMacOS" class="shrink-0 w-20 h-full window-drag-region"></div>
      <Button
        v-if="showUpdateButton"
        variant="default"
        size="sm"
        class="window-no-drag-region shrink-0 h-5 rounded-full px-2 text-[10px] font-medium shadow-none"
        :class="isMacOS ? 'ml-2' : 'ml-3'"
        :disabled="upgrade.isRestarting"
        @click="handleInstallUpdate"
      >
        {{ upgrade.isRestarting ? t('update.restarting') : t('update.topbarButton') }}
      </Button>
      <div class="flex-1"></div>

      <Button
        v-if="!isMacOS"
        class="window-no-drag-region shrink-0 w-12 bg-transparent shadow-none rounded-none hover:bg-card/80 text-xs font-medium text-foreground flex items-center justify-center transition-all duration-200 group"
        :title="t('common.minimize')"
        @click="minimizeWindow"
      >
        <MinimizeIcon class="h-3! w-3!" />
      </Button>
      <Button
        v-if="!isMacOS"
        class="window-no-drag-region shrink-0 w-12 bg-transparent shadow-none rounded-none hover:bg-card/80 text-xs font-medium text-foreground flex items-center justify-center transition-all duration-200 group"
        :title="isMaximized ? t('common.restore') : t('common.maximize')"
        @click="toggleMaximize"
      >
        <MaximizeIcon v-if="!isMaximized" class="h-3! w-3!" />
        <RestoreIcon v-else class="h-3! w-3!" />
      </Button>
      <Button
        v-if="!isMacOS"
        class="window-no-drag-region shrink-0 w-12 bg-transparent shadow-none rounded-none hover:bg-red-700/80 hover:text-white text-xs font-medium text-foreground flex items-center justify-center transition-all duration-200 group"
        :title="t('common.close')"
        @click="closeWindow"
      >
        <CloseIcon class="h-3! w-3!" />
      </Button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, computed } from 'vue'
import MaximizeIcon from './icons/MaximizeIcon.vue'
import RestoreIcon from './icons/RestoreIcon.vue'
import CloseIcon from './icons/CloseIcon.vue'
import MinimizeIcon from './icons/MinimizeIcon.vue'
import { DeviceClient } from '@api/DeviceClient'
import { WindowClient } from '@api/WindowClient'
import { Button } from '@shadcn/components/ui/button'
import { useLanguageStore } from '@/stores/language'
import { useI18n } from 'vue-i18n'
import { useUpgradeStore } from '@/stores/upgrade'
import { useRoute } from 'vue-router'

const langStore = useLanguageStore()
const windowClient = new WindowClient()
const deviceClient = new DeviceClient()
const upgrade = useUpgradeStore()
const route = useRoute()

const { t } = useI18n()

const isMacOS = ref(false)
const isMaximized = ref(false)
const isFullscreened = ref(false)
const showUpdateButton = computed(
  () => route.name !== 'welcome' && upgrade.shouldShowTopbarInstallButton
)

const minimizeWindow = () => {
  void windowClient.minimizeCurrent()
}

const toggleMaximize = () => {
  void windowClient.toggleMaximizeCurrent()
}

const closeWindow = () => {
  void windowClient.closeCurrent()
}

const handleInstallUpdate = async () => {
  await upgrade.handleUpdate('auto')
}

onMounted(() => {
  void upgrade.refreshStatus()
  deviceClient.getDeviceInfo().then((deviceInfo) => {
    isMacOS.value = deviceInfo.platform === 'darwin'
  })

  void windowClient.getCurrentState().then((state) => {
    isMaximized.value = state.isMaximized
    isFullscreened.value = state.isFullScreen
  })

  stopWindowStateListener = windowClient.onCurrentStateChanged((payload) => {
    isMaximized.value = payload.isMaximized
    isFullscreened.value = payload.isFullScreen
  })
})

onBeforeUnmount(() => {
  stopWindowStateListener?.()
})

let stopWindowStateListener: (() => void) | null = null
</script>

<style scoped>
.window-drag-region {
  -webkit-app-region: drag;
}

.window-no-drag-region {
  -webkit-app-region: no-drag;
}

button {
  -webkit-app-region: no-drag;
}
</style>
