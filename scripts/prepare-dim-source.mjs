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
// Enable that existing extension for this host only. No loop, model driver or queue is patched.
const filename = 'crates/dim-app-server/src/provider.rs'
const original = git(['show', `HEAD:${filename}`]) + '\n'
const before = 'Self::keyed(names, false, true)'
const after = 'Self::keyed(names, true, true)'
if (original.split(before).length !== 2) throw new Error('Native credential extension seam changed')
const expected = original.replace(before, after)
const current = await readFile(path.join(directory, filename), 'utf8')
if (current !== original && current !== expected)
  throw new Error('Pinned dim provider source has unexpected changes')
git(['diff', '--exit-code', '--', '.', `:!${filename}`])
if (current !== expected) await writeFile(path.join(directory, filename), expected)
export const nativeSource = {
  sourceRevision: lock.sourceCommit,
  assemblyPatch: { path: filename, sha256: createHash('sha256').update(expected).digest('hex') }
}
