<template>
  <div class="my-1 w-full">
    <div class="space-y-3 rounded-lg border bg-card p-3 text-card-foreground">
      <div class="flex items-center justify-between gap-2">
        <div class="flex items-center gap-2 min-w-0">
          <Icon icon="lucide:panels-top-left" class="h-4 w-4 text-muted-foreground" />
          <div class="min-w-0">
            <p class="text-xs font-medium leading-tight text-foreground">
              {{ t('chat.mcpUi.title') }}
            </p>
            <p v-if="resource?.uri" class="truncate text-[11px] text-muted-foreground">
              {{ resource.uri }}
            </p>
          </div>
        </div>
        <Badge variant="secondary" class="h-6 px-2 text-[11px] leading-tight">
          {{ t('chat.mcpUi.badge') }}
        </Badge>
      </div>

      <div
        v-if="errorMessage"
        class="flex items-center gap-2 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive"
      >
        <Icon icon="lucide:alert-circle" class="h-4 w-4 shrink-0" />
        <span class="leading-tight">{{ errorMessage }}</span>
      </div>
      <div v-else-if="!resourcePayload" class="text-xs text-muted-foreground">
        {{ t('common.error.requestFailed') }}
      </div>
      <div v-else class="space-y-2">
        <div class="overflow-hidden rounded-md border bg-muted/40">
          <ui-resource-renderer
            ref="rendererRef"
            class="block w-full min-h-60"
            :resource="resourcePayload"
          />
        </div>
        <div v-if="isLoading" class="flex items-center gap-2 text-xs text-muted-foreground">
          <Icon icon="lucide:loader-2" class="h-4 w-4 animate-spin" />
          <span>{{ t('common.loading') }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { nanoid } from 'nanoid'
import { Icon } from '@iconify/vue'
import { Badge } from '@shadcn/components/ui/badge'
import { useI18n } from 'vue-i18n'
import type { UIActionResult } from '@mcp-ui/client'
import { AssistantMessageBlock } from '@shared/chat'
import { usePresenter } from '@/composables/usePresenter'

const props = defineProps<{
  block: AssistantMessageBlock
  messageId?: string
  threadId?: string
}>()

const { t } = useI18n()
const mcpPresenter = usePresenter('mcpPresenter')

const rendererRef = ref<HTMLElement | null>(null)
const isLoading = ref(false)
const errorMessage = ref<string | null>(null)

const resource = computed(() => props.block.mcp_ui_resource)

const resourcePayload = computed(() => {
  const value = resource.value
  if (!value?.uri || !value.mimeType) {
    return ''
  }
  try {
    return JSON.stringify(value)
  } catch (error) {
    console.error('[MessageBlockMcpUi] Failed to serialize MCP UI resource', error)
    errorMessage.value = t('common.error.requestFailed')
    return ''
  }
})

const handleUIAction = async (action?: UIActionResult | null): Promise<unknown> => {
  if (!action) {
    return null
  }

  if (action.type === 'tool') {
    const toolName = action.payload?.toolName
    if (!toolName) {
      const toolError = new Error('Tool name missing in MCP UI action')
      errorMessage.value = t('common.error.requestFailed')
      throw toolError
    }

    isLoading.value = true
    errorMessage.value = null
    try {
      const args = JSON.stringify(action.payload?.params ?? {})
      const response = await mcpPresenter.callTool({
        id: action.messageId || nanoid(),
        type: 'function',
        function: {
          name: toolName,
          arguments: args
        }
      })
      return response?.rawData ?? response
    } catch (error) {
      console.error('[MessageBlockMcpUi] Failed to execute MCP UI tool', error)
      errorMessage.value = t('common.error.requestFailed')
      throw error
    } finally {
      isLoading.value = false
    }
  }

  return null
}

const handleUIActionEvent = async (event: Event) => {
  const detail = (event as CustomEvent<UIActionResult>).detail
  try {
    await handleUIAction(detail)
  } catch {
    // Response handling is managed through UI renderer; errors are already captured
  }
}

watch(
  () => rendererRef.value,
  (element, previous) => {
    previous?.removeEventListener('onUIAction', handleUIActionEvent as EventListener)
    if (previous) {
      ;(
        previous as unknown as { onUIAction?: (action: UIActionResult) => Promise<unknown> }
      ).onUIAction = undefined
    }

    if (element) {
      element.addEventListener('onUIAction', handleUIActionEvent as EventListener)
      ;(
        element as unknown as { onUIAction?: (action: UIActionResult) => Promise<unknown> }
      ).onUIAction = handleUIAction
    }
  }
)

onBeforeUnmount(() => {
  const element = rendererRef.value
  element?.removeEventListener('onUIAction', handleUIActionEvent as EventListener)
  if (element) {
    ;(
      element as unknown as { onUIAction?: (action: UIActionResult) => Promise<unknown> }
    ).onUIAction = undefined
  }
})
</script>

<style>
ui-resource-renderer {
  display: block;
  width: 100%;
  height: 425px;

  & > div {
    display: block;
    width: 100%;
    height: 425px;
  }
}
</style>
