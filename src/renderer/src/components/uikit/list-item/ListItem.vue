<script setup lang="ts">
type Props = {
  class?: string
}
withDefaults(defineProps<Props>(), {})
</script>

<template>
  <div :class="['flex items-center gap-2 py-1 px-2 rounded-md hover:bg-accent/50', $props.class]">
    <div class="shrink-0"><slot name="icon" /></div>
    <div class="min-w-0 flex-1">
      <div class="text-xs text-foreground truncate"><slot /></div>
      <div class="text-[11px] text-muted-foreground truncate"><slot name="meta" /></div>
    </div>
    <div class="shrink-0"><slot name="end" /></div>
  </div>
</template>
