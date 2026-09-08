# Light OCR Runtime Assets

## Contract

DeepChat ships an exact, integrity-checked Light OCR package closure. Every native PDFium package
includes a checksum-pinned Noto Sans SC fallback font and its license. The loader resolves these
resources relative to its own directory. Encoded macOS runtimes materialize verified resources beside
the private PDFium loader before starting the helper.

The package inventory remains explicit and fail-closed. This contract does not allow arbitrary new
files under `pdfium/`, system-font fallback, runtime resource downloads, postinstall scripts, or
symlinks back into the packaged application. The bundled Simplified Chinese font does not imply
coverage for every CJK script or typography requirement.

## Version Closure

`resources/runtime-versions.json` owns the OCR runtime inventory; `package.json` and `pnpm-lock.yaml`
resolve the matching facade and native packages:

| Component          | Package                                       | Version |
| ------------------ | --------------------------------------------- | ------- |
| Stable facade      | `@arcships/light-ocr`                         | `0.5.7` |
| Model-free runtime | `@arcships/light-ocr-runtime`                 | `0.1.7` |
| Small model        | `@arcships/light-ocr-model-ppocrv6-small`     | `0.3.4` |
| Native packages    | six `@arcships/light-ocr-<platform>` packages | `0.5.7` |

The model bundle is `ppocrv6-small-native-20260719.1`. OCR obtains a compatible official Node runtime
through the ToolchainService; it does not use Electron's Node runtime. A clean installation requires
the user to install the managed Node pin or select a compatible system runtime before offline OCR is
available. Once the runtime is available, OCR asset resolution and execution require no network access.

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
- The settings UI reports the resolved facade version through the existing availability contract.
- The expected compressed OCR asset total remains below the existing 90 MiB
  component budget; the budget must not be raised without measured evidence.

## Acceptance Criteria

- A version-only upgrade is impossible: the package and runtime checks require the
  exact manifest-pinned closure and all font resources.
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
