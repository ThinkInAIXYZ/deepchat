<template>
  <div class="h-full w-full">
    <div class="flex h-full w-full flex-col gap-2">
      <div class="flex h-full w-full flex-col items-center justify-center gap-2">
        <img src="@/assets/logo.png" class="h-10 w-10" />
        <div class="flex flex-col items-center gap-2" :dir="languageStore.dir">
          <h1 class="text-2xl font-bold">{{ t('about.title') }}</h1>
          <p class="pb-4 text-xs text-muted-foreground">v{{ appVersion }}</p>
          <p class="px-8 text-sm text-muted-foreground">
            {{ t('about.description') }}
          </p>
          <div class="flex gap-2">
            <a
              class="flex items-center text-xs text-muted-foreground hover:text-primary"
              href="https://deepchat.thinkinai.xyz/"
              target="_blank"
              rel="noopener noreferrer"
              @click.prevent="openExternalLink('https://deepchat.thinkinai.xyz/')"
            >
              <Icon icon="lucide:globe" class="mr-1 h-3 w-3" />
              {{ t('about.website') }}</a
            >
            <a
              class="flex items-center text-xs text-muted-foreground hover:text-primary"
              href="https://github.com/ThinkInAIXYZ/deepchat"
              target="_blank"
              rel="noopener noreferrer"
              @click.prevent="openExternalLink('https://github.com/ThinkInAIXYZ/deepchat')"
            >
              <Icon icon="lucide:github" class="mr-1 h-3 w-3" />
              GitHub
            </a>
            <a
              class="flex items-center text-xs text-muted-foreground hover:text-primary"
              href="https://github.com/ThinkInAIXYZ/deepchat/blob/dev/LICENSE"
              target="_blank"
              rel="noopener noreferrer"
              @click.prevent="
                openExternalLink('https://github.com/ThinkInAIXYZ/deepchat/blob/dev/LICENSE')
              "
            >
              <Icon icon="lucide:scale" class="mr-1 h-3 w-3" />
              Apache License 2.0
            </a>
          </div>
        </div>

        <div class="mt-4 flex items-center gap-4">
          <label class="text-sm font-medium">{{ t('about.updateChannel') }}:</label>
          <div class="min-w-32 max-w-48">
            <Select v-model="updateChannel" @update:model-value="setUpdateChannel">
              <SelectTrigger>
                <SelectValue :placeholder="t('about.updateChannel')" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="stable">
                  {{ t('about.stableChannel') }}
                </SelectItem>
                <SelectItem value="beta">
                  {{ t('about.betaChannel') }}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div
          v-if="upgrade.shouldShowUpdateNotes"
          class="mt-2 w-full max-w-xl rounded-xl border border-border/80 bg-card/70 p-4 shadow-sm"
        >
          <div class="text-sm font-medium">
            {{ t('update.versionAvailable', { version: formattedUpdateVersion }) }}
          </div>
          <div
            v-if="upgrade.updateInfo?.releaseNotes"
            class="mt-3 max-h-40 overflow-y-auto pr-2 text-sm text-muted-foreground"
          >
            <NodeRenderer
              :isDark="themeStore.isDark"
              :content="upgrade.updateInfo.releaseNotes"
            ></NodeRenderer>
          </div>
        </div>

        <div
          v-if="upgrade.showManualDownloadOptions"
          class="mt-2 flex w-full max-w-xl flex-col items-center gap-1"
        >
          <p class="text-center text-xs text-muted-foreground">
            {{ t('update.autoUpdateFailed') }}
          </p>
          <p v-if="upgrade.updateError" class="text-center text-xs text-muted-foreground/80">
            {{ upgrade.updateError }}
          </p>
        </div>

        <div class="mt-2 flex flex-wrap justify-center gap-2">
          <Button
            variant="outline"
            size="sm"
            class="mb-2 text-xs"
            @click="openExternalLink('https://github.com/ThinkInAIXYZ/deepchat/discussions/1226')"
          >
            <Icon icon="lucide:message-square" class="mr-1 h-3 w-3" />
            {{ t('about.feedbackButton') }}
          </Button>

          <Button variant="outline" size="sm" class="mb-2 text-xs" @click="openDisclaimerDialog">
            <Icon icon="lucide:info" class="mr-1 h-3 w-3" />
            {{ t('about.disclaimerButton') }}
          </Button>

          <Button
            v-if="showMockUpdateControls && !upgrade.isMockUpdate"
            variant="outline"
            size="sm"
            class="mb-2 text-xs"
            @click="handleMockDownloadedUpdate"
          >
            {{ t('about.mockUpdateButton') }}
          </Button>

          <Button
            v-if="showMockUpdateControls && upgrade.isMockUpdate"
            variant="outline"
            size="sm"
            class="mb-2 text-xs"
            @click="handleClearMockUpdate"
          >
            {{ t('about.clearMockUpdateButton') }}
          </Button>

          <Button
            v-if="upgrade.showManualDownloadOptions"
            variant="outline"
            size="sm"
            class="mb-2 text-xs"
            @click="handleManualDownload('github')"
          >
            {{ t('update.githubDownload') }}
          </Button>

          <Button
            v-if="upgrade.showManualDownloadOptions"
            variant="outline"
            size="sm"
            class="mb-2 text-xs"
            @click="handleManualDownload('official')"
          >
            {{ t('update.officialDownload') }}
          </Button>

          <Button
            v-if="!upgrade.showManualDownloadOptions"
            variant="outline"
            size="sm"
            class="mb-2 text-xs"
            :disabled="upgrade.isChecking || upgrade.isDownloading || upgrade.isRestarting"
            @click="handlePrimaryAction"
          >
            <Icon
              icon="lucide:refresh-cw"
              class="mr-1 h-3 w-3"
              :class="{
                'animate-spin': upgrade.isChecking || upgrade.isDownloading
              }"
            />
            <span v-if="upgrade.isDownloading">
              <template v-if="upgrade.updateProgress">
                {{ t('update.downloading') }}: {{ Math.round(upgrade.updateProgress.percent) }}%
              </template>
              <template v-else>{{ t('update.downloading') }}</template>
            </span>
            <span v-else-if="upgrade.isReadyToInstall">
              {{ upgrade.isRestarting ? t('update.restarting') : t('update.installNow') }}
            </span>
            <span v-else-if="upgrade.updateState === 'available'">
              {{ t('update.installUpdate') }}
            </span>
            <span v-else-if="upgrade.isChecking">
              {{ t('settings.about.checking') }}
            </span>
            <span v-else>
              {{ t('about.checkUpdateButton') }}
            </span>
          </Button>
        </div>
      </div>
    </div>
  </div>

  <Dialog :open="isDisclaimerOpen" @update:open="isDisclaimerOpen = $event">
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{{ t('about.disclaimerTitle') }}</DialogTitle>
        <DialogDescription>
          <NodeRenderer
            class="max-h-[300px] overflow-y-auto"
            :isDark="themeStore.isDark"
            :content="t('searchDisclaimer')"
          ></NodeRenderer>
        </DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <Button @click="isDisclaimerOpen = false">{{ t('common.close') }}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
import { usePresenter } from '@/composables/usePresenter'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Button } from '@shadcn/components/ui/button'
import { Icon } from '@iconify/vue'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@shadcn/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@shadcn/components/ui/select'
import NodeRenderer from 'markstream-vue'
import { useUpgradeStore } from '@/stores/upgrade'
import { useLanguageStore } from '@/stores/language'
import type { AcceptableValue } from 'reka-ui'
import { useThemeStore } from '@/stores/theme'
import { useToast } from '@/components/use-toast'
import { SETTINGS_EVENTS } from '@/events'
import { useRoute } from 'vue-router'

const { t } = useI18n()
const { toast } = useToast()
const themeStore = useThemeStore()
const languageStore = useLanguageStore()
const route = useRoute()
const devicePresenter = usePresenter('devicePresenter')
const configPresenter = usePresenter('configPresenter')
const appVersion = ref('')
const upgrade = useUpgradeStore()
const updateChannel = ref('stable')
const isDisclaimerOpen = ref(false)
const showMockUpdateControls = computed(() => import.meta.env.DEV)

const formattedUpdateVersion = computed(() => {
  const version = upgrade.updateInfo?.version ?? ''
  if (!version) return ''
  return version.startsWith('v') ? version : `v${version}`
})

const openDisclaimerDialog = () => {
  isDisclaimerOpen.value = true
}

const showUpToDateToast = () => {
  toast({
    title: t('update.alreadyUpToDate'),
    description: t('update.alreadyUpToDateDesc')
  })
}

const showUpdateErrorToast = (message: string) => {
  toast({
    title: t('common.error.operationFailed'),
    description: message,
    variant: 'destructive'
  })
}

const setUpdateChannel = async (channel: AcceptableValue) => {
  try {
    await configPresenter.setUpdateChannel(channel as string)
  } catch (error) {
    console.error('updateChannelSetError:', error)
  }
}

const handlePrimaryAction = async () => {
  if (upgrade.isChecking || upgrade.isDownloading || upgrade.isRestarting) {
    return
  }

  if (upgrade.updateState === 'available' || upgrade.isReadyToInstall) {
    await upgrade.handleUpdate('auto')
    return
  }

  const status = await upgrade.checkUpdate(false)
  if (status === 'not-available') {
    showUpToDateToast()
  } else if (status === 'error' && upgrade.updateError) {
    showUpdateErrorToast(upgrade.updateError)
  }
}

const handleManualDownload = async (type: 'github' | 'official') => {
  await upgrade.handleUpdate(type)
}

const handleMockDownloadedUpdate = async () => {
  const status = await upgrade.mockDownloadedUpdate()
  if (status === 'error' && upgrade.updateError) {
    showUpdateErrorToast(upgrade.updateError)
  }
}

const handleClearMockUpdate = async () => {
  const status = await upgrade.clearMockUpdate()
  if (status === 'error' && upgrade.updateError) {
    showUpdateErrorToast(upgrade.updateError)
  }
}

const handleExternalCheckUpdate = async () => {
  if (upgrade.isChecking || upgrade.isDownloading || upgrade.isRestarting) {
    return
  }

  if (upgrade.updateState === 'available' || upgrade.isReadyToInstall) {
    return
  }

  await handlePrimaryAction()
}

const syncUpdateStatus = async () => {
  await upgrade.refreshStatus()
}

const openExternalLink = (url: string) => {
  if (window.api?.openExternal) {
    window.api.openExternal(url)
  } else {
    window.open(url, '_blank', 'noopener,noreferrer')
  }
}

onMounted(async () => {
  window.electron?.ipcRenderer?.on(SETTINGS_EVENTS.CHECK_FOR_UPDATES, handleExternalCheckUpdate)
  appVersion.value = await devicePresenter.getAppVersion()
  updateChannel.value = await configPresenter.getUpdateChannel()
  await syncUpdateStatus()
})

watch(
  () => route.name,
  async (routeName) => {
    if (routeName === 'settings-about') {
      await syncUpdateStatus()
    }
  }
)

onBeforeUnmount(() => {
  window.electron?.ipcRenderer?.removeListener(
    SETTINGS_EVENTS.CHECK_FOR_UPDATES,
    handleExternalCheckUpdate
  )
})
</script>
