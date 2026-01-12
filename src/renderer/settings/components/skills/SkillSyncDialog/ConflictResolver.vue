<template>
  <div class="space-y-4">
    <!-- Batch actions -->
    <div v-if="conflicts.length > 1" class="flex items-center gap-2 pb-2 border-b">
      <span class="text-sm text-muted-foreground">
        {{ t('settings.skills.sync.batchAction') }}:
      </span>
      <Button variant="outline" size="sm" @click="setAllStrategies(ConflictStrategy.SKIP)">
        {{ t('settings.skills.sync.skipAll') }}
      </Button>
      <Button variant="outline" size="sm" @click="setAllStrategies(ConflictStrategy.OVERWRITE)">
        {{ t('settings.skills.sync.overwriteAll') }}
      </Button>
      <Button variant="outline" size="sm" @click="setAllStrategies(ConflictStrategy.RENAME)">
        {{ t('settings.skills.sync.renameAll') }}
      </Button>
    </div>

    <!-- Conflicts list -->
    <ScrollArea class="h-[300px] pr-4">
      <div class="space-y-3">
        <div
          v-for="conflict in conflicts"
          :key="conflict.skillName"
          class="p-3 border rounded-lg space-y-2"
        >
          <div class="flex items-center gap-2">
            <Icon icon="lucide:alert-triangle" class="w-4 h-4 text-amber-500" />
            <span class="font-medium">{{ conflict.skillName }}</span>
          </div>
          <p class="text-xs text-muted-foreground">
            {{ t('settings.skills.sync.conflictDescription', { name: conflict.existingName }) }}
          </p>

          <!-- Strategy selection -->
          <RadioGroup
            :model-value="strategies[conflict.skillName] || 'skip'"
            @update:model-value="updateStrategy(conflict.skillName, $event as ConflictStrategy)"
            class="flex gap-4"
          >
            <div class="flex items-center space-x-2">
              <RadioGroupItem value="skip" :id="`${conflict.skillName}-skip`" />
              <Label :for="`${conflict.skillName}-skip`" class="text-sm cursor-pointer">
                {{ t('settings.skills.sync.skip') }}
              </Label>
            </div>
            <div class="flex items-center space-x-2">
              <RadioGroupItem value="overwrite" :id="`${conflict.skillName}-overwrite`" />
              <Label :for="`${conflict.skillName}-overwrite`" class="text-sm cursor-pointer">
                {{ t('settings.skills.sync.overwrite') }}
              </Label>
            </div>
            <div class="flex items-center space-x-2">
              <RadioGroupItem value="rename" :id="`${conflict.skillName}-rename`" />
              <Label :for="`${conflict.skillName}-rename`" class="text-sm cursor-pointer">
                {{ t('settings.skills.sync.rename') }}
              </Label>
            </div>
          </RadioGroup>
        </div>
      </div>
    </ScrollArea>

    <!-- Warnings -->
    <div v-if="warnings.length > 0" class="space-y-2">
      <div class="text-sm font-medium text-amber-600 dark:text-amber-400">
        {{ t('settings.skills.sync.warnings') }}
      </div>
      <div class="space-y-1">
        <div
          v-for="(warning, index) in warnings"
          :key="index"
          class="text-xs text-muted-foreground flex items-start gap-2"
        >
          <Icon icon="lucide:info" class="w-3 h-3 mt-0.5 shrink-0" />
          <span>{{ warning }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { Button } from '@shadcn/components/ui/button'
import { Label } from '@shadcn/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@shadcn/components/ui/radio-group'
import { ScrollArea } from '@shadcn/components/ui/scroll-area'
import { ConflictStrategy } from '@shared/types/skillSync'

export interface ConflictItem {
  skillName: string
  existingName: string
}

const props = defineProps<{
  conflicts: ConflictItem[]
  strategies: Record<string, ConflictStrategy>
  warnings: string[]
}>()

const emit = defineEmits<{
  'update:strategies': [value: Record<string, ConflictStrategy>]
}>()

const { t } = useI18n()

const updateStrategy = (skillName: string, strategy: ConflictStrategy) => {
  emit('update:strategies', {
    ...props.strategies,
    [skillName]: strategy
  })
}

const setAllStrategies = (strategy: ConflictStrategy) => {
  const newStrategies: Record<string, ConflictStrategy> = {}
  for (const conflict of props.conflicts) {
    newStrategies[conflict.skillName] = strategy
  }
  emit('update:strategies', newStrategies)
}
</script>
