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
// No loop, model driver or queue is patched; only opaque references enter native storage.
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
const expected = headersExpected.replace(
  activityBefore,
  `    /// Whether this owner has accepted work that has not settled yet.
    pub fn has_active_work(&self) -> bool {
        self.tasks.len() > 0
    }
${activityBefore}`
)
const current = await readFile(path.join(directory, filename), 'utf8')
if (
  current !== original &&
  current !== assembled &&
  current !== headersExpected &&
  current !== expected
)
  throw new Error('Pinned dim provider source has unexpected changes')
const assemblyFile = 'crates/dim-agent-runtime/src/assembly.rs'
const secretsFile = 'crates/dim-app-server/src/provider/secrets.rs'
const servicesFile = 'crates/dim-app-server/src/lib.rs'
const recordsFile = 'crates/dim-app-server/src/agent_records.rs'
git([
  'diff',
  '--exit-code',
  '--',
  '.',
  `:!${filename}`,
  `:!${assemblyFile}`,
  `:!${secretsFile}`,
  `:!${servicesFile}`,
  `:!${recordsFile}`
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
    { path: recordsFile, sha256: createHash('sha256').update(recordsExpected).digest('hex') }
  ]
}
