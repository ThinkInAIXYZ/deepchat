<script setup lang="ts">
import { computed, type HTMLAttributes } from 'vue'
import { cn } from '@/lib/utils'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import type { BaseComponentProps } from '../types'

interface Provider {
  id: string
  name: string
  type: 'cloud' | 'local' | 'api'
  status?: 'connected' | 'disconnected' | 'error'
  models?: string[]
  description?: string
  icon?: string
}

interface Props extends BaseComponentProps {
  providers: Provider[]
  selectedProvider?: string
  placeholder?: string
  showStatus?: boolean
  class?: HTMLAttributes['class']
}

const props = withDefaults(defineProps<Props>(), {
  placeholder: 'Select a provider...',
  showStatus: true
})

const emit = defineEmits<{
  providerChange: [providerId: string, provider: Provider]
}>()

const containerClasses = computed(() => cn('w-full', props.class))

const getStatusClasses = (status?: Provider['status']) =>
  cn('inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full', {
    'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200': status === 'connected',
    'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200': status === 'error',
    'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200':
      status === 'disconnected' || !status
  })

const getTypeClasses = (type: Provider['type']) =>
  cn('text-xs px-1.5 py-0.5 rounded', {
    'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200': type === 'cloud',
    'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200': type === 'local',
    'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200': type === 'api'
  })

const handleProviderChange = (providerId: string) => {
  const provider = props.providers.find((p) => p.id === providerId)
  if (provider) {
    emit('providerChange', providerId, provider)
  }
}

const getStatusIcon = (status?: Provider['status']) => {
  switch (status) {
    case 'connected':
      return '🟢'
    case 'error':
      return '🔴'
    default:
      return '⚫'
  }
}
</script>

<template>
  <div :class="containerClasses">
    <Select :model-value="selectedProvider" @update:model-value="handleProviderChange">
      <SelectTrigger>
        <SelectValue :placeholder="placeholder" />
      </SelectTrigger>

      <SelectContent>
        <SelectItem v-for="provider in providers" :key="provider.id" :value="provider.id">
          <div class="flex items-center justify-between w-full gap-3">
            <div class="flex items-center gap-2 min-w-0 flex-1">
              <span v-if="provider.icon" class="text-lg">{{ provider.icon }}</span>

              <div class="flex flex-col gap-1 min-w-0">
                <div class="flex items-center gap-2">
                  <span class="font-medium text-sm">{{ provider.name }}</span>
                  <Badge :class="getTypeClasses(provider.type)">
                    {{ provider.type }}
                  </Badge>
                </div>

                <p v-if="provider.description" class="text-xs text-muted-foreground truncate">
                  {{ provider.description }}
                </p>

                <div v-if="provider.models?.length" class="text-xs text-muted-foreground">
                  {{ provider.models.length }} model{{ provider.models.length !== 1 ? 's' : '' }}
                  available
                </div>
              </div>
            </div>

            <div v-if="showStatus" class="flex items-center gap-2 shrink-0">
              <Badge :class="getStatusClasses(provider.status)">
                {{ getStatusIcon(provider.status) }}
                {{ provider.status || 'disconnected' }}
              </Badge>
            </div>
          </div>
        </SelectItem>
      </SelectContent>
    </Select>

    <!-- Selected Provider Details -->
    <div v-if="selectedProvider" class="mt-2 p-3 bg-muted/50 rounded-md">
      <slot name="provider-details" :provider="providers.find((p) => p.id === selectedProvider)" />
    </div>
  </div>
</template>
