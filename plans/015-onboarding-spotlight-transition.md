# 015 — Fade the onboarding spotlight between guide steps (opportunity)

- **Status**: DONE
- **Commit**: aefcb11cd
- **Severity**: LOW (opportunity)
- **Category**: Missed opportunities
- **Estimated scope**: 2 files, scoped CSS + one keyed wrapper

## Problem

First-run onboarding is the product's one rare, high-emotion moment — and its spotlight cutout
`pathD`/`cutoutPathD` swap instantly between steps while the coachmark panel teleports between
`top`/`left` targets. The playbook's delight budget (rare/first-time moments) is completely
unused. A pure crossfade is safe because SVG paths with different shapes **cannot** be tweened
(`d` interpolation only works between structurally identical paths) — so this plan animates
opacity, never geometry.

Current code (`src/renderer/src/components/onboarding/OnBoardingSpotlight.vue:9-26`):

```html
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
```

The coachmark panel lives in `src/renderer/src/pages/WelcomePage.vue` (~lines 401-434), where the
guide step recomputes the panel's `top`/`left` per step.

## Target

Two tokenized fades, both opacity-only:

1. **Cutout**: key the border path by `cutoutPathD` inside a `<Transition name="spotlight-cutout" mode="out-in">`:

```html
<Transition name="spotlight-cutout" mode="out-in">
  <path
    v-if="cutoutPathD"
    :key="cutoutPathD"
    data-testid="onboarding-spotlight-border"
    :d="cutoutPathD"
    fill="none"
    :stroke="borderColor"
    :stroke-width="borderWidth"
  />
</Transition>
```

```css
.spotlight-cutout-enter-active,
.spotlight-cutout-leave-active {
  transition: opacity var(--dc-motion-fast) var(--dc-ease-out-soft);
}

.spotlight-cutout-enter-from,
.spotlight-cutout-leave-to {
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .spotlight-cutout-enter-active,
  .spotlight-cutout-leave-active {
    transition: none;
  }
}
```

Only the **border** path crossfades — the dim fill (`pathD`) must stay mounted and static so the
background never flashes through the overlay during `out-in`.

2. **Coachmark panel** (WelcomePage): wrap the panel's content in
`<Transition name="spotlight-panel" mode="out-in">` keyed by the active step id, with the same
CSS values (opacity only, `--dc-motion-fast` + `--dc-ease-out-soft`, reduced-motion block). The
panel's `top`/`left` positioning stays instant (do NOT transition layout properties).

## Repo conventions to follow

- `mode="out-in"` Transition precedent: `src/renderer/settings/components/control-center/UsageNostalgiaCard.vue:8`.
- Token + reduced-motion pattern: `src/renderer/src/components/message/MessageInfo.vue:42-52`.

## Steps

1. In `OnBoardingSpotlight.vue`, wrap the border path in the keyed `Transition` above; add the
   scoped CSS.
2. In `WelcomePage.vue`, find the coachmark panel (keyed render per step around lines 401-434)
   and wrap its content in a `spotlight-panel` `Transition` with the same CSS.
3. Add both reduced-motion blocks.

## Boundaries

- Do NOT attempt `d`-attribute tweening or clip-path interpolation between different shapes.
- Do NOT animate `top`/`left` of the panel (layout).
- Do NOT touch the cutout math, spotlight dimensions, or step logic.

## Verification

- **Mechanical**: `pnpm exec vitest run test/renderer/components/NewThreadPage.onboarding.test.ts`
  must pass (onboarding flow tests); `pnpm run typecheck`.
- **Feel check**: walk the onboarding guide through its steps:
  - The highlight border fades to the new position in 140ms; the dim layer never flickers to
    transparent.
  - The coachmark text fades in/out per step, positioned at the new target instantly.
  - Toggle `prefers-reduced-motion: reduce`: all fades become instant.
- **Done when**: step changes feel connected (no hard cut on the border or panel), and no
  geometry animates.
