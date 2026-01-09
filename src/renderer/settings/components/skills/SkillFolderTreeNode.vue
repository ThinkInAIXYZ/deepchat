<template>
  <div>
    <div
      class="flex items-center gap-1.5 py-0.5 px-1 rounded hover:bg-muted/50 cursor-default"
      :style="{ paddingLeft: `${depth * 12 + 4}px` }"
      @click="toggleExpand"
    >
      <template v-if="node.type === 'directory'">
        <Icon
          :icon="expanded ? 'lucide:chevron-down' : 'lucide:chevron-right'"
          class="w-3 h-3 text-muted-foreground shrink-0"
        />
        <Icon icon="lucide:folder" class="w-4 h-4 text-yellow-500 shrink-0" />
      </template>
      <template v-else>
        <span class="w-3" />
        <Icon :icon="getFileIcon(node.name)" class="w-4 h-4 text-muted-foreground shrink-0" />
      </template>
      <span class="truncate text-sm">{{ node.name }}</span>
    </div>
    <div v-if="node.type === 'directory' && expanded && node.children">
      <SkillFolderTreeNode
        v-for="child in node.children"
        :key="child.path"
        :node="child"
        :depth="depth + 1"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { Icon } from '@iconify/vue'
import type { SkillFolderNode } from '@shared/types/skill'

defineProps<{
  node: SkillFolderNode
  depth: number
}>()

const expanded = ref(true)

const toggleExpand = () => {
  expanded.value = !expanded.value
}

const getFileIcon = (filename: string): string => {
  const ext = filename.split('.').pop()?.toLowerCase()
  switch (ext) {
    case 'md':
      return 'lucide:file-text'
    case 'js':
    case 'ts':
      return 'lucide:file-code'
    case 'json':
      return 'lucide:file-json'
    case 'sh':
      return 'lucide:terminal'
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'svg':
      return 'lucide:image'
    default:
      return 'lucide:file'
  }
}
</script>
