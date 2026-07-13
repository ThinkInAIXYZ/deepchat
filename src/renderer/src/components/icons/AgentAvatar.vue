<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Icon } from '@iconify/vue'
import { getActivePinia } from 'pinia'
import type { UIAgent } from '@/stores/ui/agent'
import { useThemeStore } from '@/stores/theme'
import { ensureIconAvailable } from '@/lib/iconLoader'
import AcpAgentIcon from './AcpAgentIcon.vue'
import deepchatLogo from '@/assets/logo.png?url'

const props = withDefaults(
  defineProps<{
    agent: Pick<UIAgent, 'id' | 'name' | 'type' | 'icon' | 'avatar'>
    className?: string
    fallbackClassName?: string
    theme?: 'dark' | 'light'
  }>(),
  {
    className: 'h-4 w-4',
    fallbackClassName: 'rounded-md'
  }
)

const activePinia = getActivePinia()
const themeStore = activePinia ? useThemeStore(activePinia) : null
const lucideIconVersion = ref(0)

const isDarkTheme = computed(() => {
  if (props.theme) {
    return props.theme === 'dark'
  }

  return Boolean(themeStore?.isDark)
})

const initials = computed(() => {
  const name = props.agent.name.trim()
  if (!name) {
    return '?'
  }

  const latin = name.match(/[A-Za-z]/g)
  if (latin && latin.length > 0) {
    return latin.slice(0, 2).join('').toUpperCase()
  }

  return name.slice(0, 1)
})

const monogramBackground = computed(
  () => props.agent.avatar?.kind === 'monogram' && props.agent.avatar.backgroundColor
)

const lucideColor = computed(() => {
  if (props.agent.avatar?.kind !== 'lucide') {
    return undefined
  }
  return isDarkTheme.value ? props.agent.avatar.darkColor : props.agent.avatar.lightColor
})

const showBuiltinDeepChatLogo = computed(
  () =>
    props.agent.id === 'deepchat' &&
    props.agent.type === 'deepchat' &&
    !props.agent.avatar &&
    !props.agent.icon
)

const showAcpIcon = computed(() => props.agent.type === 'acp' && Boolean(props.agent.icon?.trim()))

const showImageIcon = computed(
  () =>
    Boolean(props.agent.icon?.trim()) &&
    !showBuiltinDeepChatLogo.value &&
    !showAcpIcon.value &&
    props.agent.avatar?.kind !== 'lucide'
)

watch(
  () => (props.agent.avatar?.kind === 'lucide' ? props.agent.avatar.icon.trim() : ''),
  async (iconName) => {
    if (!iconName) {
      return
    }

    try {
      await ensureIconAvailable(`lucide:${iconName}`)
      lucideIconVersion.value += 1
    } catch (error) {
      console.warn(`[AgentAvatar] Failed to load lucide icon "${iconName}":`, error)
    }
  },
  { immediate: true }
)
</script>

<template>
  <AcpAgentIcon
    v-if="showAcpIcon"
    :agent-id="agent.id"
    :icon="agent.icon"
    :alt="agent.name"
    :fallback-text="agent.name"
    :custom-class="className"
  />
  <img
    v-else-if="showBuiltinDeepChatLogo || showImageIcon"
    :src="showBuiltinDeepChatLogo ? deepchatLogo : agent.icon"
    :alt="agent.name"
    :class="['object-contain', className]"
  />
  <span
    v-else-if="agent.avatar?.kind === 'lucide'"
    :class="[
      'inline-flex items-center justify-center text-foreground',
      className,
      fallbackClassName
    ]"
    :style="lucideColor ? { color: lucideColor } : undefined"
  >
    <Icon
      :key="`${agent.avatar.icon}-${lucideIconVersion}`"
      :icon="`lucide:${agent.avatar.icon}`"
      class="h-full w-full"
    />
  </span>
  <span
    v-else
    :class="[
      'inline-flex items-center justify-center bg-muted/70 text-[0.72em] font-semibold text-foreground',
      className,
      fallbackClassName
    ]"
    :style="monogramBackground ? { backgroundColor: monogramBackground } : undefined"
  >
    {{ agent.avatar?.kind === 'monogram' ? agent.avatar.text : initials }}
  </span>
</template>
