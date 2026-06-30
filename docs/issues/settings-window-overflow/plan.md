# Settings Window Overflow - Plan

## Fix Strategy

Use the smallest fix that covers the bug: set `minWidth` and `minHeight` on the Settings `BrowserWindow`.

This avoids touching dozens of Settings row components. Responsive row cleanup can happen later when those components are edited for other reasons.

## Proposed Bounds

Use a conservative desktop Settings minimum:

- `minWidth`: 900
- `minHeight`: 640

The width covers:

```text
Settings minimum 900px
| sidebar 240px | content 660px |

Current widest common row:
| label 220px | gap | control 320px | = about 552px before page padding
```

## Affected Files

- `src/main/presenter/windowPresenter/index.ts`
- `test/main/presenter/windowPresenter.test.ts` only if the existing BrowserWindow option test can assert minimum bounds cheaply.

## Test Strategy

1. Add or update one window presenter test that verifies Settings BrowserWindow receives `minWidth` and `minHeight`.
2. Run `pnpm run typecheck`.
3. Run `pnpm run lint`.
4. If touching renderer layout later, add a Playwright/E2E narrow-width check then; not needed for this minimum-window fix.

