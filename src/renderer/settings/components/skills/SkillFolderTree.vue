<template>
  <div class="text-sm">
    <div v-if="loading" class="flex items-center justify-center py-4">
      <Spinner class="size-4 text-muted-foreground" />
    </div>
    <div v-else-if="nodes.length === 0" class="py-4 text-center text-muted-foreground">
      {{ t('settings.skills.edit.noFiles') }}
    </div>
    <div v-else class="space-y-0.5">
      <SkillFolderTreeNode v-for="node in nodes" :key="node.path" :node="node" :depth="0" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { Spinner } from '@shadcn/components/ui/spinner'
import { useSkillsStore } from '@/stores/skillsStore'
import type { SkillFolderNode } from '@shared/types/skill'
import SkillFolderTreeNode from './SkillFolderTreeNode.vue'

const props = defineProps<{
  skillName: string
}>()

const { t } = useI18n()
const skillsStore = useSkillsStore()

const nodes = ref<SkillFolderNode[]>([])
const loading = ref(false)

const loadTree = async () => {
  if (!props.skillName) return
  loading.value = true
  try {
    nodes.value = await skillsStore.getSkillFolderTree(props.skillName)
  } catch (error) {
    console.error('Failed to load folder tree:', error)
    nodes.value = []
  } finally {
    loading.value = false
  }
}

watch(
  () => props.skillName,
  () => {
    loadTree()
  }
)

onMounted(() => {
  loadTree()
})
</script>
