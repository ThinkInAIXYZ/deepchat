<script setup lang="ts">
import { computed, useSlots } from 'vue'
import { Icon } from '@iconify/vue'
import { Primitive } from 'reka-ui'
import { cn } from '@shadcn/lib/utils'
import { Spinner } from '@shadcn/components/ui/spinner'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from '@shadcn/components/ui/tooltip'
import { dcButtonVariants, DcButtonProps } from './props'

const props = withDefaults(defineProps<DcButtonProps>(), {
  as: 'button',
  iconSize: '4',
  disabled: false,
  active: false,
  tooltipSideOffset: 4,
  // The original DcButton tooltip rendered immediately; retain that default.
  tooltipDelayDuration: 0,
  tooltipIgnoreNonKeyboardFocus: true
})

defineOptions({
  inheritAttrs: false
})

const slots = useSlots()

const iconSizeClass = computed(
  () => ({ '3': 'size-3', '3.5': 'size-3.5', '4': 'size-4' })[props.iconSize]
)

const accessibleName = computed(() => props.label ?? props.tooltip ?? '')

const isIconOnly = computed(() =>
  ['icon', 'icon-sm', 'icon-xs', 'icon-lg'].includes(props.size ?? 'default')
)

const buttonClass = computed(() =>
  cn(
    dcButtonVariants({ variant: props.variant, size: props.size }),
    isIconOnly.value &&
      (props.variant ?? 'default') === 'ghost' &&
      'text-muted-foreground hover:text-foreground',
    props.active && 'text-primary',
    props.class
  )
)

if (import.meta.env.DEV && !accessibleName.value && isIconOnly.value && !slots.default) {
  console.warn('[DcButton] icon-only button requires `label` or `tooltip` for accessibility')
}
</script>

<template>
  <TooltipProvider :delay-duration="200">
    <Tooltip
      v-if="tooltip"
      :delay-duration="tooltipDelayDuration"
      :ignore-non-keyboard-focus="tooltipIgnoreNonKeyboardFocus"
    >
      <TooltipTrigger as-child>
        <Primitive
          data-slot="dc-button"
          v-bind="$attrs"
          :as="as"
          :as-child="asChild"
          :disabled="disabled"
          :aria-label="accessibleName || undefined"
          :class="buttonClass"
        >
          <Spinner v-if="loading" data-icon="inline-start" :class="iconSizeClass" />
          <Icon v-else-if="icon" :key="icon" :icon="icon" :class="cn(iconSizeClass, iconClass)" />
          <slot />
        </Primitive>
      </TooltipTrigger>
      <TooltipContent
        :side="tooltipSide"
        :side-offset="tooltipSideOffset"
        :class="tooltipContentClass"
      >
        {{ tooltip }}
      </TooltipContent>
    </Tooltip>
    <Primitive
      v-else
      data-slot="dc-button"
      v-bind="$attrs"
      :as="as"
      :as-child="asChild"
      :disabled="disabled"
      :aria-label="accessibleName || undefined"
      :class="buttonClass"
    >
      <Spinner v-if="loading" data-icon="inline-start" :class="iconSizeClass" />
      <Icon v-else-if="icon" :key="icon" :icon="icon" :class="cn(iconSizeClass, iconClass)" />
      <slot />
    </Primitive>
  </TooltipProvider>
</template>
