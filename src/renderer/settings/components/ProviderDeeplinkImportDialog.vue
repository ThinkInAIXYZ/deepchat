<template>
  <Dialog :open="open" @update:open="handleOpenChange">
    <DialogContent class="sm:max-w-[420px]">
      <DialogHeader>
        <DialogTitle>{{ t('settings.provider.dialog.providerDeeplinkImport.title') }}</DialogTitle>
        <DialogDescription>
          {{ t('settings.provider.dialog.providerDeeplinkImport.description') }}
        </DialogDescription>
      </DialogHeader>

      <div v-if="preview" class="space-y-4">
        <div class="flex items-center gap-3 rounded-lg border border-border bg-muted/30 p-3">
          <ModelIcon
            :model-id="preview.iconModelId"
            :custom-class="'h-8 w-8 shrink-0'"
            :is-dark="themeStore.isDark"
          />
          <div class="min-w-0 flex-1">
            <div class="truncate text-sm font-semibold">
              {{ preview.kind === 'builtin' ? preview.id : preview.name }}
            </div>
            <div v-if="preview.kind === 'custom'" class="truncate text-xs text-muted-foreground">
              {{ t('settings.provider.dialog.providerDeeplinkImport.type') }}: {{ preview.type }}
            </div>
          </div>
        </div>

        <div class="space-y-3">
          <div>
            <div class="text-xs font-medium text-muted-foreground">
              {{ t('settings.provider.dialog.providerDeeplinkImport.url') }}
            </div>
            <div class="break-all text-sm">{{ preview.baseUrl || '-' }}</div>
          </div>
          <div>
            <div class="text-xs font-medium text-muted-foreground">
              {{ t('settings.provider.dialog.providerDeeplinkImport.key') }}
            </div>
            <div class="break-all text-sm">{{ preview.maskedApiKey || '-' }}</div>
          </div>
        </div>

        <div
          v-if="preview.kind === 'builtin' && preview.willOverwrite"
          class="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900"
        >
          {{ t('settings.provider.dialog.providerDeeplinkImport.overwriteWarning') }}
        </div>
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" @click="emit('update:open', false)">
          {{ t('dialog.cancel') }}
        </Button>
        <Button type="button" :disabled="confirmDisabled || submitting" @click="emit('confirm')">
          {{
            submitting
              ? t('settings.provider.dialog.providerDeeplinkImport.confirming')
              : t('dialog.confirm')
          }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { Button } from '@shadcn/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@shadcn/components/ui/dialog'
import type { ProviderInstallPreview } from '@shared/presenter'
import ModelIcon from '@/components/icons/ModelIcon.vue'
import { useThemeStore } from '@/stores/theme'

const { t } = useI18n()
const themeStore = useThemeStore()

withDefaults(
  defineProps<{
    open: boolean
    preview: ProviderInstallPreview | null
    confirmDisabled?: boolean
    submitting?: boolean
  }>(),
  {
    confirmDisabled: false,
    submitting: false
  }
)

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
  (e: 'confirm'): void
}>()

const handleOpenChange = (value: boolean) => {
  if (!value) {
    emit('update:open', value)
  }
}
</script>
