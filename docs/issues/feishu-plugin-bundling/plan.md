# Feishu Plugin Bundling Plan

## Approach

- Add an official-plugin ensure script that scans official plugin manifests, computes expected
  artifact names, and packages only missing files.
- Wire the ensure script into dev startup scripts so fresh clones get Feishu automatically.
- Add explicit Feishu package/bundle commands plus aggregate official bundle commands for build and
  CI.
- Move bundled plugin resources into shared Electron Builder resources so every platform embeds
  `.dcplugin` files.
- Update CI/release verification to call one generic official-plugin verifier per platform so the
  script, not workflow YAML, decides which plugin artifacts are required.

## Compatibility

- Existing installed plugin configuration stays under user data and is preserved by the current
  plugin installer refresh logic.
- Existing CUA packaging commands continue to work, but aggregate official bundle scripts own the
  clean step before multi-plugin bundling.
- Developers can force stale package refresh with the clean/rebundle script.

## Tests

- Add package/config/workflow assertions proving dev scripts run the ensure step and platform
  builds use official plugin bundling.
- Add a main-process regression covering packaged Feishu discovery and activation from
  `build/bundled-plugins`.
- Validate Feishu package metadata for all supported platforms.
