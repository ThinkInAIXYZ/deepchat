<template>
  <div class="flex flex-col gap-4">
    <div class="flex flex-col items-start gap-2">
      <Label :for="`${provider.id}-projectId`" class="flex-1">
        {{ t('settings.provider.vertexProjectId') }}
      </Label>
      <Input
        :id="`${provider.id}-projectId`"
        :model-value="projectId"
        :placeholder="t('settings.provider.vertexProjectIdPlaceholder')"
        @blur="handleProjectIdChange(String($event.target?.value || ''))"
        @keyup.enter="handleProjectIdChange(projectId)"
        @update:model-value="projectId = String($event)"
      />
    </div>

    <div class="flex flex-col items-start gap-2">
      <Label :for="`${provider.id}-location`" class="flex-1">
        {{ t('settings.provider.vertexLocation') }}
      </Label>
      <Input
        :id="`${provider.id}-location`"
        :model-value="location"
        :placeholder="t('settings.provider.vertexLocationPlaceholder')"
        @blur="handleLocationChange(String($event.target?.value || ''))"
        @keyup.enter="handleLocationChange(location)"
        @update:model-value="location = String($event)"
      />
    </div>

    <div class="flex flex-col items-start gap-2">
      <Label :for="`${provider.id}-apiVersion`" class="flex-1">
        {{ t('settings.provider.vertexApiVersion') }}
      </Label>
      <Select v-model="apiVersion" @update:model-value="handleApiVersionChange">
        <SelectTrigger :id="`${provider.id}-apiVersion`" class="w-full">
          <SelectValue placeholder="v1" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="v1">v1</SelectItem>
          <SelectItem value="v1beta1">v1beta1</SelectItem>
        </SelectContent>
      </Select>
    </div>

    <div class="flex flex-col items-start gap-2">
      <Label :for="`${provider.id}-serviceEmail`" class="flex-1">
        {{ t('settings.provider.vertexServiceEmail') }}
      </Label>
      <Input
        :id="`${provider.id}-serviceEmail`"
        :model-value="accountClientEmail"
        :placeholder="t('settings.provider.vertexServiceEmailPlaceholder')"
        @blur="handleServiceEmailChange(String($event.target?.value || ''))"
        @keyup.enter="handleServiceEmailChange(accountClientEmail)"
        @update:model-value="accountClientEmail = String($event)"
      />
    </div>

    <div class="flex flex-col items-start gap-2">
      <Label :for="`${provider.id}-privateKey`" class="flex-1">
        {{ t('settings.provider.vertexPrivateKey') }}
      </Label>
      <div class="relative w-full">
        <Input
          :id="`${provider.id}-privateKey`"
          :model-value="accountPrivateKey"
          :type="showPrivateKey ? 'text' : 'password'"
          :placeholder="t('settings.provider.vertexPrivateKeyPlaceholder')"
          style="padding-right: 2.5rem !important"
          @blur="handlePrivateKeyChange(String($event.target?.value || ''))"
          @keyup.enter="handlePrivateKeyChange(accountPrivateKey)"
          @update:model-value="accountPrivateKey = String($event)"
        />
        <DcButton
          variant="ghost"
          size="sm"
          class="absolute right-2 top-1/2 transform -translate-y-1/2 h-7 w-7 p-0 hover:bg-transparent"
          :tooltip="showPrivateKey ? t('common.hideValue') : t('common.showValue')"
          @click="showPrivateKey = !showPrivateKey"
        >
          <Icon
            :icon="showPrivateKey ? 'lucide:eye-off' : 'lucide:eye'"
            class="w-4 h-4 text-muted-foreground hover:text-foreground"
          />
        </DcButton>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Label } from '@shadcn/components/ui/label'
import { Input } from '@shadcn/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@shadcn/components/ui/select'
import { DcButton } from '@dc-ui/components/button'
import { Icon } from '@iconify/vue'
import type { VERTEX_PROVIDER } from '@shared/types/provider'
import { useProviderStore } from '@/stores/providerStore'

const props = defineProps<{
  provider: VERTEX_PROVIDER
}>()

const emit = defineEmits<{
  'config-updated': []
}>()

const { t } = useI18n()
const providerStore = useProviderStore()

const projectId = ref(props.provider.projectId || '')
const location = ref(props.provider.location || '')
const apiVersion = ref(props.provider.apiVersion || 'v1')
const accountClientEmail = ref(props.provider.accountClientEmail || '')
const accountPrivateKey = ref(props.provider.accountPrivateKey || '')
const showPrivateKey = ref(false)

watch(
  () => props.provider,
  (next) => {
    projectId.value = next.projectId || ''
    location.value = next.location || ''
    apiVersion.value = next.apiVersion || 'v1'
    accountClientEmail.value = next.accountClientEmail || ''
    accountPrivateKey.value = next.accountPrivateKey || ''
  },
  { deep: true }
)

const updateConfig = async (updates: Partial<VERTEX_PROVIDER>) => {
  await providerStore.updateVertexProviderConfig(props.provider.id, updates)
  emit('config-updated')
}

const handleProjectIdChange = async (value: string) => {
  const nextValue = value.trim()
  projectId.value = nextValue
  await updateConfig({ projectId: nextValue })
}

const handleLocationChange = async (value: string) => {
  const nextValue = value.trim()
  location.value = nextValue
  await updateConfig({ location: nextValue })
}

const handleApiVersionChange = async (value: any) => {
  if (value && typeof value === 'string') {
    apiVersion.value = value as 'v1' | 'v1beta1'
    await updateConfig({ apiVersion: apiVersion.value })
  }
}

const handleServiceEmailChange = async (value: string) => {
  const nextValue = value.trim()
  accountClientEmail.value = nextValue
  await updateConfig({ accountClientEmail: nextValue })
}

const handlePrivateKeyChange = async (value: string) => {
  accountPrivateKey.value = value
  await updateConfig({ accountPrivateKey: value })
}
</script>
