<template>
  <div class="text-sm whitespace-pre-wrap break-all" :dir="langStore.dir">
    <template v-for="(block, index) in contentBlocks" :key="index">
      <!-- 文本块 -->
      <span v-if="block.type === 'text'">{{ block.content }}</span>

      <!-- Mention 块 -->
      <span
        v-else-if="block.type === 'mention'"
        class="cursor-pointer px-1.5 py-0.5 text-xs rounded-md bg-blue-200/80 dark:bg-secondary text-foreground inline-flex items-center gap-1 max-w-64 align-sub truncate"
        :title="getMentionTitle(block)"
        @click="handleMentionClick(block)"
      >
        <Icon :icon="getMentionIcon(block.category)" class="w-3 h-3 shrink-0" />
        <span class="truncate">{{ getMentionLabel(block) }}</span>
      </span>

      <!-- 代码块 -->
      <code
        v-else-if="block.type === 'code'"
        class="bg-muted px-1.5 py-0.5 rounded text-xs font-mono"
      >
        {{ block.content }}
      </code>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Icon } from '@iconify/vue'
import type {
  UserMessageTextBlock,
  UserMessageMentionBlock,
  UserMessageCodeBlock
} from '@shared/chat'
import { useLanguageStore } from '@/stores/language'

type ContentBlock = UserMessageTextBlock | UserMessageMentionBlock | UserMessageCodeBlock

const props = defineProps<{
  content: ContentBlock[]
}>()

const emit = defineEmits<{
  mentionClick: [block: UserMessageMentionBlock]
}>()
const langStore = useLanguageStore()
// 计算属性：处理内容块
const contentBlocks = computed(() => {
  return props.content || []
})

// 处理 mention 点击事件
const handleMentionClick = (block: UserMessageMentionBlock) => {
  emit('mentionClick', block)
}

// 根据 category 获取对应的图标
const getMentionIcon = (category: string) => {
  const iconMap: Record<string, string> = {
    context: 'lucide:quote',
    prompts: 'lucide:message-square-quote',
    files: 'lucide:file-text',
    tools: 'lucide:wrench',
    skills: 'lucide:sparkles',
    users: 'lucide:user',
    channels: 'lucide:hash',
    projects: 'lucide:folder',
    documents: 'lucide:file-text',
    resources: 'lucide:database',
    default: 'lucide:at-sign'
  }

  return iconMap[category] || iconMap.default
}

const getMentionLabel = (block: UserMessageMentionBlock) => {
  if (block.category === 'prompts') {
    return block.id || block.content
  }
  if (block.category === 'context') {
    return block.id || block.category
  }
  return block.content
}

const getMentionTitle = (block: UserMessageMentionBlock) => {
  if (block.category === 'context') {
    return block.id || ''
  }
  return block.content
}
</script>
