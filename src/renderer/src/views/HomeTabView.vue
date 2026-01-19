<template>
  <div class="w-full h-full">
    <NewThread />
  </div>
</template>

<script setup lang="ts">
import { defineAsyncComponent } from 'vue'
const NewThread = defineAsyncComponent(() => import('@/components/NewThread.vue'))
</script>
