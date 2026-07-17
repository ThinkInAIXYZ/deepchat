<template>
  <Dialog v-model:open="open">
    <DialogTrigger as-child>
      <Button data-testid="yobrowser-import-button" variant="outline" class="w-full lg:w-56">
        <Icon icon="lucide:import" class="size-4 text-muted-foreground" />
        {{ t('settings.data.yoBrowser.import.button') }}
      </Button>
    </DialogTrigger>

    <DialogContent class="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>{{ t('settings.data.yoBrowser.import.title') }}</DialogTitle>
        <DialogDescription>
          {{ t('settings.data.yoBrowser.import.description') }}
        </DialogDescription>
      </DialogHeader>

      <div class="flex flex-col gap-4 px-4 pb-2">
        <div v-if="loading" class="flex min-h-28 items-center justify-center gap-2 text-sm">
          <Spinner class="size-4 text-muted-foreground" />
          {{ t('settings.data.yoBrowser.import.scanning') }}
        </div>

        <div
          v-else-if="scanResult && !scanResult.platformSupported"
          class="rounded-lg border bg-muted/30 p-3 text-sm"
        >
          <div class="font-medium">{{ t('settings.data.yoBrowser.import.unsupportedTitle') }}</div>
          <p class="mt-1 text-xs text-muted-foreground">
            {{ t('settings.data.yoBrowser.import.unsupportedDescription') }}
          </p>
        </div>

        <template v-else-if="!result">
          <div class="flex flex-col gap-2">
            <Label for="browser-import-profile">
              {{ t('settings.data.yoBrowser.import.profileLabel') }}
            </Label>
            <Select v-model="selectedProfileId" :disabled="busy || profiles.length === 0">
              <SelectTrigger id="browser-import-profile">
                <SelectValue
                  :placeholder="t('settings.data.yoBrowser.import.profilePlaceholder')"
                />
              </SelectTrigger>
              <SelectContent>
                <SelectItem v-for="profile in profiles" :key="profile.id" :value="profile.id">
                  {{ profile.browserName }} · {{ profile.profileName }}
                </SelectItem>
              </SelectContent>
            </Select>
            <p v-if="profiles.length === 0" class="text-xs text-muted-foreground">
              {{ t('settings.data.yoBrowser.import.noProfiles') }}
            </p>
          </div>

          <div class="grid grid-cols-2 gap-2 text-xs">
            <div class="rounded-lg border bg-muted/20 p-3">
              <div class="font-medium">{{ t('settings.data.yoBrowser.import.cookies') }}</div>
              <div class="mt-1 text-muted-foreground">
                {{ t('settings.data.yoBrowser.import.supported') }}
              </div>
            </div>
            <div class="rounded-lg border bg-muted/20 p-3">
              <div class="font-medium">{{ t('settings.data.yoBrowser.import.otherData') }}</div>
              <div class="mt-1 text-muted-foreground">
                {{ t('settings.data.yoBrowser.import.notIncluded') }}
              </div>
            </div>
          </div>

          <div v-if="preview" class="rounded-lg border p-3 text-sm">
            <div class="font-medium">
              {{ t('settings.data.yoBrowser.import.previewTitle') }}
            </div>
            <p class="mt-1 text-xs text-muted-foreground">
              {{
                t('settings.data.yoBrowser.import.previewDescription', {
                  count: preview.cookieCount
                })
              }}
            </p>
            <p
              v-if="preview.skippedExpired || preview.skippedPartitioned"
              class="mt-2 text-xs text-muted-foreground"
            >
              {{
                t('settings.data.yoBrowser.import.skipped', {
                  expired: preview.skippedExpired,
                  partitioned: preview.skippedPartitioned
                })
              }}
            </p>
          </div>

          <p v-if="errorKey" role="alert" class="text-xs text-destructive">
            {{ t(errorKey) }}
          </p>
        </template>

        <div v-else class="rounded-lg border bg-muted/20 p-4 text-sm">
          <div class="font-medium">{{ t('settings.data.yoBrowser.import.doneTitle') }}</div>
          <p class="mt-1 text-xs text-muted-foreground">
            {{
              t('settings.data.yoBrowser.import.doneDescription', { count: result.importedCookies })
            }}
          </p>
        </div>
      </div>

      <DialogFooter>
        <Button variant="outline" :disabled="busy" @click="open = false">
          {{ result ? t('dialog.ok') : t('dialog.cancel') }}
        </Button>
        <Button
          v-if="scanResult?.platformSupported && !result"
          :disabled="busy || !selectedProfileId"
          @click="preview ? applyImport() : createPreview()"
        >
          <Spinner v-if="busy" class="size-4" />
          {{
            preview
              ? t('settings.data.yoBrowser.import.confirm')
              : t('settings.data.yoBrowser.import.preview')
          }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Icon } from '@iconify/vue'
import { useI18n } from 'vue-i18n'
import { Button } from '@shadcn/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '@shadcn/components/ui/dialog'
import { Label } from '@shadcn/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@shadcn/components/ui/select'
import { Spinner } from '@shadcn/components/ui/spinner'
import { createBrowserClient } from '@api/BrowserClient'
import type {
  BrowserImportApplyResult,
  BrowserImportPreview,
  BrowserImportScanResult
} from '@shared/types/browser'

const { t } = useI18n()
const browserClient = createBrowserClient()
const open = ref(false)
const loading = ref(false)
const busy = ref(false)
const scanResult = ref<BrowserImportScanResult | null>(null)
const selectedProfileId = ref('')
const preview = ref<BrowserImportPreview | null>(null)
const result = ref<BrowserImportApplyResult | null>(null)
const errorKey = ref('')
const profiles = computed(
  () => scanResult.value?.profiles.filter((profile) => profile.supported) ?? []
)

const resolveErrorKey = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  if (message.includes('key_access_denied')) {
    return 'settings.data.yoBrowser.import.keyDenied'
  }
  if (message.includes('source_changed') || message.includes('preview_expired')) {
    return 'settings.data.yoBrowser.import.previewExpired'
  }
  if (message.includes('encryption_unsupported')) {
    return 'settings.data.yoBrowser.import.encryptionUnsupported'
  }
  return 'settings.data.yoBrowser.import.failed'
}

const reset = () => {
  loading.value = false
  busy.value = false
  scanResult.value = null
  selectedProfileId.value = ''
  preview.value = null
  result.value = null
  errorKey.value = ''
}

const scan = async () => {
  loading.value = true
  errorKey.value = ''
  try {
    scanResult.value = await browserClient.scanImportSources()
    selectedProfileId.value = profiles.value[0]?.id ?? ''
  } catch (error) {
    errorKey.value = resolveErrorKey(error)
  } finally {
    loading.value = false
  }
}

const createPreview = async () => {
  if (!selectedProfileId.value) return
  busy.value = true
  errorKey.value = ''
  try {
    preview.value = await browserClient.previewImport(selectedProfileId.value)
  } catch (error) {
    errorKey.value = resolveErrorKey(error)
  } finally {
    busy.value = false
  }
}

const applyImport = async () => {
  if (!preview.value) return
  busy.value = true
  errorKey.value = ''
  try {
    result.value = await browserClient.applyImport(preview.value.token)
  } catch (error) {
    preview.value = null
    errorKey.value = resolveErrorKey(error)
  } finally {
    busy.value = false
  }
}

watch(open, (isOpen) => {
  if (isOpen) {
    reset()
    void scan()
  }
})

watch(selectedProfileId, () => {
  preview.value = null
  errorKey.value = ''
})
</script>
