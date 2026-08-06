# 011 — Replace splash core-flare scale(0) with scale(0.3)

- **Status**: DONE
- **Commit**: aefcb11cd
- **Severity**: LOW
- **Category**: Physicality & origin
- **Estimated scope**: 1 file, 2 transform values

## Problem

The splash screen's `core-flare` particle animates from `scale(0)` — nothing in the real world
appears from nothing. The playbook bans `scale(0)` outright; the target range is 0.9–0.97 for
popups, and even decorative particles should start from a visible size with opacity 0 doing the
"from nothing" work.

Current code (`src/renderer/splash/loading.vue`):

```css
/* :393-397 — resting class */
  box-shadow:
    0 0 10px 3px rgb(103 221 255 / 90%),
    0 0 30px 9px rgb(25 126 255 / 46%);
  transform: scale(0);
}
```

```css
/* :802-815 — keyframes */
@keyframes core-flare {
  0% {
    opacity: 0;
    transform: scale(0);
  }
  42% {
    opacity: 1;
    transform: scale(1.8);
  }
  100% {
    opacity: 0;
    transform: scale(0.68);
  }
}
```

## Target

Start at scale(0.3) — small but real; opacity 0 handles the "not yet visible" state:

```css
/* resting class (:397) */
  transform: scale(0.3);
```

```css
@keyframes core-flare {
  0% {
    opacity: 0;
    transform: scale(0.3);
  }
  42% {
    opacity: 1;
    transform: scale(1.8);
  }
  100% {
    opacity: 0;
    transform: scale(0.68);
  }
}
```

Check whether the resting class also carries an `opacity: 0`; if it does not and the element is
visible before the animation starts, add `opacity: 0` to the resting class so the pre-animation
state stays invisible (the animation's 0% frame already starts at opacity 0).

## Repo conventions to follow

- Splash motion is self-contained in `src/renderer/splash/loading.vue`; the file already has a
  `prefers-reduced-motion` block at ~line 1066 — leave it untouched.

## Steps

1. `loading.vue:397` — `transform: scale(0);` → `transform: scale(0.3);`.
2. `loading.vue:805` — `transform: scale(0);` → `transform: scale(0.3);`.
3. If the resting class has no `opacity: 0`, add it (the element must not show a 0.3-size dot
   before the animation's 0% frame applies).

## Boundaries

- Do NOT touch the `42%`/`100%` keyframe stops, colors, box-shadow, or durations.
- Do NOT touch any other splash animation (speed-scan, etc.).

## Verification

- **Mechanical**: no test suite covers the splash (boot-only visual); verify with
  `pnpm run typecheck` and a dev boot (`pnpm run dev`) showing the splash.
- **Feel check**: watch the splash at 10% playback:
  - The flare particle starts as a small but solid dot and blooms to 1.8 — it never pops from
    zero size.
- **Done when**: `rg -n "scale\(0\)" src/renderer/splash/loading.vue` returns nothing.
