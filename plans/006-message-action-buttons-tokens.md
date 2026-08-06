# 006 — Tokenize MessageActionButtons transitions

- **Status**: DONE
- **Commit**: aefcb11cd
- **Severity**: MEDIUM
- **Category**: Easing & duration / Performance
- **Estimated scope**: 1 file, template classes + scoped CSS

## Problem

The message-hover action stack (workspace / new-chat / scroll buttons that appear on every
message hover) uses hardcoded 300ms `ease` values and `transition-all`:

- `transition-all` on enter/leave animates every animatable property, not just what changes
  (`transition-all` is always a playbook finding).
- `0.3s ease` is at the 300ms ceiling for a hover-frequency element (playbook: hover 100–160ms)
  and uses the weak built-in `ease` curve instead of the repo tokens.

Current code (`src/renderer/src/components/message/MessageActionButtons.vue`):

```html
enter-active-class="transition-all duration-[var(--dc-motion-default)] ease-[var(--dc-ease-out-express)]"
...
leave-active-class="transition-all duration-[var(--dc-motion-default)] ease-[var(--dc-ease-out-express)]"
```

```css
.message-actions-move {
  transition: transform 0.3s ease;
}

/* 当元素离开时切换到这个 class，由 CSS 控制定位与过渡 */
.message-action-leaving {
  position: absolute;
  width: var(--leave-w);
  height: var(--leave-h);
  left: var(--leave-l);
  top: var(--leave-t);
  pointer-events: none;
  /* 控制离场的属性过渡（和 template 中的 leave-* class 一起工作） */
  transition:
    opacity 0.3s ease,
    transform 0.3s ease;
}
```

## Target

Only `opacity` and `transform` animate, using tokens everywhere:

Template (lines 5 and 8):

```html
enter-active-class="transition-[opacity,transform] duration-[var(--dc-motion-default)] ease-[var(--dc-ease-out-express)]"
```

```html
leave-active-class="transition-[opacity,transform] duration-[var(--dc-motion-default)] ease-[var(--dc-ease-out-express)]"
```

Scoped CSS:

```css
.message-actions-move {
  transition: transform var(--dc-motion-default) var(--dc-ease-out-express);
}

/* 当元素离开时切换到这个 class，由 CSS 控制定位与过渡 */
.message-action-leaving {
  position: absolute;
  width: var(--leave-w);
  height: var(--leave-h);
  left: var(--leave-l);
  top: var(--leave-t);
  pointer-events: none;
  /* 控制离场的属性过渡（和 template 中的 leave-* class 一起工作） */
  transition:
    opacity var(--dc-motion-default) var(--dc-ease-out-express),
    transform var(--dc-motion-default) var(--dc-ease-out-express);
}
```

Note: the enter/leave already used `--dc-motion-default` (220ms) — that stays. The fix removes
`transition-all` and replaces the bare `0.3s ease` with the 220ms token + express curve.

## Repo conventions to follow

- Token arbitrary-value syntax exemplar (same repo):
  `src/renderer/src/components/WindowSideBar.vue:142`
  `transition-[opacity,transform] duration-[var(--dc-motion-default)] ease-[var(--dc-ease-out-express)]`.
- The JS before-leave measurement technique (lines 73-93, writing `--leave-*` CSS vars) is
  deliberate and commented — do not touch it.

## Steps

1. `MessageActionButtons.vue:5` — `transition-all` → `transition-[opacity,transform]`.
2. `MessageActionButtons.vue:8` — same replacement.
3. `MessageActionButtons.vue:98` — `transition: transform 0.3s ease;` →
   `transition: transform var(--dc-motion-default) var(--dc-ease-out-express);`.
4. `MessageActionButtons.vue:110-112` — `opacity 0.3s ease, transform 0.3s ease` →
   `opacity var(--dc-motion-default) var(--dc-ease-out-express), transform var(--dc-motion-default) var(--dc-ease-out-express)`.

## Boundaries

- Do NOT touch the JS handlers (lines 73-93) or the absolute-position leave technique.
- Do NOT change durations of the enter/leave template classes (already tokenized).
- Do NOT add reduced-motion CSS here — the global nuke (style.css:929-941) covers this component.

## Verification

- **Mechanical**: `pnpm exec vitest run test/renderer/components/message/MessageActionButtons.test.ts`
  must pass; `pnpm exec oxfmt --check` clean.
- **Feel check**: hover a message and move the mouse across several messages rapidly:
  - Buttons appear/disappear in 220ms with a clean ease-out; no property animates except
    opacity/transform (check the Elements → Computed → "transition" on the leaving element).
  - Rapid hover switching never shows a slow 300ms drift or shadow/width artifacts.
- **Done when**: the action stack pops in/out at 220ms with express easing and only
  opacity+transform in the transition list.
