<template>
  <div
    v-if="visible"
    data-testid="guided-onboarding-overlay"
    class="pointer-events-none fixed inset-0 z-70"
  >
    <div
      v-for="(blockerStyle, index) in blockerStyles"
      :key="`blocker-${index}`"
      data-testid="guided-onboarding-blocker"
      class="pointer-events-auto absolute bg-slate-950/22"
      :style="blockerStyle"
      @click.stop.prevent
    />

    <div
      v-if="spotlightStyle"
      data-testid="guided-onboarding-spotlight"
      class="pointer-events-none absolute rounded-3xl border border-primary/70 bg-transparent transition-all duration-200"
      :style="spotlightStyle"
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
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

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

const spotlightStyle = ref<Record<string, string> | null>(null)
const blockerStyles = ref<Array<Record<string, string>>>([])
const panelRef = ref<HTMLElement | null>(null)
const panelStyle = ref<Record<string, string>>({
  top: '24px',
  left: '24px',
  width: 'min(320px, calc(100% - 32px))'
})

const resetLayout = () => {
  spotlightStyle.value = null
  blockerStyles.value = [
    {
      top: '0px',
      left: '0px',
      width: '100vw',
      height: '100vh'
    }
  ]
  panelStyle.value = {
    top: '24px',
    left: '24px',
    width: 'min(320px, calc(100% - 32px))'
  }
}

const updateLayout = async () => {
  await nextTick()

  const targetElement = props.targetEl
  if (!props.visible || !targetElement) {
    resetLayout()
    return
  }

  const targetRect = targetElement.getBoundingClientRect()
  const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0
  if (viewportWidth < 1 || viewportHeight < 1 || targetRect.width < 1 || targetRect.height < 1) {
    resetLayout()
    return
  }

  const padding = 12
  const spotlightTop = Math.max(targetRect.top - padding, 16)
  const spotlightLeft = Math.max(targetRect.left - padding, 16)
  const spotlightWidth = Math.min(
    targetRect.width + padding * 2,
    Math.max(viewportWidth - spotlightLeft - 16, 0)
  )
  const spotlightHeight = Math.min(
    targetRect.height + padding * 2,
    Math.max(viewportHeight - spotlightTop - 16, 0)
  )
  const spotlightRight = spotlightLeft + spotlightWidth
  const spotlightBottom = spotlightTop + spotlightHeight

  blockerStyles.value = [
    {
      top: '0px',
      left: '0px',
      width: `${viewportWidth}px`,
      height: `${Math.max(spotlightTop, 0)}px`
    },
    {
      top: `${spotlightTop}px`,
      left: '0px',
      width: `${Math.max(spotlightLeft, 0)}px`,
      height: `${Math.max(spotlightHeight, 0)}px`
    },
    {
      top: `${spotlightTop}px`,
      left: `${Math.max(spotlightRight, 0)}px`,
      width: `${Math.max(viewportWidth - spotlightRight, 0)}px`,
      height: `${Math.max(spotlightHeight, 0)}px`
    },
    {
      top: `${Math.max(spotlightBottom, 0)}px`,
      left: '0px',
      width: `${viewportWidth}px`,
      height: `${Math.max(viewportHeight - spotlightBottom, 0)}px`
    }
  ].filter((style) => Number.parseFloat(style.width) > 0 && Number.parseFloat(style.height) > 0)

  spotlightStyle.value = {
    top: `${spotlightTop}px`,
    left: `${spotlightLeft}px`,
    width: `${spotlightWidth}px`,
    height: `${spotlightHeight}px`,
    boxShadow: '0 0 0 9999px rgba(15, 23, 42, 0.26)'
  }

  const panelWidth = Math.min(320, Math.max(180, viewportWidth - 32))
  const panelHeightEstimate = Math.max(panelRef.value?.getBoundingClientRect().height ?? 0, 156)
  const desiredTop = spotlightTop + spotlightHeight + 18
  const maxPanelTop = Math.max(16, viewportHeight - panelHeightEstimate - 16)
  const aboveTop = Math.max(16, spotlightTop - panelHeightEstimate - 18)
  const belowTop = Math.min(maxPanelTop, desiredTop)
  const panelTop = (() => {
    if (props.preferredPanelPlacement === 'above') {
      return aboveTop
    }

    if (props.preferredPanelPlacement === 'below') {
      return belowTop
    }

    const placeAbove = desiredTop + panelHeightEstimate > viewportHeight - 16
    return placeAbove ? aboveTop : belowTop
  })()
  const panelLeft = Math.min(
    Math.max(16, spotlightLeft),
    Math.max(16, viewportWidth - panelWidth - 16)
  )

  panelStyle.value = {
    top: `${panelTop}px`,
    left: `${panelLeft}px`,
    width: `${panelWidth}px`
  }
}

onMounted(() => {
  window.addEventListener('resize', updateLayout)
  window.addEventListener('scroll', updateLayout, true)
})

watch(
  () =>
    [
      props.visible,
      props.containerEl,
      props.targetEl,
      props.stepIndex,
      props.totalSteps,
      props.preferredPanelPlacement
    ] as const,
  ([visible]) => {
    if (!visible) {
      resetLayout()
      return
    }

    void updateLayout()
  },
  { flush: 'post', immediate: true }
)

onBeforeUnmount(() => {
  window.removeEventListener('resize', updateLayout)
  window.removeEventListener('scroll', updateLayout, true)
})
</script>

<style scoped>
.guided-onboarding-panel,
.guided-onboarding-panel * {
  -webkit-app-region: no-drag;
}
</style>
