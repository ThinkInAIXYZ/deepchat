# Light OCR 0.5.6 Runtime Assets

Status: implemented and locally validated

Upstream release:
[arcships/light-ocr v0.5.6](https://github.com/arcships/light-ocr/releases/tag/v0.5.6)

## Context

Before this increment, DeepChat pinned the Light OCR 0.5.5 facade, 0.1.5 runtime,
0.3.4 Small model, and six 0.5.5 native packages. Light OCR 0.5.6 keeps the public
image, PDF, and multi-page APIs unchanged, but changes the native PDFium runtime
closure: every platform package now carries a checksum-pinned Noto Sans SC
fallback font and its license. The PDFium loader resolves those files relative to
its own directory.

The existing DeepChat package contract permits exactly three files directly below
`pdfium/`. It rejects the new `pdfium/fonts/` directory. On macOS, DeepChat also
materializes encoded native code and the PDFium loader into a private temporary
runtime; copying the loader without its relative font resources would either fail
module loading or silently lose the upstream rendering fix.

## Goals

- Upgrade the stable Light OCR closure to facade 0.5.6, runtime 0.1.6, and native
  0.5.6 while retaining model 0.3.4 and bundle
  `ppocrv6-small-native-20260719.1`.
- Preserve the exact, fail-closed package inventory and integrity boundaries.
- Package and validate the fallback font and OFL assets on all six supported
  targets.
- Materialize verified PDFium font resources beside the loader on encoded macOS
  runtimes.
- Add a packaged smoke fixture that proves a PDF with a non-embedded Chinese font
  renders and survives OCR.
- Preserve existing image OCR, scanned-PDF OCR, helper protocol, cache, attachment,
  and UI behavior.

## Non-Goals

- No Light OCR API adapter, helper-protocol change, renderer change, or new setting.
- No model, bundled Node, PDF resource-limit, or OCR text-budget change.
- No generic recursive acceptance of future files under `pdfium/`.
- No system-font fallback, runtime download, postinstall script, or symlink from the
  private runtime back into the packaged application.
- No claim that the bundled Simplified Chinese fallback covers every CJK script or
  typography requirement.

## Version Closure

| Component | Package | Version |
| --- | --- | --- |
| Stable facade | `@arcships/light-ocr` | `0.5.6` |
| Model-free runtime | `@arcships/light-ocr-runtime` | `0.1.6` |
| Small model | `@arcships/light-ocr-model-ppocrv6-small` | `0.3.4` |
| Native packages | six `@arcships/light-ocr-<platform>` packages | `0.5.6` |

The bundled Node remains `v24.14.1`. The package manager lockfile must resolve the
facade to runtime 0.1.6 and the runtime to the matching 0.5.6 native package for
every supported target.

## PDFium Resource Contract

Every supported native package contains these platform-independent resources:

- `pdfium/index.cjs`
- `pdfium/pdfium.node`
- `pdfium/fonts/NotoSansSC-Regular.otf`
- `pdfium/fonts/OFL.txt`

It also contains exactly one platform library:

- macOS: `pdfium/libpdfium.dylib`
- Linux: `pdfium/libpdfium.so`
- Windows: `pdfium/pdfium.dll`

The two font paths remain in the existing `other` artifact inventory group. A
separate explicit PDFium resource allowlist distinguishes them from unrelated
metadata without changing packaged runtime manifest schema v3. Packaging and
packaged smoke compare the complete recursive PDFium tree against this exact
allowlist and reject missing, duplicate, unmanifested, unexpected, non-regular, or
symlinked entries. Runtime resolution checks the exact manifest inventory and all
required physical paths; the encoded macOS materializer additionally re-verifies
resource size and SHA-256 before helper startup.

The font, its duplicate packaged license record, and all native package metadata
remain covered by the upstream `artifact-hashes.json`. DeepChat verifies those
bytes before packaging and packaged smoke verifies the shipped representation.

## Platform Runtime Contract

Linux and Windows retain the direct native package. The upstream loader discovers
`pdfium/fonts` beside itself and initializes PDFium with that directory.

macOS retains `gzip-base64-v1` encoding for Mach-O artifacts. The font and license
are data and remain raw in the signed application. Before helper startup, DeepChat:

1. validates the exact PDFium manifest inventory;
2. verifies the loader, font, and font-license size and SHA-256;
3. materializes them under a private `pdfium/` tree;
4. decodes and verifies the PDFium addon and shared library into the same tree;
5. passes only the private `pdfium/index.cjs` path to the helper.

The helper's existing rule that an overridden PDFium module must remain inside the
private runtime is unchanged. Materialization copies resources rather than using
symlinks so integrity, lifetime, and containment stay explicit.

## Compatibility

- Public Light OCR and DeepChat contracts are unchanged.
- Runtime manifest schema remains v3; only the exact artifact inventory changes.
- The facade/runtime/native version fields naturally invalidate derived OCR cache
  entries. No database migration or artifact-revision bump is needed.
- Persisted attachment OCR snapshots remain immutable and are not recomputed.
- The settings UI reports 0.5.6 through the existing availability contract.
- The expected compressed OCR asset total remains below the existing 90 MiB
  component budget; the budget must not be raised without measured evidence.

## Acceptance Criteria

- A version-only upgrade is impossible: the package and runtime checks require the
  exact v0.5.6 closure and all font resources.
- Direct Linux and Windows layouts load the package-local font resources.
- Encoded macOS layouts materialize exact verified font bytes beside the PDFium
  loader and contain no raw Mach-O OCR artifacts.
- Missing PDFium resources fail runtime resolution. Corrupt, symlinked, or
  unexpected resources fail packaging and packaged smoke; encoded macOS resources
  are also re-verified before OCR execution.
- Existing real image and raster/scanned-PDF smoke behavior remains covered.
- A deterministic PDF referencing non-embedded `STSong-Light` produces Chinese
  text through packaged OCR with network access disabled.
- Focused tests, formatting, i18n validation, lint, typecheck, production build,
  and current-platform packaged smoke pass where local prerequisites allow.
- Other target claims require their normal platform packaging workflows.
