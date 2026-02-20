<template>
  <div class="flex items-center justify-between px-3 py-2 gap-2 border-t border-border/40">
    <div class="flex items-center gap-1 min-w-0">
      <slot name="left" />
    </div>
    <div class="flex items-center gap-1">
      <slot name="right" />
    </div>
  </div>
</template>
