# Animation Plans — README

Audit: `improve-animations` (commit stamp `aefcb11cd`, branch `refactor/dc-ui-standardization`).
16 plans, all **DONE**. No dependencies between plans — each was independently executable; the
recommended order grouped them by risk.

## Plan index

| # | Plan | Severity | Category | Status |
|---|------|----------|----------|--------|
| 001 | DcButton press feedback | HIGH | Physicality | DONE |
| 002 | Trigger origin for Tooltip / Select / ContextMenu | HIGH | Physicality | DONE (dc-ui stylesheet) |
| 003 | Spotlight (command palette) open/close motion | HIGH | Purpose & frequency | DONE |
| 004 | Sidebar shell width animation cost | HIGH | Performance | DONE |
| 005 | ChatSidePanel backwards exit keyframes | MEDIUM | Physicality | DONE |
| 006 | MessageActionButtons tokenization | MEDIUM | Easing & duration | DONE |
| 007 | Session pin-dock margin-left → transform | MEDIUM | Performance | DONE |
| 008 | ChatTopBar collapsed-button/padding tokens | MEDIUM | Performance | DONE |
| 009 | McpTabHeader underline scaleX | MEDIUM | Performance | DONE |
| 010 | Pin micro-interaction curve consolidation | MEDIUM | Cohesion & tokens | DONE |
| 011 | Splash core-flare scale(0) | LOW | Physicality | DONE |
| 012 | FloatingSessionItem hover gating | LOW | Accessibility | DONE |
| 013 | Message-list entrance (opportunity) | MEDIUM | Missed opportunities | DONE |
| 014 | Session-list TransitionGroup (opportunity) | MEDIUM | Missed opportunities | DONE |
| 015 | Onboarding spotlight step fade (opportunity) | LOW | Missed opportunities | DONE |
| 016 | ChatSidePanel content swap crossfade (opportunity) | LOW | Missed opportunities | DONE |

## Recommended execution order

Phase A — isolated, highest leverage, lowest risk (do first):

1. **001** — DONE (app-wide press feedback)
2. **002** — DONE (dc-ui stylesheet; no `src/shadcn` edit)
3. **003** — DONE
4. **004** — DONE
5. **012** — DONE

Phase B — component-local mechanics: **005–011 DONE**.

Phase C — opportunities, higher regression risk: **016 → 013 → 014 → 015 DONE**.

## Notes

- **Rejected after vetting** (were raised in the parallel audit, then re-checked at file:line):
  - `will-change: filter` in `FloatingButton.vue` (lines 567, 599, 644) — all three elements
    genuinely animate `filter: blur(8-16px)`; the will-change is correct and the blur is under
    the playbook's 20px ceiling.
  - `grid-template-rows` fold animation in `MessageBlockToolCall/Error/ActivityGroup` — deliberate,
    tokenized, `motion-reduce`-guarded (the accepted modern pattern for height reveals).
  - `ease-in` in `MemoryInlinePanel.vue` leave — an exit, which the playbook permits.
- **Already good** (not findings): `src/dc-ui` has zero hand-typed motion; global reduced-motion
  nuke (style.css:929) + JS `matchMedia` gates cover all four windows; spotlight reduced-motion
  branch; theme-switch transition suppression (`.dc-theme-switching`).
- **Plan 002 implementation**: to honor docs/design-system.md rule #5, `src/shadcn` remains
  untouched. The Reka transform-origin mappings live in `src/dc-ui/styles/motion.css` and are
  imported by the shared renderer stylesheet plus the browser-overlay entry.

## Completion note

All plans have mechanical verification coverage. The remaining validation is a manual Electron
feel check for motion timing and `prefers-reduced-motion` behavior on real input devices.
