<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
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
const iconLoaded = ref(false)
const imgRef = ref<HTMLImageElement | null>(null)

const syncCachedIconLoad = async () => {
  await nextTick()
  const img = imgRef.value
  if (img?.complete && img.naturalWidth > 0) {
    iconLoaded.value = true
  }
}

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

watch(
  () => [props.modelId, dynamicAgentIcon.value] as const,
  () => {
    iconLoadFailed.value = false
    iconLoaded.value = false
    void syncCachedIconLoad()
  },
  { immediate: true }
)

const handleIconError = () => {
  if (dynamicAgentIcon.value) {
    iconLoadFailed.value = true
  }
  iconLoaded.value = true
}

const handleIconLoad = () => {
  iconLoaded.value = true
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
  <span
    v-else
    class="model-icon-shell relative inline-flex shrink-0 items-center justify-center overflow-hidden"
    :class="customClass"
  >
    <span
      v-if="!iconLoaded"
      class="model-icon-skeleton absolute inset-0 rounded-sm bg-muted/70"
      aria-hidden="true"
    />
    <img
      ref="imgRef"
      :src="resolvedIconSrc"
      :alt="iconKey"
      :class="[
        'size-full object-contain',
        { invert },
        invert
          ? iconLoaded
            ? 'opacity-50'
            : 'opacity-0'
          : iconLoaded
            ? 'opacity-100'
            : 'opacity-0'
      ]"
      decoding="async"
      @load="handleIconLoad"
      @error="handleIconError"
    />
  </span>
</template>

<style scoped>
.invert {
  filter: invert(1);
}
</style>
