<!-- eslint-disable vue/no-v-html -->
<template>
  <div
    class="text-xs text-secondary-foreground bg-muted rounded-lg border border-input flex flex-col gap-2 px-2 py-2"
  >
    <div class="flex flex-row gap-2 items-center cursor-pointer" @click="collapse = !collapse">
      <Button variant="ghost" size="icon" class="w-4 h-4 text-muted-foreground">
        <Icon icon="lucide:chevrons-up-down" class="w-4 h-4" />
      </Button>
      <span class="flex-grow"
        >{{
          block.status === 'loading'
            ? t('chat.features.deepThinkingProgress')
            : t('chat.features.deepThinking')
        }}
        <span>{{
          reasoningDuration > 0 ? t('chat.features.thinkingDuration', [reasoningDuration]) : ''
        }}</span>
      </span>
    </div>
    <div
      v-show="!collapse"
      ref="messageBlock"
      class="w-full relative prose prose-sm dark:prose-invert max-w-full leading-7 break-all"
    >
      <NodeRenderer
        :renderCodeBlocksAsPre="true"
        :content="props.block.content || ''"
      ></NodeRenderer>
    </div>

    <Icon
      v-if="block.status === 'loading'"
      icon="lucide:loader-circle"
      class="w-4 h-4 text-muted-foreground animate-spin"
    />
  </div>
</template>

<script setup lang="ts">
import { Button } from '@/components/ui/button'
import { usePresenter } from '@/composables/usePresenter'
import { Icon } from '@iconify/vue'
import { AssistantMessageBlock } from '@shared/chat'
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import NodeRenderer from 'vue-renderer-markdown'
const props = defineProps<{
  block: AssistantMessageBlock
  usage: {
    reasoning_start_time: number
    reasoning_end_time: number
  }
}>()
const { t } = useI18n()

const configPresenter = usePresenter('configPresenter')

const messageBlock = ref<HTMLDivElement | null>(null)

const collapse = ref(false)
const reasoningDuration = computed(() => {
  let duration: number
  if (props.block.reasoning_time) {
    duration = (props.block.reasoning_time.end - props.block.reasoning_time.start) / 1000
  } else {
    duration = (props.usage.reasoning_end_time - props.usage.reasoning_start_time) / 1000
  }
  // 保留小数点后最多两位，去除尾随的0
  return parseFloat(duration.toFixed(2))
})

watch(
  () => collapse.value,
  () => {
    configPresenter.setSetting('think_collapse', collapse.value)
  }
)

onMounted(async () => {
  collapse.value = Boolean(await configPresenter.getSetting('think_collapse'))
})
</script>
