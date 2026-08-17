# Markstream Code Block Rendering Regression

## Issue

DeepChat's Markstream-backed code blocks can show gutter/content overlap or an incorrectly measured
code surface after an assistant message changes from streaming to final. The integration must use the
current enhanced code-block runtime: the exact `markstream-vue@2.0.0-beta.2` beta with its
`stream-diffs@0.0.2` peer.

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

In Markstream 1.x, `codeRenderer="monaco"` was the compatibility name for the enhanced
`CodeBlockNode`; it did **not** create a live Monaco instance for every streaming code update.
Markstream 2.0 removes that selector and uses the enhanced path by default when `stream-diffs` is
installed. The component still owns the same stable handoff:

```text
MarkdownRenderer
  -> NodeRenderer (content grows, final=false, codeBlockStream=true)
    -> CodeBlockNode renders its built-in PreCodeNode while the fence is streaming

same NodeRenderer / same CodeBlockNode
  -> final=true, codeBlockStream=false, completed and visible
    -> CodeBlockNode dynamically imports stream-diffs and mounts one File/FileDiff surface
```

Selecting or replacing the renderer at the application boundary, setting `renderCodeBlocksAsPre`, or
calling private runtime APIs would bypass that lifecycle and reintroduce a completion flash or
geometry race. The app-level prose root also applies text-breaking rules; enhanced code hosts must
retain `break-words`, and their flex parent must be allowed to shrink, without targeting runtime
gutter internals.

## Fix Plan

1. Pin direct dependencies to `markstream-vue@2.0.0-beta.2` and `stream-diffs@0.0.2`.
   Keep `stream-monaco` because DeepChat's independent artifact/editor surfaces still import it.
2. Keep one stable `NodeRenderer` on Markstream's default enhanced path for both streaming and final
   states. Pass `codeBlockStream=true` only while the message is live and set `final=true` with the
   last content snapshot when it completes.
3. Do not set `renderCodeBlocksAsPre`, register a generic `code_block` override, remount the renderer,
   import `stream-diffs` directly from DeepChat, or call private adapter methods.
4. Continue using Markstream's documented `handle-artifact-click` event and supported
   top-level `themes` / `codeBlockOptions` props. Map the old `wordWrap: 'on'` behavior to
   `overflow: 'wrap'`.
5. Replace DeepChat-only Markdown fence labels such as `desktop-local-file` with `plaintext` before
   passing content to Markstream. `stream-diffs` delegates final highlighting to Shiki and rejects
   unsupported identifiers; valid standard fence languages remain unchanged.
6. Use `break-words` instead of the prose root's `break-all`, and retain `min-w-0` on the assistant
   content flex item. Neither change overrides runtime gutter/content geometry.
7. Update DOM-contract tests to cover both unlabeled and TypeScript fallback/final handoff.
8. Wrap direct `CodeBlockNode` and `MermaidBlockNode` hosts in `.markstream-vue`, because 2.0 scopes
   component variables and fallback styles under that container.
9. Render the exported `PreCodeNode` component directly in `ThinkContent`; beta.2 no longer exposes
   the 1.x `PreCodeNode.vue` runtime property.

## Validation

- [x] Package lock resolves `markstream-vue@2.0.0-beta.2` with `stream-diffs@0.0.2`, while preserving
  DeepChat's direct `stream-monaco` dependency.
- [x] Focused MarkdownRenderer tests confirm renderer-neutral options and one enhanced renderer
  configuration through streaming and final completion.
- [x] Markstream DOM-contract tests prove the built-in streaming `<pre>` fallback and post-completion
  enhanced `stream-diffs` handoff for unlabeled and TypeScript fences.
- [x] Direct node hosts retain the `.markstream-vue` CSS scope, and `ThinkContent` uses the direct
  `PreCodeNode` export.
- [x] Format, i18n, lint, typecheck, 72 focused renderer tests, and the production Electron Vite
  build pass.

The full renderer suite was also attempted, but a Vitest worker exceeded its 4 GB Node heap before
the suite completed. This was a host-capacity failure rather than a useful migration verdict; all
Markstream integration, worker, CSS-source, and direct-host suites passed independently.

## GitHub Issue

No GitHub issue has been requested or created.
