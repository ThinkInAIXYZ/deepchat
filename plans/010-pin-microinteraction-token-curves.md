# 010 — Consolidate pin micro-interaction curves onto motion tokens

- **Status**: DONE
- **Commit**: aefcb11cd
- **Severity**: MEDIUM
- **Category**: Cohesion & tokens
- **Estimated scope**: 2 files, easing strings only

## Problem

Seven hand-typed cubic-bezier curves power the session pin/unpin micro-interactions — five in
`WindowSideBarSessionItem.vue` and two in `WindowSideBar.vue` — none referencing the shared
`--dc-ease-*` tokens. Three of them are within 0.06 of each other. Playbook §7: curves belong in
shared tokens; near-duplicate hand-typed curves are a consolidation finding.

Current code (`src/renderer/src/components/WindowSideBarSessionItem.vue`):

```css
/* :276 */
.session-item[data-pin-fx='pinning']::after {
  animation: session-item-pin-glow 420ms cubic-bezier(0.24, 0.84, 0.24, 1);
}
/* :280 */
.session-item[data-pin-fx='unpinning']::after {
  animation: session-item-unpin-glow 360ms cubic-bezier(0.28, 0.11, 0.32, 1);
}
/* :417 / :421 */
animation: pin-button-bloom 560ms cubic-bezier(0.18, 0.88, 0.24, 1);
animation: pin-icon-twist-in 560ms cubic-bezier(0.18, 0.88, 0.24, 1);
/* :425 / :429 */
animation: pin-button-release 460ms cubic-bezier(0.3, 0.07, 0.34, 1);
animation: pin-icon-twist-out 460ms cubic-bezier(0.3, 0.07, 0.34, 1);
```

`src/renderer/src/components/WindowSideBar.vue:1785,1789`:

```ts
easing: 'cubic-bezier(0.18, 0.92, 0.22, 1)'   // nextPinned
easing: 'cubic-bezier(0.24, 0.84, 0.28, 1)'   // !nextPinned
```

## Target

Map every curve to the nearest shared token (values from `src/renderer/src/assets/style.css:125-126`):

- `--dc-ease-out-express: cubic-bezier(0.16, 1, 0.3, 1)` — for the quick glow/snap curves
  (0.24,0.84,0.24,1 / 0.28,0.11,0.32,1 / 0.18,0.92,0.22,1 / 0.24,0.84,0.28,1).
- `--dc-ease-out-soft: cubic-bezier(0.22, 1, 0.36, 1)` — for the longer decorative bloom/release
  curves (0.18,0.88,0.24,1 / 0.3,0.07,0.34,1).

Durations stay exactly as tuned (420/360/560/460ms — these are deliberate one-shot decorative
moments; the playbook's <300ms rule targets UI feedback, and these are rare delights on a pin
toggle, so durations are out of scope).

CSS target:

```css
/* :276 */
.session-item[data-pin-fx='pinning']::after {
  animation: session-item-pin-glow 420ms var(--dc-ease-out-express);
}
/* :280 */
.session-item[data-pin-fx='unpinning']::after {
  animation: session-item-unpin-glow 360ms var(--dc-ease-out-express);
}
/* :417 / :421 */
animation: pin-button-bloom 560ms var(--dc-ease-out-soft);
animation: pin-icon-twist-in 560ms var(--dc-ease-out-soft);
/* :425 / :429 */
animation: pin-button-release 460ms var(--dc-ease-out-express);
animation: pin-icon-twist-out 460ms var(--dc-ease-out-express);
```

TS target:

```ts
easing: 'cubic-bezier(0.22, 1, 0.36, 1)'   // == var(--dc-ease-out-soft)
easing: 'cubic-bezier(0.16, 1, 0.3, 1)'    // == var(--dc-ease-out-express)
```

(WAAPI `easing` takes a raw string; inline the token *values* — the app already does this nowhere
else, and WAAPI cannot read CSS vars.)

## Repo conventions to follow

- Token definitions: `src/renderer/src/assets/style.css:125-126`.
- Example of the token-consumption style in the same file family:
  `src/renderer/src/components/WindowSideBar.vue:142`.

## Steps

1. `WindowSideBarSessionItem.vue:276` → `var(--dc-ease-out-express)`.
2. `WindowSideBarSessionItem.vue:280` → `var(--dc-ease-out-express)`.
3. `WindowSideBarSessionItem.vue:417,421` → `var(--dc-ease-out-soft)`.
4. `WindowSideBarSessionItem.vue:425,429` → `var(--dc-ease-out-express)`.
5. `WindowSideBar.vue:1785` → `'cubic-bezier(0.22, 1, 0.36, 1)'`.
6. `WindowSideBar.vue:1789` → `'cubic-bezier(0.16, 1, 0.3, 1)'`.

## Boundaries

- Do NOT change any duration (420/360/560/460ms stay).
- Do NOT touch the keyframe bodies, glow colors, or the WAAPI flight keyframe offsets.
- Do NOT add new tokens to style.css — reuse the two existing ones.

## Verification

- **Mechanical**: `pnpm exec vitest run test/renderer/components/WindowSideBar.test.ts` must pass
  (pin-flight tests exercise these paths); `pnpm exec oxfmt --check` clean.
- **Feel check**: pin and unpin a session several times:
  - The glow/bloom/release feel identical to before (durations untouched); no curve change is
    perceptible by eye.
  - `rg -n "cubic-bezier" src/renderer/src/components/WindowSideBarSessionItem.vue
    src/renderer/src/components/WindowSideBar.vue` now returns only `var(--dc-ease-*)` references
    (CSS) and the two inline WAAPI values.
- **Done when**: no hand-typed cubic-bezier remains in these two files except the two WAAPI
  strings, which match the token values exactly.
