<script setup lang="ts">
import { computed } from 'vue'

type Props = {
  bordered?: boolean
  dense?: boolean
  class?: string
}

const props = withDefaults(defineProps<Props>(), {
  bordered: false,
  dense: false
})

const klass = computed(() => [
  'w-full h-10 flex items-center gap-1 px-2',
  props.dense ? 'h-9' : 'h-10',
  props.bordered ? 'border-b border-border' : ''
])
</script>

<template>
  <div :class="[klass, props.class]">
    <slot />
  </div>
</template>
