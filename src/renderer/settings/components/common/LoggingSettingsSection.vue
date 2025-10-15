<template>
  <section class="flex flex-col gap-3">
    <div class="flex items-center gap-3 h-10">
      <div
        class="flex items-center gap-2 text-sm font-medium shrink-0 min-w-[220px]"
        :dir="langStore.dir"
      >
        <Icon icon="lucide:file-text" class="w-4 h-4 text-muted-foreground" />
        <span class="truncate">{{ t('settings.common.loggingEnabled') }}</span>
        <Button
          variant="ghost"
          size="sm"
          class="shrink-0 ltr:ml-2 rtl:mr-2"
          :dir="langStore.dir"
          @click="openLogFolder"
        >
          <Icon icon="lucide:external-link" class="w-4 h-4 text-muted-foreground" />
          <span class="text-sm font-medium">{{ t('settings.common.openLogFolder') }}</span>
        </Button>
      </div>
      <Switch
        id="logging-switch"
        class="ml-auto"
        :model-value="loggingEnabled"
        @update:model-value="handleLoggingChange"
      />
    </div>

    <Dialog v-model:open="isLoggingDialogOpen" @update:open="cancelLoggingChange">
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{{ t('settings.common.loggingDialogTitle') }}</DialogTitle>
          <DialogDescription>
            <div class="space-y-2">
              <p>
                {{
                  newLoggingValue
                    ? t('settings.common.loggingEnableDesc')
                    : t('settings.common.loggingDisableDesc')
                }}
              </p>
              <p>{{ t('settings.common.loggingRestartNotice') }}</p>
            </div>
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" @click="cancelLoggingChange">{{ t('common.cancel') }}</Button>
          <Button @click="confirmLoggingChange">{{ t('common.confirm') }}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { Button } from '@shadcn/components/ui/button'
import { Switch } from '@shadcn/components/ui/switch'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@shadcn/components/ui/dialog'
import { usePresenter } from '@/composables/usePresenter'
import { useSettingsStore } from '@/stores/settings'
import { useLanguageStore } from '@/stores/language'

const { t } = useI18n()
const configPresenter = usePresenter('configPresenter')
const settingsStore = useSettingsStore()
const langStore = useLanguageStore()

const loggingEnabled = computed(() => settingsStore.loggingEnabled)
const isLoggingDialogOpen = ref(false)
const newLoggingValue = ref(false)

const handleLoggingChange = (value: boolean) => {
  newLoggingValue.value = value
  isLoggingDialogOpen.value = true
}

const cancelLoggingChange = () => {
  isLoggingDialogOpen.value = false
}

const confirmLoggingChange = () => {
  settingsStore.setLoggingEnabled(newLoggingValue.value)
  isLoggingDialogOpen.value = false
}

const openLogFolder = () => {
  configPresenter.openLoggingFolder()
}
</script>
