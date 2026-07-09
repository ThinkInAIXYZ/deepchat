<template>
  <NodeViewWrapper
    class="inline-flex items-center gap-1 rounded-md border border-primary/30 bg-primary/10 px-1.5 py-0.5 text-xs text-primary select-none"
    data-skill-chip
    as="span"
  >
    <Icon icon="lucide:sparkles" class="h-3 w-3 shrink-0" />
    <span class="truncate max-w-[160px]">{{ node.attrs.skillName }}</span>
    <button
      type="button"
      class="inline-flex h-3.5 w-3.5 items-center justify-center rounded-sm hover:bg-primary/20"
      :aria-label="`${t('common.delete')} ${node.attrs.skillName}`"
      @mousedown.prevent="handleRemove"
    >
      <Icon icon="lucide:x" class="h-3 w-3" />
    </button>
  </NodeViewWrapper>
</template>

<script setup lang="ts">
import { inject } from 'vue'
import { Icon } from '@iconify/vue'
import { NodeViewWrapper } from '@tiptap/vue-3'
import type { NodeViewProps } from '@tiptap/vue-3'
import { useI18n } from 'vue-i18n'
import { INPUT_NODE_ACTIONS, type InputNodeActions } from './symbols'

const props = defineProps<NodeViewProps>()
const actions = inject<InputNodeActions>(INPUT_NODE_ACTIONS)
const { t } = useI18n()

function handleRemove() {
  props.deleteNode()
  const skillName = props.node.attrs.skillName as string
  if (skillName && actions?.removeSkill) {
    actions.removeSkill(skillName)
  }
}
</script>
