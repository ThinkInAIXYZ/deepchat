<template>
  <div
    v-if="visible"
    data-testid="guided-onboarding-overlay"
    class="pointer-events-none fixed inset-0 z-70"
  >
    <OnBoardingSpotlight
      :path-d="pathD"
      :cutout-path-d="cutoutPathD"
      :viewport-width="viewportWidth"
      :viewport-height="viewportHeight"
    />

    <div
      ref="panelRef"
      class="guided-onboarding-panel pointer-events-auto absolute rounded-2xl border border-border/80 bg-background/96 p-4 shadow-2xl backdrop-blur"
      :style="panelStyle"
    >
      <div class="flex items-center justify-between gap-3">
        <p class="text-[11px] uppercase tracking-[0.18em] text-primary/80">
          {{ eyebrow }}
        </p>
        <span
          class="rounded-full border border-border/70 bg-muted/80 px-2 py-0.5 text-[11px] text-muted-foreground"
        >
          {{ stepIndex }}/{{ totalSteps }}
        </span>
      </div>

      <h2 class="mt-3 text-sm font-semibold text-foreground">
        {{ title }}
      </h2>
      <p class="mt-2 text-xs leading-5 text-muted-foreground">
        {{ description }}
      </p>

      <div class="mt-4 flex flex-wrap items-start justify-between gap-3">
        <div class="flex max-w-full flex-wrap items-center gap-2">
          <button
            v-if="backLabel"
            type="button"
            class="whitespace-nowrap rounded-lg border border-border/80 px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground disabled:cursor-not-allowed disabled:text-muted-foreground/50"
            :disabled="backDisabled"
            @click="$emit('back')"
          >
            {{ backLabel }}
          </button>

          <button
            v-if="secondaryLabel"
            type="button"
            class="whitespace-nowrap rounded-lg border border-border/80 px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground disabled:cursor-not-allowed disabled:text-muted-foreground/50"
            :disabled="secondaryDisabled"
            @click="$emit('secondary')"
          >
            {{ secondaryLabel }}
          </button>
        </div>

        <div class="flex max-w-full flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            class="whitespace-nowrap rounded-lg border border-border/80 px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
            @click="$emit('close')"
          >
            {{ closeLabel }}
          </button>

          <button
            v-if="expertLabel"
            type="button"
            class="whitespace-nowrap rounded-lg border border-border/80 px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground disabled:cursor-not-allowed disabled:text-muted-foreground/50"
            :disabled="expertDisabled"
            @click="$emit('expert')"
          >
            {{ expertLabel }}
          </button>

          <button
            v-if="primaryLabel"
            type="button"
            class="whitespace-nowrap rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            :disabled="primaryDisabled"
            @click="$emit('primary')"
          >
            {{ primaryLabel }}
          </button>
        </div>
      </div>

      <div v-if="caption" class="mt-3 text-[11px] text-muted-foreground/80">
        {{ caption }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useElementBounding } from '@vueuse/core'
import OnBoardingSpotlight from './OnBoardingSpotlight.vue'
import { useOnBoarding } from '@/composables/useOnBoarding'

type GuidedOnboardingPanelPlacement = 'auto' | 'above' | 'below'

const props = withDefaults(
  defineProps<{
    visible: boolean
    containerEl: HTMLElement | null
    targetEl: HTMLElement | null
    eyebrow: string
    title: string
    description: string
    stepIndex: number
    totalSteps: number
    closeLabel: string
    backLabel?: string
    primaryLabel?: string
    secondaryLabel?: string
    expertLabel?: string
    caption?: string
    backDisabled?: boolean
    primaryDisabled?: boolean
    secondaryDisabled?: boolean
    expertDisabled?: boolean
    preferredPanelPlacement?: GuidedOnboardingPanelPlacement
  }>(),
  {
    containerEl: null,
    targetEl: null,
    backLabel: undefined,
    primaryLabel: undefined,
    secondaryLabel: undefined,
    expertLabel: undefined,
    caption: undefined,
    backDisabled: false,
    primaryDisabled: false,
    secondaryDisabled: false,
    expertDisabled: false,
    preferredPanelPlacement: 'auto'
  }
)

defineEmits<{
  close: []
  back: []
  primary: []
  secondary: []
  expert: []
}>()

const PANEL_MIN_HEIGHT = 156
const panelRef = ref<HTMLElement | null>(null)

const { spotlightRect, viewportWidth, viewportHeight, pathD, cutoutPathD } = useOnBoarding(
  () => props.targetEl,
  { visible: () => props.visible }
)

const { height: panelActualHeight } = useElementBounding(panelRef)

const panelStyle = computed(() => {
  const rect = spotlightRect.value
  if (!rect) {
    return {
      top: '24px',
      left: '24px',
      width: 'min(320px, calc(100% - 32px))'
    }
  }

  const panelWidth = Math.min(320, Math.max(180, viewportWidth.value - 32))
  const panelHeightEstimate = Math.max(panelActualHeight.value, PANEL_MIN_HEIGHT)
  const desiredTop = rect.y + rect.height + 18
  const maxPanelTop = Math.max(16, viewportHeight.value - panelHeightEstimate - 16)
  const aboveTop = Math.max(16, rect.y - panelHeightEstimate - 18)
  const belowTop = Math.min(maxPanelTop, desiredTop)

  const panelTop = (() => {
    if (props.preferredPanelPlacement === 'above') return aboveTop
    if (props.preferredPanelPlacement === 'below') return belowTop
    const placeAbove = desiredTop + panelHeightEstimate > viewportHeight.value - 16
    return placeAbove ? aboveTop : belowTop
  })()

  const panelLeft = Math.min(
    Math.max(16, rect.x),
    Math.max(16, viewportWidth.value - panelWidth - 16)
  )

  return {
    top: `${panelTop}px`,
    left: `${panelLeft}px`,
    width: `${panelWidth}px`
  }
})
</script>

<style scoped>
.guided-onboarding-panel,
.guided-onboarding-panel * {
  -webkit-app-region: no-drag;
}
</style>
