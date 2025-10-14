<template>
  <ScrollArea class="w-full h-full">
    <div class="w-full flex flex-col gap-4 p-4">
      <PromptSettingsHeader @import="handleImportPrompts" @export="handleExportPrompts" />
      <Separator />
      <SystemPromptSettingsSection />
      <Separator />
      <CustomPromptSettingsSection ref="customPromptSection" />
    </div>
  </ScrollArea>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { ScrollArea } from '@shadcn/components/ui/scroll-area'
import { Separator } from '@shadcn/components/ui/separator'
import PromptSettingsHeader from './prompt/PromptSettingsHeader.vue'
import SystemPromptSettingsSection from './prompt/SystemPromptSettingsSection.vue'
import CustomPromptSettingsSection from './prompt/CustomPromptSettingsSection.vue'

const customPromptSection = ref<InstanceType<typeof CustomPromptSettingsSection> | null>(null)

const handleImportPrompts = () => {
  customPromptSection.value?.importPrompts()
}

const handleExportPrompts = () => {
  customPromptSection.value?.exportPrompts()
}
</script>
