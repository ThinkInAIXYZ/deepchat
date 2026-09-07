# Light OCR 0.5.6 Runtime Assets Plan

## Dependency Closure

- Pin `@arcships/light-ocr` to 0.5.6.
- Pin the independent runtime and native versions in
  `resources/runtime-versions.json` to 0.1.6 and 0.5.6.
- Keep model 0.3.4, the existing Small bundle ID, and bundled Node unchanged.
- Regenerate `pnpm-lock.yaml` with pnpm and verify all six optional native
  dependencies resolve to 0.5.6.

## Artifact Contract

Extend the shared script and TypeScript artifact helpers with an exact list of
PDFium data resources:

- `pdfium/fonts/NotoSansSC-Regular.otf`
- `pdfium/fonts/OFL.txt`

`getRequiredPdfiumArtifactPaths()` returns loader, platform code, and data
resources. Code encoding classification remains extension-based and unchanged;
the font resources stay raw and in the existing `other` inventory group.

Replace top-level-only PDFium directory checks in `afterPack` and packaged smoke
with recursive, symlink-rejecting file inventory checks. Compare both the physical
tree and `artifact-hashes.json` paths with the same exact allowlist.

Require the upstream Noto license record in the native package's legal assets.
Do not accept arbitrary future PDFium files without an explicit reviewed update.

## macOS Materialization

Change both production and independent smoke materializers to separate PDFium
artifacts into:

- loader;
- encoded code;
- raw runtime resources.

Read each raw resource with existing bounded regular-file and SHA-256 validation,
then write it with exclusive creation under the private materialized root.
Materialize resources before loading the module. Keep the returned override shape
and helper containment validation unchanged.

Use one bounded aggregate resource limit for materialized PDFium data so a future
manifest update cannot turn the resource-copy path into unbounded memory or disk
consumption. The current 8.34 MB unpacked addition remains comfortably below that
limit.

## Packaged Smoke

Preserve the current image and raster-PDF fixtures. Add a second deterministic PDF
whose content stream references non-embedded `STSong-Light` and paints
`中文测试`. Assert the streamed OCR pages contain the expected Chinese text.

The smoke must verify font assets before helper spawn, exercise macOS private
materialization when applicable, and continue running with the workflow's network
denial. Record the new document timing separately only if it is needed for a
stable performance contract; otherwise treat the small fallback check as a
functional gate and retain the existing PDF timing metric.

## Tests

Update focused fixtures in:

- script artifact classification and exact inventory tests;
- `afterPack` package-layout tests;
- runtime asset resolver identity tests;
- encoded macOS native payload tests;
- packaged smoke layout/materialization and PDF fixture tests.

Add negative coverage for a missing font, unexpected file inside `pdfium/fonts`,
corrupt font bytes, and a symlinked resource. Update only tests coupled to the
real pinned closure; generic cache and UI fixtures may keep arbitrary historical
version strings.

## Documentation And Compatibility

Update the maintained Light OCR PDF feature specification with the current
version closure and font-resource contract. Keep completed historical plan/task
evidence intact and link it to this architecture increment instead of rewriting
past validation claims.

No runtime-manifest, helper-protocol, cache-schema, renderer-contract, or i18n
schema migration is planned.

## Validation And Review

Run the smallest focused suites first, then:

```text
pnpm run format
pnpm run i18n
pnpm run lint
pnpm run typecheck
pnpm test
pnpm run build
```

Run current-platform packaging and offline smoke if signing-independent local
prerequisites are available. Use the six normal platform workflows for complete
target validation.

Before every commit, inspect the complete staged diff and affected call paths.
Rank findings by severity across hidden side effects, compatibility, boundaries,
performance, security, naming, test sufficiency, and maintenance cost. Fix
in-scope findings, rerun the relevant validation, and commit with a message that
describes the delivered upgrade. Do not push.
