# DeepChat native dim plugin host

This executable assembles dim at the exact `sourceCommit` of the locked official
release, with the release's native plugins and DeepChat's small Rust plugins.
It delegates agent execution, input queues, model selection, HTTP drivers,
credential recovery and auxiliary inference to dim. It contains no agent loop.

The official alpha.21 executable remains installed and covered by the smoke
suite. Its TS plugin bindings do not expose arbitrary `ModelConfig` adoption or
`ProviderSecretHost`, so production integration needs this native assembly.
`scripts/prepare-dim-source.mjs` verifies the pinned Git object and checks exact changes in the Provider assembly: enabling the existing
`ProviderSecretHost` dependency and resolving explicitly marked custom-header
references through that same host when a connection is opened. Except for the builder extension below, all other tracked
source must match the pinned revision. Loop, queue, context and model drivers
remain upstream implementations.

The builder assembly additionally exposes `replace_session_host`: an explicit
per-Session host factory using dim's own SessionIdentity. The context plugin
uses it to supply the public PrepareContext host in place of IdentityContext.
This does not alter existing registration behavior or active Sessions. Its
separate source hash is recorded in `extensionPatches` and checked at launch.

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

Only credential references and public default headers are written to native provider configuration. The
`ProviderSecretHost` plugin resolves a reference through the private desktop
capability socket/pipe, with bounded frames, cancellation and generic errors.
The desktop callback must authorize the provider/reference pair and use its
existing OS-protected credential store. Custom header values use immutable references too; rotation revokes the old
connection grant. Resolved credential/header values never enter Timeline.

Only Linux x64 has been built and exercised locally so far. Cross-platform
packaging validation remains part of the migration acceptance work.

`session.deepchat_inputs.submit` stores validated desktop presentation as a
`deepchat/input-representation` extension (both context flags are false), then
admits the input through the native Branch facade. The presentation preserves
attachment names and inline references without putting UI data in model context.
`session.deepchat_native_storage.history` reads every committed fact, including
extensions hidden by dim's public history projection; desktop caches can be
rebuilt after restart through the storage plugin.

With the product context bridge enabled, Rust calls the private desktop context
port at each native model request boundary, including requests that execute
queued inputs. Contributions append text to the pinned native history; dim
validates that prefix and owns budgeting/compaction. The plugin registers its
context marker in the native prompt guide. Receipts enter ModelCall metadata,
with no Tape audit write. A native cancellation closes the callback socket and
cancels desktop context work before inference. This port does not invoke models.

Memory audit writes use `session.deepchat_memory.audit`, serialized with input
retirement and acknowledged after publication. These are non-context extension
facts, with native event ids and u64 positions. Memory reads settled, immutable
views through the storage plugin, including closed generations; product memory
policies and its own claim store remain in DeepChat. The existing JSON lineage
column accepts explicit dim view references alongside read-only numeric Tape
references, without inventing new Tape ids or changing dim's store schema.

`deepchat.storage.scope` reads native origin, parent, immutable CWD/model/mounts and
title metadata through the independent storage plugin and public SessionStore.
`session.deepchat_scope.frame` finds the native branch that owns a model request;
the query position distinguishes that branch from another line's inherited prefix.
The desktop authorizes native delegation against the current root binding before
and after I/O. The dim `agent` tool creates and executes members; this metadata port
does not create, schedule or invoke them.

Large independent media inputs use `deepchat.native_media_inputs.submit`. The
desktop sends a bounded file-backed RPC payload; the plugin prepares private
binary inputs through public FileStorage/PluginFileTransactions and delegates
admission to ModalityTasks. Native task records determine retention, terminal
cleanup and restart recovery. Recovery completes before orphan cleanup; uncertain
admission never triggers an automatic resubmission. Cleanup observers are joined
at unload. A scoped caller protects input preparation from idle backup shutdown.
