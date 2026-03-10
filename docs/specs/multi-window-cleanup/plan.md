# Multi-Window Cleanup Plan

1. Rename renderer entry from `shell` to `browser` and delete tooltip overlay.
2. Convert YoBrowser from single-window multi-tab to multi-window single-page.
3. Remove tab shortcuts and tab UI, keep only multi-window behavior.
4. Short-circuit tab-dependent legacy MCP helpers.
5. Run format, i18n, lint, typecheck, targeted tests, and build.
