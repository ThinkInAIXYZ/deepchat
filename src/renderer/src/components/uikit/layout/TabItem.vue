<script setup lang="ts">
import { computed, inject, type HTMLAttributes } from 'vue'
import { cn } from '@/lib/utils'
import type { BaseComponentProps } from '../types'

interface Props extends BaseComponentProps {
  tabId: string
  lazy?: boolean
  class?: HTMLAttributes['class']
}

const props = withDefaults(defineProps<Props>(), {
  lazy: false
})

const activeTab = inject<{ value: string }>('activeTab')

const isActive = computed(() => activeTab?.value === props.tabId)

const contentClasses = computed(() => cn('w-full', props.class))

// Track if this tab has been rendered before (for lazy loading)
const hasBeenActive = ref(false)

watchEffect(() => {
  if (isActive.value) {
    hasBeenActive.value = true
  }
})

const shouldRender = computed(() => {
  if (!props.lazy) return true
  return hasBeenActive.value
})
</script>

<template>
  <div
    v-if="shouldRender"
    v-show="isActive"
    :class="contentClasses"
    role="tabpanel"
    :aria-hidden="!isActive"
  >
    <slot :isActive="isActive" />
  </div>
</template>

<script lang="ts">
import { ref, watchEffect } from 'vue'
</script>
