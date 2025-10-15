<template>
  <section class="flex flex-col gap-2">
    <div class="flex items-center gap-3 h-10">
      <span
        class="flex items-center gap-2 text-sm font-medium shrink-0 min-w-[220px]"
        :dir="langStore.dir"
      >
        <Icon icon="lucide:globe" class="w-4 h-4 text-muted-foreground" />
        <span class="truncate">{{ t('settings.common.proxyMode') }}</span>
      </span>
      <div class="ml-auto w-auto">
        <Select v-model="selectedProxyMode">
          <SelectTrigger class="h-8! text-sm border-border hover:bg-accent">
            <SelectValue :placeholder="t('settings.common.proxyModeSelect')" />
          </SelectTrigger>
          <SelectContent align="end">
            <SelectItem v-for="mode in proxyModes" :key="mode.value" :value="mode.value">
              {{ mode.label }}
            </SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>

    <div v-if="selectedProxyMode === 'custom'" class="flex flex-col gap-2 h-10">
      <div class="flex items-center gap-3">
        <span
          class="flex items-center gap-2 text-sm font-medium shrink-0 min-w-[220px]"
          :dir="langStore.dir"
        >
          <Icon icon="lucide:link" class="w-4 h-4 text-muted-foreground" />
          <span class="truncate">{{ t('settings.common.customProxyUrl') }}</span>
        </span>
        <div class="ml-auto w-[320px]">
          <Input
            v-model="customProxyUrl"
            :placeholder="t('settings.common.customProxyUrlPlaceholder')"
            :class="{ 'border-red-500': showUrlError }"
            @input="validateProxyUrl"
            @blur="validateProxyUrl"
          />
        </div>
      </div>
      <div v-if="showUrlError" class="text-xs text-red-500 pt-1 lg:pl-[220px] pl-10">
        {{ t('settings.common.invalidProxyUrl') }}
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { usePresenter } from '@/composables/usePresenter'
import { Input } from '@shadcn/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@shadcn/components/ui/select'
import { useLanguageStore } from '@/stores/language'

const { t } = useI18n()
const configPresenter = usePresenter('configPresenter')
const langStore = useLanguageStore()

const selectedProxyMode = ref('system')
const customProxyUrl = ref('')
const showUrlError = ref(false)

const proxyModes = [
  { value: 'system', label: t('settings.common.proxyModeSystem') },
  { value: 'none', label: t('settings.common.proxyModeNone') },
  { value: 'custom', label: t('settings.common.proxyModeCustom') }
]

let proxyUrlDebounceTimer: number | null = null

const validateProxyUrl = () => {
  if (!customProxyUrl.value.trim()) {
    showUrlError.value = false
    return
  }

  const urlPattern =
    /^(http|https):\/\/(?:([^:@/]+)(?::([^@/]*))?@)?([a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?\.)+[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(:[0-9]+)?(\/[^\s]*)?$/

  const isValid = urlPattern.test(customProxyUrl.value)

  showUrlError.value = !isValid

  if (isValid || !customProxyUrl.value.trim()) {
    configPresenter.setCustomProxyUrl(customProxyUrl.value)
  }
}

watch(customProxyUrl, () => {
  if (proxyUrlDebounceTimer !== null) {
    clearTimeout(proxyUrlDebounceTimer)
  }
  proxyUrlDebounceTimer = window.setTimeout(() => {
    validateProxyUrl()
  }, 300)
})

watch(selectedProxyMode, (newValue) => {
  configPresenter.setProxyMode(newValue)
})

onMounted(async () => {
  selectedProxyMode.value = await configPresenter.getProxyMode()
  customProxyUrl.value = await configPresenter.getCustomProxyUrl()
  if (selectedProxyMode.value === 'custom' && customProxyUrl.value) {
    validateProxyUrl()
  }
})
</script>
