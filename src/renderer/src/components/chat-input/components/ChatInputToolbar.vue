<template>
  <div class="flex items-center justify-between gap-2">
    <div class="flex items-center gap-1.5 min-w-0">
      <slot name="left" />
    </div>
    <div class="flex items-center gap-2 flex-wrap">
      <slot name="right" />
    </div>
  </div>
</template>
