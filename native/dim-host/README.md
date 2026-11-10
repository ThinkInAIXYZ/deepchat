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
references through that same host when a connection is opened. Every SDK
extension is enumerated and hashed in the provenance lock; all other tracked
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

Native smoke has run on Linux x64/ARM64 and macOS ARM64 in package regression.
Remaining architecture and final package validation continue independently.

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

Default media operations use dim's adapter. The Rust media compatibility plugin
adds Voice.ai speech and APIMart asynchronous image/video protocols. It uses the
same native HTTP transport and keeps remote task handles in Modality; admission,
files, persistence, cancellation and restart recovery remain native owners.
The product plugin supplies Voice.ai settings and APIMart's persisted endpoint
and parameter declarations as non-secret model metadata. APIMart speech continues
through dim's default OpenAI adapter.

Media conversations select a separate chat alias without changing the underlying
media model. Agent-local ModelHost/AuxiliaryModelHost values delegate ordinary
inference to the native defaults and submit media requests to ModalityTasks.
The original Agent loop, input queue, cancellation and branch configuration own
the conversation. Options are adopted into native request metadata per branch.
Input comes from the consumed operator facts at the model request's fixed cut;
runtime state/rule envelopes and future queued input are excluded. Large input
frames cross the private gateway by a verified scratch-file reference.

Before returning generated media to the conversation, the storage plugin uses
SessionFilesHost to store immutable 8 MiB chunks and a small manifest. Each chunk
fits the native Session-file limit; the complete output may still reach the
media task's 256 MiB product limit. Native fork, deletion and archive transfer own
the files together with the Session. The transcript names the immutable
manifest, so incremental imports need neither the original global media task
nor a desktop cache. Modality retains the independent task record.

The desktop projects media links into existing image/audio/video blocks and
reads bounded pages through the storage plugin's public FileStorage reader.
File size/digest checks precede atomic publication to a disposable image-cache
mirror. Cached history can be viewed without restoring an Agent. The same
materializer serves display, copy/save, model image input, CLI and remote image
delivery; earlier task-file links remain readable through Modality.

Large independent media inputs use `deepchat.native_media_inputs.submit`. The
desktop sends a bounded file-backed RPC payload; the plugin prepares private
binary inputs through public FileStorage/PluginFileTransactions and delegates
admission to ModalityTasks. Native task records determine retention, terminal
cleanup and restart recovery. Recovery completes before orphan cleanup; uncertain
admission never triggers an automatic resubmission. Cleanup observers are joined
at unload. A scoped caller protects input preparation from idle backup shutdown.

`deepchat.storage.archive_catalog` reads a closed profile's paginated ownership,
Agent profiles, creation configuration, titles, file ownership and grants through
native storage owners. It opens a read-only snapshot without restoring Agents.
The pinned assembly re-exports the existing AgentRecords/AgentRecord/SessionOwner
types; it adds no schema or storage queries outside those owners. This catalog is
the preflight boundary for canonical incremental transfer and portable files.

`deepchat.storage.archive_transfer` transfers complete native Session histories into
an exclusive, disposable cold destination. AgentRecords and SessionStore preserve
Agent/Session identities and parentage; TimelineStore reads and appends complete
atomic batches, including trace data and child-branch creation facts. Existing
Session identities retain their local titles and verify every shared event, trace
and batch boundary before appending a compatible source tail. Divergent histories,
conflicting creation records or ownership are rejected. A failed staging profile must be discarded. Immutable Session files transfer through Native FileStorage and SessionStore
ownership admission, preserving their file ids and shared lifetime. Registered command outputs stream through Native FileStorage into the target
profile and use its installed directory. Opaque overwrite restores relocate
output ownership through SessionStore before installation; deleting a restored
Session leaves the original profile untouched. Product incremental imports stage
the canonical merge before SQL changes and reuse the durable SQL/Native recovery
journal for atomic installation and rollback. Existing desktop bindings and caches
keep their own cursor; imported closed scopes retain separate read-only ownership. The context plugin publishes current Session-file roots without
rewriting historical paths.

The SDK file-owner seam adds `SessionStore.adopt_file` for an exclusively leased
cold profile. It validates the copied immutable directory with FileStorage before
recording ownership through the native writer. The schema and sweeper are dim's
existing implementations. Two separately hashed SDK file extensions make this
seam reviewable; no DeepChat SQL accesses native ownership tables.

Snapshots record their original product home for portable output registration.
SQLite read-only snapshots may create WAL/SHM companions, so transfer consumers
read a disposable working copy after validating an immutable archive closure.
The storage coordinator has an empty private home and no desktop gateway; it
opens only the staged store and does not restore Agents or invoke models.

Internal agent Sessions inherit their current desktop owner's selected MCP servers
through the private gateway after native parent-link authorization. A Session-scoped
plugin owns only this selection and its authorization renewal; native MCP owns
connections, catalogues, calls, cancellation and dynamic tool publication. Revoked
or changed selections unload their native resource view. Closing joins renewal
work and connection cleanup.

The hashed `mount_initial_binding` SDK factory primes the existing native MCP
catalogue while acquiring Session resources, before the first ToolBinding snapshot.
The ordinary temporary-binding API still waits for Session publication; it cannot
serve this initialization boundary. Both paths use the same native contributions
and update worker. No MCP execution loop or transport is copied into DeepChat.

This bridge owns I/O resources at Session scope. Native ToolBinding records adopted
configuration and native ToolExecutor records call results. The bridge writes no
new facts, schema, inputs, model requests or permission decisions.

SessionTitle reads an optional per-Session `TitleModelHost` preference before its
native auxiliary-model selection. The product port authorizes only a current
direct desktop binding and admits the configured assistant model; it never
performs inference. Explicit native title configuration retains precedence, and
an absent product preference preserves native selection. SessionTitle holds the
native Session lifecycle through preference lookup, inference and title
publication, so idle maintenance cannot cancel accepted title work. Forced close
cancels and joins the owner as usual.

SDK module graphs are generated with `xtask graph --model-config
crates/dim-agent-aimux/examples/offline.json`. Their original and generated hashes
and exact patch are pinned alongside code extensions; preparation accepts only a
complete original or complete prepared graph. Source/crate boundaries and plugin
documents pass. The stock SDK `xtask check` service catalogue profile cannot
initialize the embedding credential/connection hosts; the actual DeepChat
profile is verified by native integration and packaged-runtime smoke tests.

The decision plugin admits `decision.decide` through the public non-chat connection
owner, then invokes Aimux's existing Jev model and `decide` operation. Native
validation, retries, deadlines, networking and cancellation remain upstream.
The hashed Jev configuration seam adds an optional per-connection Fetch; its
absent default preserves the original process transport. The product Fetch uses
MediaTransport for connection settings, translates only the Workers AI envelope
and represents omitted legacy usage as unknown native counts. Results preserve
versioned model identity, confidence and score legends. No vendor headers or raw
failures cross the product boundary. A scoped RPC caller owns cancellation and
joins the native operation. Node providers retain catalogue administration and
contain no Jev or Workers AI judgment executor.

The optional ProviderConnectionHost runs after the native static resolver has
validated a model and resolved its credential. Existing Provider constructors
retain their dependencies; the embedding constructor also requires this port.
Only DeepChat's `deepchat/codex/v1/` references activate the product OAuth bridge.
Native Codex request rules and model execution stay with dim. The product supplies
its existing account lease and client headers without moving the account into
dim's managed OAuth registry. Native recovery classifies 401, controls replay and
owns cancellation. The product account owner refreshes only the rejected lease;
a late rejection reuses its already refreshed credential. Product grants and model
enablement are checked before and after account work. Native managed providers
retain their original authority and bypass this static-connection port.

Generated graph preparation accepts the exact previous complete graph in addition
to the original and current graph. It validates patch paths, resets only a known
previous graph to the pinned original, and applies the generated patch. Unknown
changes or partially prepared graphs still fail before mutation.
