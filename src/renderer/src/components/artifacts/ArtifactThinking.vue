<template>
  <div class="text-xs text-muted-foreground rounded-lg flex flex-row gap-2 px-2 py-2">
    <Icon icon="lucide:loader-2" class="w-4 h-4 animate-spin" />
    生成artifact...
  </div>
</template>

<script setup lang="ts">
// import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { onMounted, ref, watch } from 'vue'
import { ConfigClient } from '@api/ConfigClient'

// const { t } = useI18n()
const configClient = new ConfigClient()
const collapse = ref(false)

watch(
  () => collapse.value,
  () => {
    void configClient.setSetting('artifact_think_collapse', collapse.value)
  }
)

onMounted(async () => {
  collapse.value = Boolean(await configClient.getSetting('artifact_think_collapse'))
})
</script>
