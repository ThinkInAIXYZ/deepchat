<template>
  <div class="flex flex-row gap-2 rounded-lg px-2 py-2 text-xs text-muted-foreground">
    <Spinner class="size-4" />
    {{ t('artifacts.generating') }}
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { onMounted, ref, watch } from 'vue'
import { createConfigClient } from '@api/ConfigClient'
import { Spinner } from '@shadcn/components/ui/spinner'

const { t } = useI18n()
const configClient = createConfigClient()
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
