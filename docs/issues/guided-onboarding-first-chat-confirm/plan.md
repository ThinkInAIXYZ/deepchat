# Implementation Plan

## Cause

`NewThreadPage` handles the `first-chat` confirm action by querying the contenteditable element and calling `HTMLElement.focus()`. The chat input is backed by a TipTap editor, so the editor-aware focus path should be invoked through the component itself.

## Change

- Expose a `focusInput` method from `ChatInputBox` that focuses and scrolls the editor into view.
- Use that exposed method from `NewThreadPage` when the guided `first-chat` confirm action runs.
- Keep the existing DOM query as a fallback for older or stubbed component shapes.
- Add a focused renderer test for the confirm action.

## Validation

- Run focused renderer tests for `NewThreadPage` onboarding and `ModelProviderSettings`.
- Run the repository-required `pnpm run format`, `pnpm run i18n`, and `pnpm run lint` checks.
