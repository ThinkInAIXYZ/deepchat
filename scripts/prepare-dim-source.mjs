import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const lock = JSON.parse(await readFile(path.join(root, 'resources/dim-runtime-lock.json'), 'utf8'))
const directory = path.join(root, 'native/dim-source')
function git(args) {
  const result = spawnSync('git', ['-C', directory, ...args], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true
  })
  if (result.error || result.status !== 0)
    throw new Error(`Cannot prepare pinned dim source: ${result.stderr}`)
  return result.stdout.trim()
}
await mkdir(directory, { recursive: true })
try {
  await readFile(path.join(directory, '.git/HEAD'))
} catch {
  git(['init', '--quiet'])
  git(['config', 'core.autocrlf', 'false'])
  git(['fetch', '--quiet', '--depth=1', 'https://github.com/arcships/dim', lock.sourceCommit])
  git(['checkout', '--quiet', '--detach', 'FETCH_HEAD'])
}
if (git(['rev-parse', 'HEAD']) !== lock.sourceCommit)
  throw new Error('Pinned dim source revision mismatch')
// alpha.21 exposes ProviderSecretHost publicly but its stock product assembly opts out.
// Enable that existing extension and resolve explicit header references through the same host.
// No execution owner is replaced; only opaque references enter native storage.
const filename = 'crates/dim-app-server/src/provider.rs'
const original = git(['show', `HEAD:${filename}`]) + '\n'
const before = 'Self::keyed(names, false, true)'
const after = 'Self::keyed(names, true, true)'
if (original.split(before).length !== 2) throw new Error('Native credential extension seam changed')
const assembled = original.replace(before, after)
const headerBefore =
  '            let mut headers = record.headers;\n            let mut bearer = None;'
const headerAfter = `            let mut headers = record.headers;
            // DeepChat product connection: never persist resolved custom header values.
            // Explicit references share ProviderSecretHost's cancellation and validation boundary.
            for (name, value) in &mut headers {
                if let Some(reference) = value.strip_prefix("deepchat-header-ref:v1:") {
                    let resolved = self.credential(
                        provider_id,
                        &Some(StaticCredential::Reference { reference: reference.to_owned() }),
                        &StaticAuth::CustomHeader { header_name: name.clone() },
                        cancel,
                    ).await?;
                    let Some(ProviderSecret::Token(secret)) = resolved else {
                        return Err(failure("Invalid provider header reference"));
                    };
                    *value = secret;
                }
            }
            let mut bearer = None;`
if (assembled.split(headerBefore).length !== 2)
  throw new Error('Native header reference extension seam changed')
const headersExpected = assembled.replace(headerBefore, headerAfter)
// Expose the existing owner's activity without a second product counter. This includes
// internal auxiliary work (for example SessionTitle) that has no RPC client lease.
const activityBefore = `    async fn owned<T: Send + 'static, E: From<HostError> + Send + 'static>(`
if (headersExpected.split(activityBefore).length !== 2)
  throw new Error('Native provider activity seam changed')
const activityExpected = headersExpected.replace(
  activityBefore,
  `    /// Whether this owner has accepted work that has not settled yet.
    pub fn has_active_work(&self) -> bool {
        self.tasks.len() > 0
    }
${activityBefore}`
)
let expected = activityExpected
for (const [before, after] of [
  [
    '    secret_host: Option<Arc<ProviderSecretHost>>,',
    '    secret_host: Option<Arc<ProviderSecretHost>>,\n    connection_host: Option<Arc<ProviderConnectionHost>>,'
  ],
  [
    '    secret_host: Option<Key<ProviderSecretHost>>,',
    '    secret_host: Option<Key<ProviderSecretHost>>,\n    connection_host: Option<Key<ProviderConnectionHost>>,'
  ],
  ['        Self::keyed(names, true, true)', '        Self::with_connection_host(names)'],
  [
    `    fn keyed(names: &Names<'_>, secret_host: bool, lifecycle: bool) -> rutis::Result<Self> {`,
    `    /// The embedding host supplies ProviderConnectionHost and ProviderSecretHost.
    pub fn with_connection_host(names: &Names<'_>) -> rutis::Result<Self> {
        Self::keyed_with_connection_host(names, true, true, true)
    }
    fn keyed(names: &Names<'_>, secret_host: bool, lifecycle: bool) -> rutis::Result<Self> {
        Self::keyed_with_connection_host(names, secret_host, lifecycle, false)
    }
    fn keyed_with_connection_host(names: &Names<'_>, secret_host: bool, lifecycle: bool, connection_host: bool) -> rutis::Result<Self> {`
  ],
  [
    '            secret_host: secret_host.then(|| names.key()).transpose()?,',
    '            secret_host: secret_host.then(|| names.key()).transpose()?,\n            connection_host: connection_host.then(|| names.key()).transpose()?,'
  ],
  [
    '        keys.extend(self.secret_host.as_ref().map(Key::erase));',
    '        keys.extend(self.secret_host.as_ref().map(Key::erase));\n        keys.extend(self.connection_host.as_ref().map(Key::erase));'
  ],
  [
    '            let host = ctx.require_at(&self.host)?;',
    `            let connection_host = self.connection_host.as_ref()
                .map(|key| ctx.require_at(key)).transpose()?;
            let host = ctx.require_at(&self.host)?;`
  ],
  [
    '                    secret_host,',
    '                    secret_host,\n                    connection_host,'
  ],
  [
    `            return Ok(Resolution {
                connection: ResolvedModelConnection {
                    connection: ModelConnection::Http(connection),
                    failure_policy: None,
                    recovery: None,
                },
                protocol,
                realtime,
            });`,
    `            let mut resolved = ResolvedModelConnection {
                connection: ModelConnection::Http(connection),
                failure_policy: None,
                recovery: None,
            };
            if let Some(host) = &self.connection_host {
                let reference = match &record.credential {
                    Some(StaticCredential::Reference { reference }) => Some(reference.clone()),
                    _ => None,
                };
                resolved = host.0.prepare(
                    provider_id.to_owned(), model_id.to_owned(), reference, resolved, cancel.clone()
                ).await?;
                self.check(cancel)?;
            }
            return Ok(Resolution { connection: resolved, protocol, realtime });`
  ]
]) {
  if (expected.split(before).length !== 2)
    throw new Error('Native provider connection host seam changed')
  expected = expected.replace(before, after)
}
expected +=
  '\n' + (await readFile(path.join(root, 'resources/dim-sdk/provider-connection-host.rs'), 'utf8'))
const current = await readFile(path.join(directory, filename), 'utf8')
if (
  current !== original &&
  current !== assembled &&
  current !== headersExpected &&
  current !== activityExpected &&
  current !== expected
)
  throw new Error('Pinned dim provider source has unexpected changes')
const assemblyFile = 'crates/dim-agent-runtime/src/assembly.rs'
const secretsFile = 'crates/dim-app-server/src/provider/secrets.rs'
const servicesFile = 'crates/dim-app-server/src/lib.rs'
const recordsFile = 'crates/dim-app-server/src/agent_records.rs'
const ownedFilesFile = 'crates/dim-app-server/src/storage/files.rs'
const sessionStoreFile = 'crates/dim-app-server/src/storage/timeline.rs'
const mcpFile = 'crates/dim-app-server/src/mcp.rs'
const temporaryMcpFile = 'crates/dim-app-server/src/mcp/temporary.rs'
const titleFile = 'crates/dim-session-title/src/lib.rs'
const decisionFile = 'vendor/aimux/aimux-providers/src/jev.rs'
const commandFile = 'crates/dim-agent-capabilities/src/host_platform.rs'
const generatedDocs = JSON.parse(
  await readFile(path.join(root, 'resources/dim-sdk/generated-docs-lock.json'), 'utf8')
)
const generatedPaths = [
  'docs/architecture/rust-agent/generated/modules.json',
  'docs/architecture/rust-agent/generated/modules.mmd'
]
if (
  generatedDocs.length !== generatedPaths.length ||
  generatedDocs.some((entry, index) => entry.path !== generatedPaths[index])
)
  throw new Error('Unexpected generated dim architecture paths')
const digest = (content) => createHash('sha256').update(content).digest('hex')
const commandOriginal = git(['show', `HEAD:${commandFile}`]) + '\n'
const commandBefore =
  '        command\n            .args(&spec.args)\n            .current_dir(&spec.cwd)'
if (commandOriginal.split(commandBefore).length !== 2)
  throw new Error('Native command argument seam changed')
const commandArguments = await readFile(
  path.join(root, 'resources/dim-sdk/windows-command-arguments.rs'),
  'utf8'
)
const commandExpected = commandOriginal.replace(
  commandBefore,
  commandArguments + '        command\n            .current_dir(&spec.cwd)'
)
const commandCurrent = await readFile(path.join(directory, commandFile), 'utf8')
if (commandCurrent !== commandOriginal && commandCurrent !== commandExpected)
  throw new Error('Pinned native command argument handling has unexpected changes')
if (commandCurrent !== commandExpected)
  await writeFile(path.join(directory, commandFile), commandExpected)
const docStates = await Promise.all(
  generatedDocs.map(async (entry) => {
    const original = Buffer.from(git(['show', `HEAD:${entry.path}`]) + '\n')
    if (digest(original) !== entry.originalSha256)
      throw new Error('Pinned dim architecture baseline mismatch')
    const current = digest(await readFile(path.join(directory, entry.path)))
    if (
      current !== entry.originalSha256 &&
      current !== entry.sha256 &&
      current !== entry.previousSha256
    )
      throw new Error('Pinned dim architecture has unexpected changes')
    return { original, current }
  })
)
const docsPrepared = docStates.every(
  (entry, index) => entry.current === generatedDocs[index].sha256
)
const docsOriginal = docStates.every(
  (entry, index) => entry.current === generatedDocs[index].originalSha256
)
const docsPrevious = docStates.every(
  (entry, index) => entry.current === generatedDocs[index].previousSha256
)
if (!docsPrepared && !docsOriginal && !docsPrevious)
  throw new Error('Pinned dim architecture is only partially prepared')
git([
  'diff',
  '--exit-code',
  '--',
  '.',
  `:!${filename}`,
  `:!${assemblyFile}`,
  `:!${secretsFile}`,
  `:!${servicesFile}`,
  `:!${recordsFile}`,
  `:!${ownedFilesFile}`,
  `:!${sessionStoreFile}`,
  `:!${mcpFile}`,
  `:!${temporaryMcpFile}`,
  `:!${titleFile}`,
  `:!${decisionFile}`,
  `:!${commandFile}`,
  ...generatedPaths.map((entry) => `:!${entry}`)
])
if (current !== expected) await writeFile(path.join(directory, filename), expected)
// Add an explicit host-value replacement to the builder's assembly API. It changes no
// existing registration behavior; product plugins can replace the stock IdentityContext
// while retaining dim's own context preparation, loop and validation owners.
const assemblyOriginal = git(['show', `HEAD:${assemblyFile}`]) + '\n'
const assemblyNeedle = `    /// Provides a host-configured value under its Session name in every`
const replacementMethod = `    /// Replaces one Session host with an explicit per-Session factory, or
    /// provides it when absent. Assembly only; active Sessions are unchanged.
    pub fn replace_session_host<T: ?Sized + Send + Sync + 'static>(
        &mut self,
        make: impl Fn(&SessionIdentity) -> Arc<T> + Send + Sync + 'static,
    ) -> &mut Self {
        let name = crate::names::name_of::<T>();
        let provide: Provide = Arc::new(move |ctx, scope| {
            let identity = ctx.require_at(&scope.key::<SessionIdentity>())?;
            ctx.provide_at::<T>(scope.key::<T>(), make(&identity))?;
            Ok(())
        });
        if let Some(index) = self.assembly.value_names.iter().position(|existing| existing == &name) {
            self.assembly.values[index] = provide;
        } else {
            self.assembly.value_names.push(name);
            self.assembly.values.push(provide);
        }
        self
    }
`
if (assemblyOriginal.split(assemblyNeedle).length !== 2)
  throw new Error('Native Session host-value assembly seam changed')
const assemblyExpected = assemblyOriginal.replace(
  assemblyNeedle,
  replacementMethod + assemblyNeedle
)
const assemblyCurrent = await readFile(path.join(directory, assemblyFile), 'utf8')
if (assemblyCurrent !== assemblyOriginal && assemblyCurrent !== assemblyExpected)
  throw new Error('Pinned dim assembly source has unexpected changes')
if (assemblyCurrent !== assemblyExpected)
  await writeFile(path.join(directory, assemblyFile), assemblyExpected)
// An anonymous connection can still have an explicit product admission reference.
// Resolve that reference through the public host, then let StaticAuth::Anonymous
// continue to produce no authorization header. Unreferenced dim connections keep
// their existing behavior.
const secretsOriginal = git(['show', `HEAD:${secretsFile}`]) + '\n'
const secretsNeedle = 'if *auth == StaticAuth::Anonymous {'
if (secretsOriginal.split(secretsNeedle).length !== 2)
  throw new Error('Native anonymous reference extension seam changed')
const secretsExpected = secretsOriginal.replace(
  secretsNeedle,
  'if *auth == StaticAuth::Anonymous && credential.is_none() {'
)
const secretsCurrent = await readFile(path.join(directory, secretsFile), 'utf8')
if (secretsCurrent !== secretsOriginal && secretsCurrent !== secretsExpected)
  throw new Error('Pinned dim secret source has unexpected changes')
if (secretsCurrent !== secretsExpected)
  await writeFile(path.join(directory, secretsFile), secretsExpected)
// The index already exposes typed native Session activity. Make that existing process
// service available to an embedding plugin without accessing private storage or agents.
const servicesOriginal = git(['show', `HEAD:${servicesFile}`]) + '\n'
const indexImport = 'use agents::{AgentIndex, AgentsPlugin};'
const indexExport = 'pub use agents::{SessionPermissions, SessionRef, SessionsError};'
if (
  servicesOriginal.split(indexImport).length !== 2 ||
  servicesOriginal.split(indexExport).length !== 2
)
  throw new Error('Native session activity export seam changed')
const servicesPrevious = servicesOriginal
  .replace(indexImport, 'use agents::AgentsPlugin;')
  .replace(
    indexExport,
    'pub use agents::{AgentIndex, SessionPermissions, SessionRef, SessionsError};'
  )
const servicesExpected = servicesPrevious.replace(
  'pub use agents::{AgentIndex, SessionPermissions, SessionRef, SessionsError};',
  'pub use agent_records::{AgentRecord, AgentRecords, SessionOwner};\n' +
    'pub use agents::{AgentIndex, SessionPermissions, SessionRef, SessionsError};'
)
const servicesCurrent = await readFile(path.join(directory, servicesFile), 'utf8')
if (
  servicesCurrent !== servicesOriginal &&
  servicesCurrent !== servicesPrevious &&
  servicesCurrent !== servicesExpected
)
  throw new Error('Pinned dim service exports have unexpected changes')
if (servicesCurrent !== servicesExpected)
  await writeFile(path.join(directory, servicesFile), servicesExpected)
const recordsOriginal = git(['show', `HEAD:${recordsFile}`]) + '\n'
let recordsExpected = recordsOriginal
for (const name of ['AgentRecord', 'AgentRecords', 'SessionOwner']) {
  const before = `pub(crate) struct ${name}${name === 'AgentRecords' ? '(' : ' {'}`
  if (recordsOriginal.split(before).length !== 2)
    throw new Error('Native ownership API export seam changed')
  recordsExpected = recordsExpected.replace(before, before.replace('pub(crate)', 'pub'))
}
const recordsCurrent = await readFile(path.join(directory, recordsFile), 'utf8')
if (recordsCurrent !== recordsOriginal && recordsCurrent !== recordsExpected)
  throw new Error('Pinned dim ownership exports have unexpected changes')
if (recordsCurrent !== recordsExpected)
  await writeFile(path.join(directory, recordsFile), recordsExpected)
// The native file owner admits copied immutable files under its existing schema.
// The embedding plugin never writes ownership rows or manages a second file catalog.
const filePatches = []
for (const [filename, extensions] of [
  [ownedFilesFile, ['session-files-adopt.rs', 'session-files-relocate.rs']],
  [sessionStoreFile, ['session-store-adopt.rs', 'session-store-relocate.rs']]
]) {
  const original = git(['show', `HEAD:${filename}`]) + '\n'
  let expected = original
  const accepted = [original]
  for (const extension of extensions) {
    expected += '\n' + (await readFile(path.join(root, 'resources/dim-sdk', extension), 'utf8'))
    accepted.push(expected)
  }
  const current = await readFile(path.join(directory, filename), 'utf8')
  if (!accepted.includes(current))
    throw new Error('Pinned native file owner has unexpected changes')
  if (current !== expected) await writeFile(path.join(directory, filename), expected)
  filePatches.push({ path: filename, sha256: createHash('sha256').update(expected).digest('hex') })
}
// A public MCP owner factory primes its native catalogue during resource acquisition.
// Connection updates and execution remain with the existing MCP binding and tool provider.
const mcpOriginal = git(['show', `HEAD:${temporaryMcpFile}`]) + '\n'
let mcpExpected = mcpOriginal
for (const [before, after] of [
  [
    'servers: input.servers.clone(), tools, lifecycle, ready, changed: changed.clone()',
    'servers: input.servers.clone(), tools, lifecycle, ready, changed: changed.clone(), initial: false'
  ],
  ['    changed: Arc<Notify>,\n}', '    changed: Arc<Notify>,\n    initial: bool,\n}'],
  [
    '            let (ready, changed, ctx, session) = (',
    `            let initial = if self.initial {
                let lists = try_join_all(connections.iter().map(|(_, connection)| connection.tools(&stop)))
                    .await.map_err(|_| ErrorKind::PluginFailed("Initial MCP catalogue is unavailable".into()))?;
                publish_binding(ctx, self.session, &prefix, &connections, &lists, &sets, &stop)
                    .map_err(|_| ErrorKind::PluginFailed("Initial MCP catalogue publication failed".into()))?;
                Some(lists)
            } else { None };
            let (ready, changed, ctx, session) = (`
  ],
  [
    '                    let mut previous = None;',
    '                    let mut previous = initial;'
  ],
  [
    `                        let next = connections.iter().zip(&lists).map(|((id,connection),tools)| Arc::new(ToolSourceSet {
                            key: format!("{prefix}:{id}"), version: uuid::Uuid::new_v4().to_string(),
                            tools: tools.iter().map(|tool| contribution(id,tool,connection.clone(),stop.clone())).collect(),
                        })).collect();
                        *sets.lock().unwrap() = next;
                        ctx.emit(ToolProviderChanged { name: tool_provider_changes(session) }).map_err(|_| failed())?;`,
    '                        publish_binding(&ctx, session, &prefix, &connections, &lists, &sets, &stop)?;'
  ]
]) {
  if (mcpExpected.split(before).length !== 2)
    throw new Error('Native MCP owner factory seam changed')
  mcpExpected = mcpExpected.replace(before, after)
}
mcpExpected +=
  '\n' + (await readFile(path.join(root, 'resources/dim-sdk/mcp-initial-binding.rs'), 'utf8'))
const mcpExportsOriginal = git(['show', `HEAD:${mcpFile}`]) + '\n'
const mcpExportsExpected = mcpExportsOriginal + '\npub use temporary::mount_initial_binding;\n'
const mcpPatches = []
for (const [filename, original, expected] of [
  [temporaryMcpFile, mcpOriginal, mcpExpected],
  [mcpFile, mcpExportsOriginal, mcpExportsExpected]
]) {
  const current = await readFile(path.join(directory, filename), 'utf8')
  if (current !== original && current !== expected)
    throw new Error('Pinned native MCP owner has unexpected changes')
  if (current !== expected) await writeFile(path.join(directory, filename), expected)
  mcpPatches.push({ path: filename, sha256: createHash('sha256').update(expected).digest('hex') })
}
const titleOriginal = git(['show', `HEAD:${titleFile}`]) + '\n'
let titleExpected = titleOriginal
for (const [before, after] of [
  [
    '    builder.plugin(|names| Ok(Box::new(SessionTitlePlugin::new(names)?)));',
    `    dim_agent_runtime::names::register::<TitleModelHost>(builder.catalog_mut(), Some(dim_agent_runtime::SESSION_GROUP));
    builder.session_value(Arc::new(TitleModelHost(Arc::new(NoTitleModelPreference))));
    builder.plugin(|names| Ok(Box::new(SessionTitlePlugin::new(names)?)));`
  ],
  [
    '    auxiliary: Key<AuxiliaryModelHost>,',
    '    auxiliary: Key<AuxiliaryModelHost>,\n    preference: Key<TitleModelHost>,'
  ],
  [
    '            auxiliary: names.key()?,',
    '            auxiliary: names.key()?,\n            preference: names.key()?,'
  ],
  [
    '            self.auxiliary.erase(),',
    '            self.auxiliary.erase(),\n            self.preference.erase(),'
  ],
  [
    '                auxiliary: ctx.require_at(&self.auxiliary)?,',
    '                auxiliary: ctx.require_at(&self.auxiliary)?,\n                preference: ctx.require_at(&self.preference)?,'
  ],
  [
    '    auxiliary: Arc<AuxiliaryModelHost>,',
    '    auxiliary: Arc<AuxiliaryModelHost>,\n    preference: Arc<TitleModelHost>,'
  ],
  [
    '    ) -> Result<String, ()> {\n        if cancel.is_cancelled() {',
    `    ) -> Result<String, ()> {
        let explicit = match explicit {
            Some(model) => Some(model),
            None => self.preference.0.model(cancel.clone()).await.map_err(|_| ())?,
        };
        if cancel.is_cancelled() {`
  ]
]) {
  if (titleExpected.split(before).length !== 2)
    throw new Error('Native title preference seam changed')
  titleExpected = titleExpected.replace(before, after)
}
const titleExtension =
  '\n' + (await readFile(path.join(root, 'resources/dim-sdk/title-model-preference.rs'), 'utf8'))
const titlePrevious = titleExpected + titleExtension
for (const [before, after] of [
  [
    '    preference: Arc<TitleModelHost>,',
    '    preference: Arc<TitleModelHost>,\n    lifecycle: Arc<SessionLifecycle>,'
  ],
  [
    '                preference: ctx.require_at(&self.preference)?,',
    '                preference: ctx.require_at(&self.preference)?,\n                lifecycle: lifecycle.clone(),'
  ],
  [
    '    async fn attempt(&self, sequence: u64, input_id: String, epoch: u64) {',
    `    async fn attempt(&self, sequence: u64, input_id: String, epoch: u64) {
        let Some(_hold) = self.lifecycle.take_hold() else { return; };`
  ]
]) {
  if (titleExpected.split(before).length !== 2)
    throw new Error('Native title activity seam changed')
  titleExpected = titleExpected.replace(before, after)
}
titleExpected += titleExtension
const titleCurrent = await readFile(path.join(directory, titleFile), 'utf8')
if (
  titleCurrent !== titleOriginal &&
  titleCurrent !== titlePrevious &&
  titleCurrent !== titleExpected
)
  throw new Error('Pinned native title preference has unexpected changes')
if (titleCurrent !== titleExpected) await writeFile(path.join(directory, titleFile), titleExpected)
const decisionOriginal = git(['show', `HEAD:${decisionFile}`]) + '\n'
let decisionExpected = decisionOriginal
for (const [before, after] of [
  [
    '    pub probability_source: DecisionProbabilitySource,',
    '    pub probability_source: DecisionProbabilitySource,\n    pub fetch: Option<aimux_provider_utils::fetch::FetchFunction>,'
  ],
  [
    '            probability_source: DecisionProbabilitySource::Native,',
    '            probability_source: DecisionProbabilitySource::Native,\n            fetch: None,'
  ],
  [
    `        let response = aimux_provider_utils::post_json_to_api(
            HttpRequest::new(
                &self.config.endpoint,
                headers.into_iter().collect(),
                options,
            ),`,
    `        let mut request = HttpRequest::new(
            &self.config.endpoint,
            headers.into_iter().collect(),
            options,
        );
        request.fetch = self.config.fetch.clone();
        let response = aimux_provider_utils::post_json_to_api(
            request,`
  ]
]) {
  if (decisionExpected.split(before).length !== 2)
    throw new Error('Native Jev transport injection seam changed')
  decisionExpected = decisionExpected.replace(before, after)
}
const decisionCurrent = await readFile(path.join(directory, decisionFile), 'utf8')
if (decisionCurrent !== decisionOriginal && decisionCurrent !== decisionExpected)
  throw new Error('Pinned native Jev transport has unexpected changes')
if (decisionCurrent !== decisionExpected)
  await writeFile(path.join(directory, decisionFile), decisionExpected)
if (!docsPrepared) {
  const patch = path.join(root, 'resources/dim-sdk/generated-docs.patch')
  const body = await readFile(patch, 'utf8')
  const headers = [...body.matchAll(/^diff --git a\/(.+) b\/(.+)$/gm)]
  if (
    headers.length !== generatedPaths.length ||
    headers.some(
      (entry, index) => entry[1] !== generatedPaths[index] || entry[2] !== generatedPaths[index]
    )
  )
    throw new Error('Unexpected paths in generated dim architecture patch')
  if (docsPrevious)
    for (const [index, entry] of docStates.entries())
      await writeFile(path.join(directory, generatedDocs[index].path), entry.original)
  git(['apply', '--check', patch])
  git(['apply', patch])
}
for (const entry of generatedDocs) {
  if (digest(await readFile(path.join(directory, entry.path))) !== entry.sha256)
    throw new Error('Generated dim architecture checksum mismatch')
}
export const nativeSource = {
  sourceRevision: lock.sourceCommit,
  storeFormat: Number(
    (
      await readFile(path.join(directory, 'crates/dim-app-server/src/storage/sqlite.rs'), 'utf8')
    ).match(/pub const FORMAT: u32 = (\d+);/)?.[1]
  ),
  assemblyPatch: { path: filename, sha256: createHash('sha256').update(expected).digest('hex') },
  extensionPatches: [
    { path: assemblyFile, sha256: createHash('sha256').update(assemblyExpected).digest('hex') },
    { path: secretsFile, sha256: createHash('sha256').update(secretsExpected).digest('hex') },
    { path: servicesFile, sha256: createHash('sha256').update(servicesExpected).digest('hex') },
    { path: recordsFile, sha256: createHash('sha256').update(recordsExpected).digest('hex') },
    ...filePatches,
    ...mcpPatches,
    { path: titleFile, sha256: createHash('sha256').update(titleExpected).digest('hex') },
    { path: decisionFile, sha256: digest(decisionExpected) },
    { path: commandFile, sha256: digest(commandExpected) },
    ...generatedDocs.map(({ path, sha256 }) => ({ path, sha256 }))
  ]
}
