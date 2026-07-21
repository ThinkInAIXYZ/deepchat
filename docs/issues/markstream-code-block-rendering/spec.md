# Markstream Code Block Rendering Regression

## Issue

DeepChat's Markstream-backed code blocks can show gutter/content overlap or an incorrectly measured
code surface after an assistant message changes from streaming to final. The integration must use the
current enhanced code-block runtime: `markstream-vue@1.0.7-beta.4` with its `stream-diffs@0.0.2`
peer.

## Impact

- Language-labeled and unlabeled fences must keep their source readable while generation is active.
- Completed, visible fences must upgrade to the enhanced `stream-diffs` File/FileDiff surface without
  replacing the outer message or reusing transient streaming geometry.
- The application must not depend on Markstream internals, direct `stream-diffs` controllers, or CSS
  overrides of editor/gutter geometry.

## Root Cause

The prior diagnosis inspected a `markstream-vue@1.0.5 + stream-monaco` runtime after the dependency
had been pinned away from the current release line. That runtime is not the one requested for this
integration, and its application-managed continuous Monaco lifecycle is not the documented behavior
of the current `stream-diffs` adapter.

For current Markstream, `codeRenderer="monaco"` remains the compatibility name for the enhanced
`CodeBlockNode`, but it does **not** create a live Monaco instance for every streaming code update.
The component owns a stable handoff:

```text
MarkdownRenderer
  -> NodeRenderer (content grows, final=false, codeRenderer="monaco", codeBlockStream=true)
    -> CodeBlockNode renders its built-in PreCodeNode while the fence is streaming

same NodeRenderer / same CodeBlockNode
  -> final=true, codeBlockStream=false, completed and visible
    -> CodeBlockNode dynamically imports stream-diffs and mounts one File/FileDiff surface
```

Replacing the renderer at the application boundary (`pre` → `monaco`) or calling private runtime APIs
would bypass that lifecycle and reintroduce a completion flash or geometry race. The app-level prose
root also applies `break-all`; enhanced code hosts must opt out of that inherited text-breaking rule,
and their flex parent must be allowed to shrink, without targeting runtime gutter internals.

## Fix Plan

1. Restore current direct dependencies: `markstream-vue@1.0.7-beta.4` and `stream-diffs@0.0.2`.
   Keep `stream-monaco` because DeepChat's independent artifact/editor surfaces still import it.
2. Keep one stable `NodeRenderer` with `codeRenderer="monaco"` for both streaming and final states.
   Pass `codeBlockStream=true` only while the message is live and set `final=true` with the last
   content snapshot when it completes.
3. Do not set `renderCodeBlocksAsPre`, register a generic `code_block` override, remount the renderer,
   import `stream-diffs` directly from DeepChat, or call private adapter methods.
4. Continue using Markstream's documented `handle-artifact-click` event and supported
   `codeBlockProps` / `codeBlockMonacoOptions` props.
5. Replace DeepChat-only Markdown fence labels such as `desktop-local-file` with `plaintext` before
   passing content to Markstream. `stream-diffs` delegates final highlighting to Shiki and rejects
   unsupported identifiers; valid standard fence languages remain unchanged.
6. Use `break-words` instead of the prose root's `break-all`, and retain `min-w-0` on the assistant
   content flex item. Neither change overrides runtime gutter/content geometry.
7. Update DOM-contract tests to cover both unlabeled and TypeScript fallback/final handoff.

## Validation

- [x] Package lock resolves `markstream-vue@1.0.7-beta.4` with `stream-diffs@0.0.2`.
- [x] Focused MarkdownRenderer tests confirm one enhanced renderer configuration through streaming and
  final completion, with the final snapshot committed synchronously.
- [x] Markstream DOM-contract test proves the built-in streaming `<pre>` fallback and post-completion
  enhanced `stream-diffs` handoff for unlabeled and TypeScript fences.
- [x] Message layout test verifies the code host's flex ancestor can shrink.
- [x] Focused renderer tests (54), format, i18n, lint, typecheck, and direct `electron-vite build`
  passed. The full renderer suite remains a host-capacity follow-up: its parallel run produced 32
  unrelated 10-second test timeouts, while all Markstream-related suites passed. The standard
  `pnpm run build` command also needs a `pnpm` Corepack shim in this host's child-script PATH; its
  prebuild refresh completed and direct production bundling passed.


## GitHub Issue

No GitHub issue has been requested or created.
