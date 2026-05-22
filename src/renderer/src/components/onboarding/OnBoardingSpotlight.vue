<template>
  <svg
    class="onboarding-spotlight-svg"
    :viewBox="`0 0 ${viewportWidth} ${viewportHeight}`"
    preserveAspectRatio="xMinYMin slice"
    aria-hidden="true"
    focusable="false"
  >
    <path
      v-if="cutoutPathD"
      data-testid="onboarding-spotlight-path"
      :d="pathD"
      :fill="fillColor"
      :fill-opacity="fillOpacity"
      fill-rule="evenodd"
      @click.stop.prevent="$emit('dimClick')"
    />
    <path
      v-if="cutoutPathD"
      data-testid="onboarding-spotlight-border"
      :d="cutoutPathD"
      fill="none"
      :stroke="borderColor"
      :stroke-width="borderWidth"
    />
  </svg>
</template>

<script setup lang="ts">
withDefaults(
  defineProps<{
    pathD: string
    cutoutPathD?: string
    viewportWidth: number
    viewportHeight: number
    fillColor?: string
    fillOpacity?: number
    borderColor?: string
    borderWidth?: number
  }>(),
  {
    cutoutPathD: '',
    fillColor: 'rgb(15, 23, 42)',
    fillOpacity: 0.42,
    borderColor: 'color-mix(in srgb, var(--primary) 70%, transparent)',
    borderWidth: 1
  }
)

defineEmits<{
  dimClick: []
}>()
</script>

<style scoped>
/* Single SVG element with evenodd-filled path — driver.js technique.
   The dim path catches clicks on the dim area; the cutout has no fill so
   clicks fall through naturally to the highlighted target. The optional
   border path renders inside the same SVG so it paints in lockstep with
   the dim — no inter-element lag during resize. */
.onboarding-spotlight-svg {
  position: fixed;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}

.onboarding-spotlight-svg path[data-testid='onboarding-spotlight-path'] {
  pointer-events: auto;
  cursor: auto;
}
</style>
