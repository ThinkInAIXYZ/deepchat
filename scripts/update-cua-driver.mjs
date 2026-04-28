import { execFileSync, spawnSync } from 'child_process'
import fs from 'fs/promises'
import fsSync from 'fs'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = process.env.DEEPCHAT_ROOT_DIR
  ? path.resolve(process.env.DEEPCHAT_ROOT_DIR)
  : path.resolve(__dirname, '..')
const vendorRoot = process.env.DEEPCHAT_CUA_VENDOR_ROOT
  ? path.resolve(process.env.DEEPCHAT_CUA_VENDOR_ROOT)
  : path.join(rootDir, 'vendor', 'cua-driver')
const vendorSourceDir = path.join(vendorRoot, 'source')
const metadataPath = path.join(vendorRoot, 'upstream.json')

function parseArgs(argv) {
  const args = new Map()
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (!arg.startsWith('--')) {
      continue
    }
    const key = arg.slice(2)
    const next = argv[index + 1]
    if (next && !next.startsWith('--')) {
      args.set(key, next)
      index += 1
    } else {
      args.set(key, 'true')
    }
  }
  return args
}

function run(command, args, options = {}) {
  console.log(`$ ${command} ${args.join(' ')}`)
  execFileSync(command, args, {
    cwd: rootDir,
    stdio: 'inherit',
    ...options
  })
}

function read(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: rootDir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options
  }).trim()
}

function readAllowingDiff(command, args, options = {}) {
  try {
    return read(command, args, options)
  } catch {
    if (error && typeof error === 'object' && 'status' in error && error.status === 1) {
      return String(error.stdout ?? '').trimEnd()
    }
    throw error
  }
}

function ensureTool(command, args = ['--version']) {
  const result = spawnSync(command, args, { stdio: 'ignore' })
  if (result.error) {
    throw new Error(`Required tool is missing: ${command}`)
  }
}

async function readMetadata() {
  const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf8'))
  const requiredFields = ['upstreamRepo', 'upstreamSubdir', 'tag', 'commit', 'version', 'updatedAt']
  for (const field of requiredFields) {
    if (typeof metadata[field] !== 'string' || metadata[field].length === 0) {
      throw new Error(`CUA upstream metadata is missing required string field: ${field}`)
    }
  }
  return metadata
}

async function copySource(from, to) {
  await fs.rm(to, { recursive: true, force: true })
  await fs.mkdir(path.dirname(to), { recursive: true })
  await fs.cp(from, to, {
    recursive: true,
    filter: (source) => {
      const name = path.basename(source)
      return name !== '.git' && name !== '.build'
    }
  })
}

async function cloneUpstream(repoUrl, targetDir) {
  run('git', ['clone', '--filter=blob:none', '--no-checkout', repoUrl, targetDir])
  run('git', ['fetch', '--tags', 'origin'], { cwd: targetDir })
}

async function exportUpstreamSource(repoDir, commit, subdir, targetDir) {
  run('git', ['checkout', '--force', commit], { cwd: repoDir })
  const sourceDir = path.join(repoDir, subdir)
  if (!fsSync.existsSync(sourceDir)) {
    throw new Error(`Upstream source subdir does not exist at ${commit}: ${subdir}`)
  }
  await copySource(sourceDir, targetDir)
}

async function createDeltaPatch(oldSourceDir, currentSourceDir, patchPath) {
  const patchRepo = path.join(path.dirname(patchPath), 'delta-repo')
  const patchSource = path.join(patchRepo, 'source')
  await fs.rm(patchRepo, { recursive: true, force: true })
  await fs.mkdir(patchRepo, { recursive: true })
  run('git', ['init'], { cwd: patchRepo })
  run('git', ['config', 'user.email', 'deepchat@example.invalid'], { cwd: patchRepo })
  run('git', ['config', 'user.name', 'DeepChat CUA Vendor'], { cwd: patchRepo })
  run('git', ['config', 'commit.gpgsign', 'false'], { cwd: patchRepo })

  await copySource(oldSourceDir, patchSource)
  run('git', ['add', 'source'], { cwd: patchRepo })
  run('git', ['commit', '-m', 'upstream base'], { cwd: patchRepo })
  await fs.rm(patchSource, { recursive: true, force: true })
  await copySource(currentSourceDir, patchSource)

  const patch = readAllowingDiff('git', ['diff', '--binary', '--', 'source'], { cwd: patchRepo })
  await fs.writeFile(patchPath, patch ? `${patch}\n` : '')
  return patch
}

async function applyPatchToCandidate(oldSourceDir, newSourceDir, patchPath) {
  const candidateRoot = path.join(path.dirname(patchPath), 'candidate')
  const candidateSource = path.join(candidateRoot, 'source')
  await fs.rm(candidateRoot, { recursive: true, force: true })
  await fs.mkdir(candidateRoot, { recursive: true })
  run('git', ['init'], { cwd: candidateRoot })
  run('git', ['config', 'user.email', 'deepchat@example.invalid'], { cwd: candidateRoot })
  run('git', ['config', 'user.name', 'DeepChat CUA Vendor'], { cwd: candidateRoot })
  run('git', ['config', 'commit.gpgsign', 'false'], { cwd: candidateRoot })
  await copySource(oldSourceDir, candidateSource)
  run('git', ['add', 'source'], { cwd: candidateRoot })
  run('git', ['commit', '-m', 'upstream base'], { cwd: candidateRoot })
  await fs.rm(candidateSource, { recursive: true, force: true })
  await copySource(newSourceDir, candidateSource)
  run('git', ['add', 'source'], { cwd: candidateRoot })
  run('git', ['commit', '-m', 'candidate upstream'], { cwd: candidateRoot })

  if ((await fs.stat(patchPath)).size === 0) {
    return candidateSource
  }

  try {
    run('git', ['apply', '--3way', '--whitespace=nowarn', patchPath], { cwd: candidateRoot })
  } catch (error) {
    const conflicts = readAllowingDiff(
      'git',
      ['diff', '--name-only', '--diff-filter=U', '--', 'source'],
      { cwd: candidateRoot }
    )
    const conflictError = new Error(
      `Conflicts detected while applying DeepChat CUA delta.${conflicts ? `\nConflicts:\n${conflicts}` : ''}`
    )
    conflictError.candidateSource = candidateSource
    throw conflictError
  }
  return candidateSource
}

function requireTarget(args) {
  const tag = args.get('tag')
  const commit = args.get('commit')
  if (!tag || !commit) {
    throw new Error('Usage: pnpm run cua:update -- --tag <tag> --commit <sha> [--dry-run]')
  }
  return { tag, commit }
}

async function diffUpstream(metadata, args) {
  const repoUrl = args.get('repo') ?? metadata.upstreamRepo
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'deepchat-cua-diff-'))
  const repoDir = path.join(tempRoot, 'repo')
  const oldSourceDir = path.join(tempRoot, 'old-source')
  const patchPath = path.join(tempRoot, 'deepchat-cua-delta.patch')

  await cloneUpstream(repoUrl, repoDir)
  await exportUpstreamSource(repoDir, metadata.commit, metadata.upstreamSubdir, oldSourceDir)
  const patch = await createDeltaPatch(oldSourceDir, vendorSourceDir, patchPath)
  process.stdout.write(patch ? `${patch}\n` : '')
}

async function updateUpstream(metadata, args) {
  const { tag, commit } = requireTarget(args)
  const dryRun = args.get('dry-run') === 'true'
  const repoUrl = args.get('repo') ?? metadata.upstreamRepo
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'deepchat-cua-update-'))
  const repoDir = path.join(tempRoot, 'repo')
  const oldSourceDir = path.join(tempRoot, 'old-source')
  const newSourceDir = path.join(tempRoot, 'new-source')
  const patchPath = path.join(tempRoot, 'deepchat-cua-delta.patch')

  await cloneUpstream(repoUrl, repoDir)
  await exportUpstreamSource(repoDir, metadata.commit, metadata.upstreamSubdir, oldSourceDir)
  await exportUpstreamSource(repoDir, commit, metadata.upstreamSubdir, newSourceDir)
  const patch = await createDeltaPatch(oldSourceDir, vendorSourceDir, patchPath)

  let candidateSource
  try {
    candidateSource = await applyPatchToCandidate(oldSourceDir, newSourceDir, patchPath)
  } catch (error) {
    if (!dryRun && error && typeof error === 'object' && 'candidateSource' in error) {
      await copySource(error.candidateSource, vendorSourceDir)
    }
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(
      dryRun
        ? `Dry-run detected conflicts while applying DeepChat CUA delta.${message.includes('\n') ? `\n${message.split('\n').slice(1).join('\n')}` : ''}`
        : `CUA update left merge conflicts in vendor/cua-driver/source.${message.includes('\n') ? `\n${message.split('\n').slice(1).join('\n')}` : ''}\nResolve them, run validation, then update vendor/cua-driver/upstream.json if needed.`
    )
  }

  if (dryRun) {
    console.log(
      `Dry-run passed. DeepChat CUA delta ${patch ? 'applies' : 'is empty'} against ${tag} (${commit}).`
    )
    return
  }

  await copySource(candidateSource, vendorSourceDir)
  await fs.writeFile(
    metadataPath,
    `${JSON.stringify(
      {
        ...metadata,
        upstreamRepo: repoUrl,
        tag,
        commit,
        version: tag.replace(/^cua-driver-v/, ''),
        updatedAt: new Date().toISOString().slice(0, 10)
      },
      null,
      2
    )}\n`
  )
  console.log(`Updated vendored CUA Driver to ${tag} (${commit}).`)
}

async function main() {
  ensureTool('git')
  const args = parseArgs(process.argv.slice(2))
  const metadata = await readMetadata()

  if (args.get('diff-upstream') === 'true') {
    await diffUpstream(metadata, args)
    return
  }

  await updateUpstream(metadata, args)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
