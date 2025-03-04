<template>
  <div class="w-full h-full flex flex-row">
    <div class="w-64 border-r h-full overflow-y-auto space-y-2 p-2">
      <div
        v-for="provider in settingsStore.providers"
        :key="provider.name"
        :class="[
          'flex flex-row items-center hover:bg-accent gap-2 rounded-lg p-2 cursor-pointer',
          route.params?.providerId === provider.id ? 'bg-accent' : ''
        ]"
        @click="setActiveProvider(provider.id)"
      >
        <ModelIcon
          :model-id="provider.id"
          :custom-class="'w-4 h-4 text-muted-foreground'"
        ></ModelIcon>
        <span class="text-sm font-medium flex-1">{{ provider.name }}</span>
        <Switch :checked="provider.enable" @click.stop="toggleProviderStatus(provider)" />
      </div>
      <div
        class="flex flex-row items-center gap-2 rounded-lg p-2 cursor-pointer hover:bg-accent"
        @click="openAddProviderDialog"
      >
        <Icon icon="lucide:plus" class="w-4 h-4 text-muted-foreground" />
        <span class="text-sm font-medium">{{ t('settings.provider.addCustomProvider') }}</span>
      </div>
    </div>
    <template v-if="activeProvider">
      <OllamaProviderSettingsDetail
        v-if="activeProvider.apiType === 'ollama'"
        :key="`ollama-${activeProvider.id}`"
        :provider="activeProvider"
        class="flex-1"
      />
      <ModelProviderSettingsDetail
        v-else
        :key="`standard-${activeProvider.id}`"
        :provider="activeProvider"
        class="flex-1"
      />
    </template>
    <AddCustomProviderDialog
      v-model:open="isAddProviderDialogOpen"
      @provider-added="handleProviderAdded"
    />
  </div>
</template>
<script setup lang="ts">
import { computed, ref } from 'vue'
import { useSettingsStore } from '@/stores/settings'
import { useRoute, useRouter } from 'vue-router'
import ModelProviderSettingsDetail from './ModelProviderSettingsDetail.vue'
import OllamaProviderSettingsDetail from './OllamaProviderSettingsDetail.vue'
import ModelIcon from '@/components/icons/ModelIcon.vue'
import { Icon } from '@iconify/vue'
import AddCustomProviderDialog from './AddCustomProviderDialog.vue'
import { useI18n } from 'vue-i18n'
import type { LLM_PROVIDER } from '@shared/presenter'
import { Switch } from '@/components/ui/switch'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()

const settingsStore = useSettingsStore()

const isAddProviderDialogOpen = ref(false)

const setActiveProvider = (providerId: string) => {
  router.push({
    name: 'settings-provider',
    params: {
      providerId
    }
  })
}

const toggleProviderStatus = async (provider: LLM_PROVIDER) => {
  await settingsStore.updateProviderStatus(provider.id, !provider.enable)
}

const activeProvider = computed(() => {
  return settingsStore.providers.find((p) => p.id === route.params.providerId)
})

const openAddProviderDialog = () => {
  isAddProviderDialogOpen.value = true
}

const handleProviderAdded = (provider: LLM_PROVIDER) => {
  // 添加成功后，自动选择新添加的provider
  setActiveProvider(provider.id)
}
</script>
