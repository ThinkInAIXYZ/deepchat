<template>
  <Dialog :open="store.isOpen" @update:open="onDialogToggle">
    <DialogContent class="max-w-3xl max-h-[85vh] p-0">
      <div class="flex h-full max-h-[85vh] flex-col">
        <DialogHeader class="px-6 pt-6">
          <DialogTitle>
            {{
              t('mcp.sampling.title', {
                server:
                  store.request?.serverLabel ||
                  store.request?.serverName ||
                  t('mcp.sampling.unknownServer')
              })
            }}
          </DialogTitle>
          <DialogDescription>
            {{ t('mcp.sampling.description') }}
          </DialogDescription>
        </DialogHeader>

        <div v-if="store.request" class="flex flex-1 flex-col gap-4 overflow-hidden px-6 pb-4">
          <!-- System Prompt (Collapsible) -->
          <Collapsible v-if="store.request.systemPrompt" :default-open="false">
            <CollapsibleTrigger as-child>
              <div
                class="flex items-center justify-between py-2 cursor-pointer hover:bg-muted/20 rounded-md px-3 -mx-3"
              >
                <h4 class="text-sm font-semibold text-muted-foreground">
                  {{ t('mcp.sampling.systemPrompt') }}
                </h4>
                <Icon
                  icon="lucide:chevron-right"
                  class="w-4 h-4 text-muted-foreground transition-transform duration-200"
                />
              </div>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div class="max-h-48 overflow-y-auto rounded-md border bg-muted/40 p-3 pr-2">
                <p class="whitespace-pre-wrap text-sm leading-relaxed">
                  {{ store.request.systemPrompt }}
                </p>
              </div>
            </CollapsibleContent>
          </Collapsible>

          <!-- Conversation Context (Always expanded) -->
          <div class="flex min-h-0 flex-1 flex-col space-y-3 overflow-hidden">
            <h4 class="text-sm font-semibold text-muted-foreground">
              {{ t('mcp.sampling.messagesTitle') }}
            </h4>
            <ScrollArea class="flex-1 overflow-y-auto pr-2">
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
                  <p
                    v-if="message.type === 'text'"
                    class="whitespace-pre-wrap text-sm leading-relaxed"
                  >
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
                  <div v-else-if="message.type === 'audio'" class="flex flex-col items-start gap-2">
                    <div class="flex items-center gap-2 text-sm text-muted-foreground">
                      <Icon icon="lucide:music" class="w-4 h-4" />
                      <span>Audio content</span>
                    </div>
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

          <!-- Model Preferences (Collapsible) -->
          <Collapsible v-if="preferenceSummary.length > 0" :default-open="false">
            <CollapsibleTrigger as-child>
              <div
                class="flex items-center justify-between py-2 cursor-pointer hover:bg-muted/20 rounded-md px-3 -mx-3"
              >
                <h4 class="text-sm font-semibold text-muted-foreground">
                  {{ t('mcp.sampling.preferencesTitle') }}
                </h4>
                <Icon
                  icon="lucide:chevron-right"
                  class="w-4 h-4 text-muted-foreground transition-transform duration-200"
                />
              </div>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div class="rounded-md border bg-muted/30 p-3">
                <ul class="space-y-1 text-sm">
                  <li
                    v-for="item in preferenceSummary"
                    :key="item.key"
                    class="flex items-center gap-2"
                  >
                    <span class="font-medium text-muted-foreground">{{ item.label }}</span>
                    <span>{{ item.value }}</span>
                  </li>
                </ul>
              </div>
            </CollapsibleContent>
          </Collapsible>

          <!-- Max Tokens Info -->
          <div
            v-if="store.request.maxTokens"
            class="text-xs text-muted-foreground bg-muted/20 rounded-md p-2"
          >
            {{ t('mcp.sampling.maxTokensInfo', { maxTokens: store.request.maxTokens }) }}
          </div>

          <!-- Model Selection (Compact Popover) -->
          <div class="flex items-center gap-3">
            <span class="text-sm font-medium text-muted-foreground">{{
              t('mcp.sampling.respondWith')
            }}</span>
            <Popover v-model:open="modelSelectOpen">
              <PopoverTrigger as-child>
                <Button
                  variant="ghost"
                  class="flex items-center gap-1.5 h-7 px-2 rounded-md text-xs font-semibold text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                  size="sm"
                  :disabled="!store.hasEligibleModel"
                >
                  <ModelIcon
                    v-if="store.selectedModel"
                    :model-id="store.selectedProviderId"
                    :is-dark="true"
                    custom-class="w-4 h-4"
                  />
                  <span class="text-xs font-semibold truncate max-w-[140px] text-foreground">
                    {{ store.selectedModel?.name || t('mcp.sampling.selectModel') }}
                  </span>
                  <Icon icon="lucide:chevron-right" class="w-4 h-4 text-muted-foreground" />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" class="w-80 border-none bg-transparent p-0 shadow-none">
                <ModelChooser
                  :requires-vision="store.requiresVision"
                  @update:model="onModelUpdate"
                />
              </PopoverContent>
            </Popover>
          </div>

          <!-- Model Status Messages -->
          <div v-if="!store.hasEligibleModel" class="text-sm text-destructive">
            {{
              store.requiresVision ? t('mcp.sampling.noVisionModels') : t('mcp.sampling.noModels')
            }}
          </div>
          <div
            v-else-if="store.requiresVision && !store.selectedModelSupportsVision"
            class="text-sm text-destructive"
          >
            {{ t('mcp.sampling.visionWarning') }}
          </div>
        </div>

        <DialogFooter class="border-t border-border/60 bg-card/60 px-6 py-4">
          <div class="flex w-full flex-col gap-2 sm:flex-row sm:justify-end">
            <Button
              variant="outline"
              class="sm:min-w-[96px]"
              :disabled="store.isSubmitting"
              @click="onReject"
            >
              {{ t('mcp.sampling.reject') }}
            </Button>
            <Button
              class="sm:min-w-[120px]"
              :disabled="store.isSubmitting || !store.selectedModel || !store.hasEligibleModel"
              @click="onConfirm"
            >
              <Icon
                v-if="store.isSubmitting"
                icon="lucide:loader-2"
                class="mr-2 h-4 w-4 animate-spin"
              />
              {{
                store.isSubmitting ? t('mcp.sampling.confirming') : t('mcp.sampling.sendResponse')
              }}
            </Button>
          </div>
        </DialogFooter>
      </div>
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
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from '@shadcn/components/ui/collapsible'
import { Popover, PopoverContent, PopoverTrigger } from '@shadcn/components/ui/popover'
import ModelChooser from '@/components/ModelChooser.vue'
import ModelIcon from '@/components/icons/ModelIcon.vue'
import { useMcpSamplingStoreLifecycle } from '@/composables/useMcpSamplingStoreLifecycle'
import { useI18n } from 'vue-i18n'
import { computed, ref } from 'vue'
import { Icon } from '@iconify/vue'

const store = useMcpSamplingStoreLifecycle()
const { t } = useI18n()
const modelSelectOpen = ref(false)

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
  modelSelectOpen.value = false
}

const onReject = () => {
  void store.rejectRequest()
}

const onConfirm = () => {
  void store.confirmApproval()
}

const onDialogToggle = (open: boolean) => {
  if (!open && !store.isSubmitting) {
    void store.dismissRequest()
  }
}
</script>
