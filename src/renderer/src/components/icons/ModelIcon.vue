<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useProviderStore } from '@/stores/providerStore'
import { useAgentStore } from '@/stores/ui/agent'
import AcpAgentIcon from './AcpAgentIcon.vue'
import {
  DEFAULT_MODEL_ICON_KEY,
  isMonoModelIconUrl,
  modelIcons,
  resolveModelIconKey
} from './modelIconRegistry'

interface Props {
  modelId: string
  customClass?: string
  isDark?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  customClass: 'w-4 h-4',
  isDark: false
})

const providerStore = useProviderStore()
const agentStore = useAgentStore()
const iconLoadFailed = ref(false)

const provider = computed(() => {
  if (!props.modelId) return undefined
  return providerStore.providers.find((item) => item.id === props.modelId)
})

const iconKey = computed(() => {
  return (
    resolveModelIconKey(props.modelId) ??
    resolveModelIconKey(provider.value?.apiType) ??
    DEFAULT_MODEL_ICON_KEY
  )
})

const dynamicAgentIcon = computed(() => {
  if (!props.modelId) {
    return ''
  }
  return agentStore.agents.find((agent) => agent.id === props.modelId)?.icon ?? ''
})

const useDynamicAcpRegistryIcon = computed(() => {
  const icon = dynamicAgentIcon.value.trim()
  return icon.startsWith('https://cdn.agentclientprotocol.com/registry/') && icon.endsWith('.svg')
})

watch(
  () => [props.modelId, dynamicAgentIcon.value],
  () => {
    iconLoadFailed.value = false
  }
)

const invert = computed(() => {
  if (dynamicAgentIcon.value && !iconLoadFailed.value) {
    return false
  }
  if (!props.isDark) {
    return false
  }
  return isMonoModelIconUrl(modelIcons[iconKey.value])
})

const resolvedIconSrc = computed(() =>
  dynamicAgentIcon.value && !iconLoadFailed.value
    ? dynamicAgentIcon.value
    : modelIcons[iconKey.value]
)

const handleIconError = () => {
  if (dynamicAgentIcon.value) {
    iconLoadFailed.value = true
  }
}
</script>

<template>
  <AcpAgentIcon
    v-if="useDynamicAcpRegistryIcon"
    :agent-id="props.modelId"
    :icon="dynamicAgentIcon"
    :alt="props.modelId"
    :fallback-text="props.modelId"
    :custom-class="customClass"
  />
  <img
    v-else
    :src="resolvedIconSrc"
    :alt="iconKey"
    :class="[customClass, { invert }, invert ? 'opacity-50' : '']"
    @error="handleIconError"
  />
</template>

<style scoped>
.invert {
  filter: invert(1);
}
</style>
