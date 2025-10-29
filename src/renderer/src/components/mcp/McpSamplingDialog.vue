<template>
  <Dialog :open="store.isOpen" @update:open="onDialogToggle">
    <DialogContent class="max-w-3xl">
      <DialogHeader>
        <DialogTitle>
          {{
            t('mcp.sampling.title', {
              server: store.request?.serverLabel || store.request?.serverName || t('mcp.sampling.unknownServer')
            })
          }}
        </DialogTitle>
        <DialogDescription>
          {{ t('mcp.sampling.description') }}
        </DialogDescription>
      </DialogHeader>

      <div v-if="store.request" class="space-y-4">
        <div v-if="store.request.systemPrompt" class="rounded-md border bg-muted/40 p-3">
          <h4 class="mb-2 text-sm font-semibold text-muted-foreground">
            {{ t('mcp.sampling.systemPrompt') }}
          </h4>
          <p class="whitespace-pre-wrap text-sm leading-relaxed">
            {{ store.request.systemPrompt }}
          </p>
        </div>

        <div class="space-y-3">
          <h4 class="text-sm font-semibold text-muted-foreground">
            {{ t('mcp.sampling.messagesTitle') }}
          </h4>
          <ScrollArea class="max-h-64 pr-2">
            <div class="space-y-3">
              <div
                v-for="(message, index) in store.request.messages"
                :key="`${message.role}-${index}`"
                class="rounded-md border p-3"
              >
                <div class="mb-2 flex items-center justify-between">
                  <Badge variant="outline" class="capitalize">{{ message.role }}</Badge>
                  <span class="text-xs text-muted-foreground">
                    {{ t(`mcp.sampling.contentType.${message.type}`) }}
                  </span>
                </div>
                <p v-if="message.type === 'text'" class="whitespace-pre-wrap text-sm leading-relaxed">
                  {{ message.text }}
                </p>
                <div v-else-if="message.type === 'image'" class="flex flex-col items-start gap-2">
                  <img
                    v-if="message.dataUrl"
                    :src="message.dataUrl"
                    class="max-h-40 rounded-md border object-contain"
                    :alt="t('mcp.sampling.imageAlt', { index: index + 1 })"
                  />
                  <span class="text-xs text-muted-foreground">
                    {{ message.mimeType || t('mcp.sampling.unknownMime') }}
                  </span>
                </div>
                <p v-else class="text-sm text-muted-foreground">
                  {{ t('mcp.sampling.unsupportedMessage') }}
                </p>
              </div>
            </div>
          </ScrollArea>
        </div>

        <div v-if="preferenceSummary.length > 0" class="rounded-md border bg-muted/30 p-3">
          <h4 class="mb-2 text-sm font-semibold text-muted-foreground">
            {{ t('mcp.sampling.preferencesTitle') }}
          </h4>
          <ul class="space-y-1 text-sm">
            <li v-for="item in preferenceSummary" :key="item.key" class="flex items-center gap-2">
              <span class="font-medium text-muted-foreground">{{ item.label }}</span>
              <span>{{ item.value }}</span>
            </li>
          </ul>
        </div>

        <div v-if="store.isChoosingModel" class="space-y-3">
          <ModelChooser @update:model="onModelUpdate" />
          <p
            v-if="store.requiresVision && !store.selectedModelSupportsVision"
            class="text-sm text-destructive"
          >
            {{ t('mcp.sampling.visionWarning') }}
          </p>
          <p v-else-if="store.selectedModel" class="text-xs text-muted-foreground">
            {{
              t('mcp.sampling.selectedModelLabel', {
                model: store.selectedModel?.name,
                provider: store.selectedProviderId
              })
            }}
          </p>
        </div>
      </div>

      <DialogFooter class="flex flex-col gap-2 sm:flex-row sm:justify-end">
        <Button
          variant="outline"
          :disabled="store.isSubmitting"
          @click="onReject"
        >
          {{ t('mcp.sampling.reject') }}
        </Button>
        <Button
          v-if="!store.isChoosingModel"
          :disabled="store.isSubmitting"
          @click="store.beginApprove"
        >
          {{ t('mcp.sampling.approve') }}
        </Button>
        <Button
          v-else
          :disabled="store.isSubmitting || !store.selectedModel"
          @click="onConfirm"
        >
          <Icon v-if="store.isSubmitting" icon="lucide:loader-2" class="mr-2 h-4 w-4 animate-spin" />
          {{ store.isSubmitting ? t('mcp.sampling.confirming') : t('mcp.sampling.confirm') }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@shadcn/components/ui/dialog'
import { ScrollArea } from '@shadcn/components/ui/scroll-area'
import { Button } from '@shadcn/components/ui/button'
import { Badge } from '@shadcn/components/ui/badge'
import ModelChooser from '@/components/ModelChooser.vue'
import { useMcpSamplingStore } from '@/stores/mcpSampling'
import { useI18n } from 'vue-i18n'
import { computed } from 'vue'
import { Icon } from '@iconify/vue'

const store = useMcpSamplingStore()
const { t } = useI18n()

const preferenceSummary = computed(() => {
  const prefs = store.request?.modelPreferences
  if (!prefs) {
    return [] as Array<{ key: string; label: string; value: string }>
  }

  const entries: Array<{ key: string; label: string; value: string }> = []
  if (typeof prefs.costPriority === 'number') {
    entries.push({
      key: 'cost',
      label: t('mcp.sampling.preference.cost'),
      value: prefs.costPriority.toFixed(2)
    })
  }
  if (typeof prefs.speedPriority === 'number') {
    entries.push({
      key: 'speed',
      label: t('mcp.sampling.preference.speed'),
      value: prefs.speedPriority.toFixed(2)
    })
  }
  if (typeof prefs.intelligencePriority === 'number') {
    entries.push({
      key: 'intelligence',
      label: t('mcp.sampling.preference.intelligence'),
      value: prefs.intelligencePriority.toFixed(2)
    })
  }
  if (Array.isArray(prefs.hints) && prefs.hints.length > 0) {
    entries.push({
      key: 'hints',
      label: t('mcp.sampling.preference.hints'),
      value: prefs.hints.map((hint) => hint?.name ?? t('mcp.sampling.unknownHint')).join(', ')
    })
  }
  return entries
})

const onModelUpdate = (model, providerId: string) => {
  store.selectModel(model, providerId)
}

const onReject = () => {
  void store.rejectRequest()
}

const onConfirm = () => {
  void store.confirmApproval()
}

const onDialogToggle = (open: boolean) => {
  if (!open && !store.isSubmitting) {
    store.closeRequest()
  }
}
</script>
