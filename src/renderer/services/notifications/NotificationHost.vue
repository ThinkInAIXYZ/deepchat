<script setup lang="ts">
import type { CSSProperties } from 'vue'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Toaster } from 'vue-sonner'
import 'vue-sonner/style.css'

const props = defineProps<{
  surface: 'main' | 'settings'
  theme: 'light' | 'dark' | 'system'
  dir: 'ltr' | 'rtl' | 'auto'
}>()

const { t } = useI18n()
const topOffset = computed(() => (props.surface === 'main' ? 96 : 52))
const offset = computed(() => ({
  top: topOffset.value,
  right: 16,
  left: 16
}))

const toasterStyle: CSSProperties & Record<`--${string}`, string> = {
  '--width': 'min(356px, calc(100vw - 32px))',
  '--normal-bg': 'var(--popover)',
  '--normal-text': 'var(--popover-foreground)',
  '--normal-border': 'var(--border)',
  '--success-bg': 'var(--dc-notification-success-bg)',
  '--success-text': 'var(--dc-notification-success-text)',
  '--success-border': 'var(--dc-notification-success-border)',
  '--info-bg': 'var(--dc-notification-info-bg)',
  '--info-text': 'var(--dc-notification-info-text)',
  '--info-border': 'var(--dc-notification-info-border)',
  '--warning-bg': 'var(--dc-notification-warning-bg)',
  '--warning-text': 'var(--dc-notification-warning-text)',
  '--warning-border': 'var(--dc-notification-warning-border)',
  '--error-bg': 'var(--dc-notification-error-bg)',
  '--error-text': 'var(--dc-notification-error-text)',
  '--error-border': 'var(--dc-notification-error-border)',
  zIndex: 'var(--dc-z-toast)'
}
</script>

<template>
  <Toaster
    class="deepchat-notification-host"
    :theme="theme"
    :dir="dir"
    position="top-right"
    :offset="offset"
    :mobile-offset="offset"
    :visible-toasts="2"
    :expand="true"
    :gap="10"
    :rich-colors="true"
    :close-button="false"
    :container-aria-label="t('common.notifications.label')"
    :style="toasterStyle"
  />
</template>

<style scoped>
:deep([data-sonner-toaster]) {
  font-family: var(--dc-font-family);
}

:deep([data-sonner-toast][data-styled='true']) {
  min-height: 54px;
  padding: 12px 14px;
  border-radius: 10px;
  box-shadow: 0 8px 24px hsl(0 0% 0% / 0.12);
}

:deep([data-sonner-toast][data-styled='true'] [data-title]) {
  overflow: hidden;
  font-size: 13px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

:deep([data-sonner-toast][data-styled='true'] [data-description]) {
  display: -webkit-box;
  overflow: hidden;
  font-size: 12px;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}
</style>
