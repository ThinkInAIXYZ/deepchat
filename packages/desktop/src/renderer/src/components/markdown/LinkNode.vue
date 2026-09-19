<template>
  <a :href="href" :class="linkClass" :title="props.node.title ?? undefined" @click="handleClick">
    <slot>{{ linkText }}</slot>
  </a>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { classifyMarkdownLink, type MarkdownLinkContext } from './linkTypes'
import { useMarkdownLinkNavigation } from './useMarkdownLinkNavigation'

interface Props {
  node: {
    href?: string
    url?: string
    text?: string
    title?: string | null
  }
  linkContext?: MarkdownLinkContext
}

const props = defineProps<Props>()

const { navigateLink } = useMarkdownLinkNavigation({
  linkContext: computed(() => props.linkContext)
})

const href = computed(() => props.node.href ?? props.node.url ?? '')
const linkText = computed(() => props.node.text?.trim() || href.value)

const linkClass = computed(() => {
  const baseClass = 'cursor-pointer underline decoration-from-font hover:opacity-80'
  const target = classifyMarkdownLink(href.value)

  if (target.kind === 'local-file' || target.kind === 'fragment') {
    return `${baseClass} text-purple-600 dark:text-purple-400`
  }

  return `${baseClass} text-blue-600 dark:text-blue-400`
})

const handleClick = async (event: MouseEvent) => {
  await navigateLink(href.value, event)
}
</script>
