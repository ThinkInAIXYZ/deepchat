# Retire built-in artifacts implementation

- [x] Remove the MCP server, bundled authoring skill and obsolete configuration surface.
- [x] Replace historical artifact cards with literal source and remove Markdown preview actions.
- [x] Remove artifact workspace state, collection and runtimes while preserving file previews.
- [x] Review compatibility, remove obsolete tests and retain focused regression coverage.
- [x] Run format, i18n, lint, typecheck, relevant tests and the production build.

## Validation

- Renderer: historical source display/copy/no execution, unclosed and structured blocks, Markdown
  preview controls, workspace selection and watcher lifecycle, file previews, SVG and startup.
- Main: MCP normalization and retirement, typed routes, CLI surface and bundled skill discovery.
- Production build includes main, preload, renderer and CLI. Existing bundler chunk-size,
  mixed-import and dependency annotation warnings do not prevent a successful build.
- Provider and ACP registry refreshes from the normal build are retained.
- No conversation migration, replacement runtime or new dependency is introduced.
