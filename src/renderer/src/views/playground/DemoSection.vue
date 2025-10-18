<template>
  <section
    class="rounded-xl border border-border bg-background/80 shadow-sm overflow-hidden"
    :class="fullWidth ? 'md:col-span-2' : ''"
  >
    <header class="border-b border-border bg-muted/40 px-4 py-3 flex items-center justify-between">
      <div>
        <h3 class="text-base font-semibold leading-none">{{ title }}</h3>
        <p v-if="description" class="text-xs text-muted-foreground mt-1">
          {{ description }}
        </p>
      </div>
      <span v-if="componentName" class="text-[11px] uppercase tracking-wide text-muted-foreground">
        {{ componentName }}
      </span>
    </header>

    <div class="p-4 bg-muted/10">
      <component :is="demo" />
    </div>
  </section>
</template>

<script setup lang="ts">
defineProps<{
  title: string
  description?: string
  componentName?: string
  demo: any
  fullWidth?: boolean
}>()
</script>
