<template>
  <Transition
    enter-active-class="transition ease-out duration-200"
    enter-from-class="translate-x-full opacity-0"
    enter-to-class="translate-x-0 opacity-100"
    leave-active-class="transition ease-in duration-200"
    leave-from-class="translate-x-0 opacity-100"
    leave-to-class="translate-x-full opacity-0"
  >
    <aside v-if="isVisible" :class="panelClasses" class="h-full flex-1 border-l bg-background">
      <!-- 两个面板都显示时，使用 flex 布局 -->
      <div v-if="showBoth" class="flex h-full w-full">
        <WorkspaceView @append-file-path="handleAppendFilePath" />
        <ArtifactPanel class="flex-1 min-w-0" />
      </div>

      <!-- 仅显示 workspace -->
      <WorkspaceView
        v-else-if="showWorkspace"
        class="h-full w-full"
        @append-file-path="handleAppendFilePath"
      />

      <!-- 仅显示 artifact -->
      <ArtifactPanel v-else-if="showArtifact" class="h-full" />
    </aside>
  </Transition>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useWorkspaceStore } from '@/stores/workspace'
import { useArtifactStore } from '@/stores/artifact'
import WorkspaceView from '@/components/workspace/WorkspaceView.vue'
import ArtifactPanel from '@/components/artifacts/ArtifactPanel.vue'

// Emit events
const emit = defineEmits<{
  'append-file-path': [filePath: string]
}>()

// Stores
const workspaceStore = useWorkspaceStore()
const artifactStore = useArtifactStore()

// Panel visibility logic
const showWorkspace = computed(() => workspaceStore.isOpen)
const showArtifact = computed(() => artifactStore.isOpen)
const showBoth = computed(() => showWorkspace.value && showArtifact.value)
const isVisible = computed(() => showWorkspace.value || showArtifact.value)

// Dynamic width calculation
const panelClasses = computed(() => {
  if (showBoth.value) {
    // 两个面板都显示，总宽度 60%
    return 'w-[60%] max-lg:w-[90%]'
  }
  if (showArtifact.value) {
    // 仅 artifact，保持原宽度
    return 'w-[calc(60%-104px)] max-lg:w-3/4'
  }
  // 仅 workspace，固定宽度
  return 'w-[228px]'
})

// Event handlers
const handleAppendFilePath = (filePath: string) => {
  emit('append-file-path', filePath)
}
</script>
