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

      <!-- Skill chip -->
      <span
        v-else-if="block.type === 'skill'"
        class="inline-flex items-center gap-1 rounded-md border border-primary/30 bg-primary/10 px-1.5 py-0.5 text-xs text-primary align-middle"
        data-testid="user-message-inline-skill"
      >
        <Icon icon="lucide:sparkles" class="h-3 w-3 shrink-0" />
        <span class="truncate max-w-[160px]">{{ block.skillName }}</span>
      </span>

      <!-- File chip -->
      <span
        v-else-if="block.type === 'file'"
        class="inline-flex items-center gap-1 rounded-md border border-muted-foreground/25 bg-muted/25 px-1.5 py-0.5 text-xs text-muted-foreground align-middle"
        data-testid="user-message-inline-file"
      >
        <Icon :icon="getFileIcon(block)" class="h-3 w-3 shrink-0" />
        <span class="truncate max-w-[120px]">{{ block.fileName }}</span>
      </span>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Icon } from '@iconify/vue'
import type {
  DisplayUserMessageCodeBlock,
  DisplayUserMessageFileBlock,
  DisplayUserMessageMentionBlock,
  DisplayUserMessageSkillBlock,
  DisplayUserMessageTextBlock
} from '@/features/chat-page/model/displayMessage'
import { useLanguageStore } from '@/stores/language'
import { getMimeTypeIcon } from '@/lib/utils'

const MENTION_ICON_MAP: Record<string, string> = {
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

type ContentBlock =
  | DisplayUserMessageTextBlock
  | DisplayUserMessageMentionBlock
  | DisplayUserMessageCodeBlock
  | DisplayUserMessageSkillBlock
  | DisplayUserMessageFileBlock

const props = defineProps<{
  content: ContentBlock[]
}>()

const emit = defineEmits<{
  mentionClick: [block: DisplayUserMessageMentionBlock]
}>()
const langStore = useLanguageStore()
// 计算属性：处理内容块
const contentBlocks = computed(() => {
  return props.content || []
})

// 处理 mention 点击事件
const handleMentionClick = (block: DisplayUserMessageMentionBlock) => {
  emit('mentionClick', block)
}

// 根据 category 获取对应的图标
const getMentionIcon = (category: string) => {
  return MENTION_ICON_MAP[category] || MENTION_ICON_MAP.default
}

const getMentionLabel = (block: DisplayUserMessageMentionBlock) => {
  if (block.category === 'prompts') {
    return block.id || block.content
  }
  if (block.category === 'context') {
    return block.id || block.category
  }
  return block.content
}

const getMentionTitle = (block: DisplayUserMessageMentionBlock) => {
  if (block.category === 'context') {
    return block.id || ''
  }
  return block.content
}

const getFileIcon = (block: DisplayUserMessageFileBlock) => {
  return getMimeTypeIcon(block.mimeType || 'application/octet-stream')
}
</script>
