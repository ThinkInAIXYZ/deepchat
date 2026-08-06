# 001 — Add press feedback to DcButton

- **Status**: DONE
- **Commit**: aefcb11cd
- **Severity**: HIGH
- **Category**: Physicality & origin
- **Estimated scope**: 1 file (class string), no logic changes

## Problem

Every button in the app is built from `DcButton` (`src/dc-ui/components/button`), but the shared
variant base only transitions colors — there is **no press feedback**. Pressing any button gives no
tactile/visual confirmation, which makes the whole app feel flat. Per the audit playbook, press
feedback belongs on every pressable: `transform: scale(0.97)` on `:active`, subtle (0.95–0.98),
with a fast transition.

Current code (`src/dc-ui/components/button/index.ts:7`):

```ts
export const dcButtonVariants = cva(
  'inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*="size-"])]:size-4 [&_svg]:shrink-0 shrink-0 outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]',
  { /* variants unchanged */ }
)
```

## Target

Scale the button to 0.97 while pressed, using the repo's motion tokens (140ms + soft ease). Do NOT
use `transition-colors` anymore — it would omit the native `scale` transition, so the property
list must be explicit:

```ts
'inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-[color,background-color,border-color,scale] duration-[var(--dc-motion-fast)] ease-[var(--dc-ease-out-soft)] active:scale-[0.97] motion-reduce:active:scale-100 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*="size-"])]:size-4 [&_svg]:shrink-0 shrink-0 outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]'
```

- `transition-[color,background-color,border-color,scale]` — hover color changes (all variants)
  AND the press scale animate together, using the native `scale` property plus paint (colors).
- `active:scale-[0.97]` — the press effect; 0.97 is inside the playbook's 0.95–0.98 band.
- `motion-reduce:active:scale-100` — under `prefers-reduced-motion`, keep color feedback, drop the
  positional press (playbook §6: reduced motion means fewer/gentler, drop movement keep feedback).
- `disabled:pointer-events-none` already prevents `:active` on disabled buttons — unchanged.

## Repo conventions to follow

- Motion tokens live in `src/renderer/src/assets/style.css`: `--dc-motion-fast: 140ms`,
  `--dc-ease-out-soft: cubic-bezier(0.22, 1, 0.36, 1)`. Use the Tailwind arbitrary-value syntax
  `duration-[var(--dc-motion-fast)] ease-[var(--dc-ease-out-soft)]`.
- Exemplar of the exact token pattern:
  `src/renderer/src/components/message/MessageToolbar.vue:5` uses
  `transition-opacity duration-[var(--dc-motion-fast)] ease-[var(--dc-ease-out-soft)]`.
- Exemplar of `motion-reduce:transition-none`:
  `src/renderer/src/components/message/MessageBlockToolCall.vue:64`.

## Steps

1. Open `src/dc-ui/components/button/index.ts:7`.
2. Replace `transition-colors` with
   `transition-[color,background-color,border-color,scale] duration-[var(--dc-motion-fast)] ease-[var(--dc-ease-out-soft)] active:scale-[0.97] motion-reduce:active:scale-100`.
   Keep every other class in the base string byte-for-byte. Do not touch the `variants` block.

## Boundaries

- Do NOT touch `src/dc-ui/components/button/DcButton.vue` (tooltip/wrapper logic).
- Do NOT add per-variant press styles — one uniform press for all variants/sizes.
- Do NOT change any color tokens or shadcn source.

## Verification

- **Mechanical**: `pnpm run typecheck` and `pnpm exec vitest run test/renderer/components/chat/ChatTopBar.test.ts test/renderer/components/DashboardSettings.test.ts`
  (DcButton consumers) must pass. `pnpm exec oxfmt --check src/dc-ui/components/button/index.ts` clean.
- **Feel check**: in the running app (DevTools, Animations panel at 10% playback):
  - Mouse-down on a primary button: it scales to 97% within ~14ms of press; mouse-up returns to 100%.
  - A ghost/icon button in the chat toolbar behaves identically.
  - With `prefers-reduced-motion: reduce` (Rendering panel), pressing still darkens/colors but the
    button no longer shrinks.
- **Done when**: every variant (`default`, `outline`, `ghost`, `secondary`, `destructive`, `link`,
  `icon*`) shrinks to 0.97 on `:active` and springs back on release without any layout shift.
