# DeepChat native dim plugin host

This executable assembles dim at the exact `sourceCommit` of the locked official
release, with the release's native plugins and DeepChat's small Rust plugins.
It delegates agent execution, input queues, model selection, HTTP drivers,
credential recovery and auxiliary inference to dim. It contains no agent loop.

The official alpha.21 executable remains installed and covered by the smoke
suite. Its TS plugin bindings do not expose arbitrary `ModelConfig` adoption or
`ProviderSecretHost`, so production integration needs this native assembly.
`scripts/prepare-dim-source.mjs` verifies the pinned Git object and applies one
explicit assembly change: `ProviderPlugin::with_session_lifecycle` enables the
existing `ProviderSecretHost` dependency. The original file and all other tracked
source must match the pinned revision. No execution implementation is changed.

Run `pnpm run installRuntime:dim`, then `pnpm run build:dim-host` with Rust 1.98.1.
Use `pnpm run build:dim-host -- --dev` for local smoke tests. Downloaded dim source
and compiler output are ignored. `Cargo.lock` freezes transitive dependencies.
The binary is copied outside ASAR with a checksum/provenance manifest; the
supervisor validates its hash and the native plugin's source/version handshake.
The source package reports alpha.18, while its official release tag is alpha.21;
the manifest records these separate identities rather than weakening validation.

Generation settings are adopted through `Branch.configure`. Auxiliary calls use
dim's selection/connection ports and `auxiliary_model::complete`, including its
retry policy. Closing a caller cancels and joins its native operation.

Only credential references are written to native provider configuration. The
`ProviderSecretHost` plugin resolves a reference through the private desktop
capability socket/pipe, with bounded frames, cancellation and generic errors.
The desktop callback must authorize the provider/reference pair and use its
existing OS-protected credential store. Credential values never enter Timeline.

Only Linux x64 has been built and exercised locally so far. Cross-platform
packaging validation remains part of the migration acceptance work.
