#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { lstat, readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import {
  compareFileNames,
  DARWIN_DISTRIBUTION_CHECK_NAMES,
  expectedReleaseAssetCount,
  getPublicRoles,
  getRoleDefinition,
  matchesRoleFileName,
  RELEASE_INDEX_SCHEMA_VERSION,
  SHA256_PATTERN,
  TARGET_DEFINITIONS,
  validateSourceSha
} from './package-contract.mjs'

const RELEASE_VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-(?:alpha|beta)\.\d+)?$/
const UPDATE_METADATA_NAMES = Object.freeze(
  [...new Set(TARGET_DEFINITIONS.map(({ metadataName }) => metadataName))].sort(
    compareFileNames
  )
)

function assertObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
  return value
}

function assertExactKeys(value, expectedKeys, label) {
  const actualKeys = Object.keys(value).sort()
  const sortedExpectedKeys = [...expectedKeys].sort()
  if (
    actualKeys.length !== sortedExpectedKeys.length ||
    actualKeys.some((key, index) => key !== sortedExpectedKeys[index])
  ) {
    throw new Error(
      `${label} fields must be exactly: ${sortedExpectedKeys.join(', ')}`
    )
  }
}

function validateReleaseIdentity(index, expected) {
  validateSourceSha(expected.sourceSha, 'release source SHA')
  if (
    typeof expected.version !== 'string' ||
    !RELEASE_VERSION_PATTERN.test(expected.version)
  ) {
    throw new Error('Release version has an unsupported format')
  }
  if (!/^\d+$/.test(String(expected.workflowRunId ?? ''))) {
    throw new Error('Workflow run ID must be numeric')
  }
  if (!/^\d+$/.test(String(expected.workflowRunAttempt ?? ''))) {
    throw new Error('Workflow run attempt must be numeric')
  }

  assertExactKeys(
    index,
    [
      'schemaVersion',
      'version',
      'sourceCommit',
      'generatedAt',
      'workflowRunId',
      'workflowRunAttempt',
      'targets',
      'assets'
    ],
    'release index'
  )
  if (index.schemaVersion !== RELEASE_INDEX_SCHEMA_VERSION) {
    throw new Error('Unsupported release index schema')
  }
  if (index.version !== expected.version || index.sourceCommit !== expected.sourceSha) {
    throw new Error('Release index source identity mismatch')
  }
  if (
    String(index.workflowRunId) !== String(expected.workflowRunId) ||
    String(index.workflowRunAttempt) !== String(expected.workflowRunAttempt)
  ) {
    throw new Error('Release index workflow identity mismatch')
  }
  if (
    typeof index.generatedAt !== 'string' ||
    !Number.isFinite(Date.parse(index.generatedAt)) ||
    new Date(index.generatedAt).toISOString() !== index.generatedAt
  ) {
    throw new Error('Release index generatedAt must be an ISO date')
  }
}

function validateReleaseTargets(index) {
  if (
    !Array.isArray(index.targets) ||
    index.targets.length !== TARGET_DEFINITIONS.length
  ) {
    throw new Error('Release index must contain exactly the six package targets')
  }
  for (const [targetIndex, definition] of TARGET_DEFINITIONS.entries()) {
    const target = assertObject(index.targets[targetIndex], `${definition.id} target`)
    assertExactKeys(target, ['id', 'platform', 'arch', 'checks'], `${definition.id} target`)
    if (
      target.id !== definition.id ||
      target.platform !== definition.platform ||
      target.arch !== definition.arch
    ) {
      throw new Error(`Release index target order or identity mismatch for ${definition.id}`)
    }
    const requiredChecks = ['packageSmoke', 'componentSize', 'installerSize']
    if (definition.platform === 'darwin') {
      requiredChecks.push(...DARWIN_DISTRIBUTION_CHECK_NAMES)
    }
    const checks = assertObject(target.checks, `${definition.id} checks`)
    assertExactKeys(checks, requiredChecks, `${definition.id} checks`)
    for (const check of requiredChecks) {
      if (checks[check] !== 'passed') {
        throw new Error(`${definition.id} check ${check} did not pass`)
      }
    }
  }
}

function validateIndexedAssets(index) {
  if (
    !Array.isArray(index.assets) ||
    index.assets.length !== expectedReleaseAssetCount() - 1
  ) {
    throw new Error(
      `Release index must describe exactly ${expectedReleaseAssetCount() - 1} assets`
    )
  }
  const expectedTargetRoles = new Set(
    TARGET_DEFINITIONS.flatMap((definition) =>
      getPublicRoles(definition).map(({ name }) => `${definition.id}\0${name}`)
    )
  )
  const expectedMetadata = new Set(UPDATE_METADATA_NAMES)
  const names = new Set()
  let previousName = null

  for (const [assetIndex, candidate] of index.assets.entries()) {
    const asset = assertObject(candidate, `release asset ${assetIndex}`)
    assertExactKeys(
      asset,
      ['name', 'bytes', 'sha256', 'target', 'role'],
      `release asset ${assetIndex}`
    )
    if (
      typeof asset.name !== 'string' ||
      asset.name.length === 0 ||
      path.basename(asset.name) !== asset.name ||
      names.has(asset.name)
    ) {
      throw new Error(`Release asset ${assetIndex} has an invalid or duplicate name`)
    }
    if (previousName !== null && compareFileNames(previousName, asset.name) >= 0) {
      throw new Error('Release index assets must be uniquely sorted by filename')
    }
    previousName = asset.name
    names.add(asset.name)
    if (!Number.isSafeInteger(asset.bytes) || asset.bytes < 0) {
      throw new Error(`${asset.name} has an invalid byte size`)
    }
    if (typeof asset.sha256 !== 'string' || !SHA256_PATTERN.test(asset.sha256)) {
      throw new Error(`${asset.name} has an invalid SHA-256 digest`)
    }

    if (asset.target === null) {
      if (asset.role !== 'update-metadata' || !expectedMetadata.delete(asset.name)) {
        throw new Error(`${asset.name} is not an expected updater metadata asset`)
      }
      continue
    }

    if (typeof asset.target !== 'string' || typeof asset.role !== 'string') {
      throw new Error(`${asset.name} has an invalid target or role`)
    }
    const definition = TARGET_DEFINITIONS.find(({ id }) => id === asset.target)
    if (!definition) {
      throw new Error(`${asset.name} references an unknown target ${asset.target}`)
    }
    const role = getRoleDefinition(definition, asset.role)
    const targetRole = `${definition.id}\0${role.name}`
    if (!role.public || !expectedTargetRoles.delete(targetRole)) {
      throw new Error(`${asset.name} has an unexpected or duplicate target role`)
    }
    if (!matchesRoleFileName(asset.name, role)) {
      throw new Error(`${asset.name} does not match ${definition.id}/${role.name}`)
    }
  }

  if (expectedTargetRoles.size > 0 || expectedMetadata.size > 0) {
    throw new Error('Release index is missing required target roles or updater metadata')
  }
  return index.assets
}

async function hashRegularFile(filePath, rootDirectory) {
  const stat = await lstat(filePath)
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`${filePath} must be a regular non-symlink file`)
  }
  const relative = path.relative(rootDirectory, filePath)
  if (
    !relative ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error(`${filePath} is outside the release directory`)
  }
  const hash = createHash('sha256')
  await new Promise((resolve, reject) => {
    const stream = createReadStream(filePath)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.once('error', reject)
    stream.once('end', resolve)
  })
  return { bytes: stat.size, sha256: hash.digest('hex') }
}

async function loadReleaseIndex(directory, expected) {
  const resolvedDirectory = path.resolve(directory)
  const directoryStat = await lstat(resolvedDirectory)
  if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) {
    throw new Error('Release assets path must be a non-symlink directory')
  }
  const indexPath = path.join(resolvedDirectory, 'release-index.json')
  const indexStat = await lstat(indexPath)
  if (
    !indexStat.isFile() ||
    indexStat.isSymbolicLink() ||
    indexStat.size <= 0 ||
    indexStat.size > 1024 * 1024
  ) {
    throw new Error('release-index.json must be a small regular non-symlink file')
  }
  const index = assertObject(
    JSON.parse(await readFile(indexPath, 'utf8')),
    'release index'
  )
  validateReleaseIdentity(index, expected)
  validateReleaseTargets(index)
  const assets = validateIndexedAssets(index)
  const indexDigest = await hashRegularFile(indexPath, resolvedDirectory)
  return {
    directory: resolvedDirectory,
    index,
    files: [
      ...assets,
      {
        name: 'release-index.json',
        bytes: indexDigest.bytes,
        sha256: indexDigest.sha256
      }
    ]
  }
}

export async function verifyReleaseAssets(options) {
  const release = await loadReleaseIndex(options.directory, options)
  const entries = await readdir(release.directory, { withFileTypes: true })
  const expectedNames = new Set(release.files.map(({ name }) => name))
  if (
    entries.length !== expectedReleaseAssetCount() ||
    entries.some(
      (entry) =>
        !expectedNames.has(entry.name) ||
        !entry.isFile() ||
        entry.isSymbolicLink()
    )
  ) {
    throw new Error(
      `Release directory must contain exactly ${expectedReleaseAssetCount()} indexed regular files`
    )
  }
  for (const expectedFile of release.files) {
    const actual = await hashRegularFile(
      path.join(release.directory, expectedFile.name),
      release.directory
    )
    if (
      actual.bytes !== expectedFile.bytes ||
      actual.sha256 !== expectedFile.sha256
    ) {
      throw new Error(`${expectedFile.name} does not match the release index`)
    }
  }
  return release
}

export function verifyGitHubDraftRelease({
  release,
  expectedFiles,
  tag,
  prerelease,
  allowPartialAssets = false
}) {
  const candidate = assertObject(release, 'GitHub release')
  if (
    candidate.tag_name !== tag ||
    candidate.draft !== true ||
    candidate.prerelease !== prerelease
  ) {
    throw new Error('GitHub release identity, draft, or prerelease state is invalid')
  }
  if (!Array.isArray(candidate.assets)) {
    throw new Error('GitHub release assets must be an array')
  }
  const expectedByName = new Map(expectedFiles.map((file) => [file.name, file]))
  const seenNames = new Set()
  for (const assetValue of candidate.assets) {
    const asset = assertObject(assetValue, 'GitHub release asset')
    if (
      typeof asset.name !== 'string' ||
      seenNames.has(asset.name) ||
      !expectedByName.has(asset.name)
    ) {
      throw new Error('GitHub draft contains an unknown or duplicate release asset')
    }
    seenNames.add(asset.name)
    if (asset.state !== 'uploaded') {
      throw new Error(`GitHub release asset ${asset.name} is not uploaded`)
    }
    if (!allowPartialAssets) {
      const expected = expectedByName.get(asset.name)
      if (
        asset.size !== expected.bytes ||
        asset.digest !== `sha256:${expected.sha256}`
      ) {
        throw new Error(`GitHub release asset ${asset.name} digest or size mismatch`)
      }
    }
  }
  if (!allowPartialAssets && seenNames.size !== expectedByName.size) {
    throw new Error(
      `GitHub draft must contain exactly ${expectedByName.size} release assets`
    )
  }
}

function parseArguments(argv) {
  const [command, ...argumentsToParse] = argv
  if (command !== 'local' && command !== 'remote') {
    throw new Error('Command must be local or remote')
  }
  const options = { command }
  const valueArguments = new Set([
    'directory',
    'source-sha',
    'version',
    'workflow-run-id',
    'workflow-run-attempt',
    'release-json',
    'tag',
    'prerelease'
  ])
  for (let index = 0; index < argumentsToParse.length; index += 1) {
    const argument = argumentsToParse[index]
    if (argument === '--allow-partial-assets') {
      options['allow-partial-assets'] = true
      continue
    }
    if (!argument.startsWith('--')) throw new Error(`Unexpected argument: ${argument}`)
    const [name, inlineValue] = argument.slice(2).split('=', 2)
    if (!valueArguments.has(name)) throw new Error(`Unknown argument: --${name}`)
    const value = inlineValue ?? argumentsToParse[++index]
    if (!value || value.startsWith('--')) throw new Error(`Missing value for --${name}`)
    options[name] = value
  }
  return options
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArguments(argv)
  for (const required of [
    'directory',
    'source-sha',
    'version',
    'workflow-run-id',
    'workflow-run-attempt'
  ]) {
    if (!options[required]) throw new Error(`--${required} is required`)
  }
  const identity = {
    directory: options.directory,
    sourceSha: options['source-sha'],
    version: options.version,
    workflowRunId: options['workflow-run-id'],
    workflowRunAttempt: options['workflow-run-attempt']
  }
  if (options.command === 'local') {
    const verified = await verifyReleaseAssets(identity)
    console.log(`[Release Assets] verified ${verified.files.length} local files`)
    return verified
  }
  for (const required of ['release-json', 'tag', 'prerelease']) {
    if (!options[required]) throw new Error(`--${required} is required`)
  }
  if (options.prerelease !== 'true' && options.prerelease !== 'false') {
    throw new Error('--prerelease must be true or false')
  }
  const indexed = await loadReleaseIndex(identity.directory, identity)
  const release = JSON.parse(await readFile(path.resolve(options['release-json']), 'utf8'))
  verifyGitHubDraftRelease({
    release,
    expectedFiles: indexed.files,
    tag: options.tag,
    prerelease: options.prerelease === 'true',
    allowPartialAssets: options['allow-partial-assets'] === true
  })
  console.log(
    `[Release Assets] verified GitHub draft with ${release.assets.length} assets`
  )
  return release
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    console.error(
      '[Release Assets] failed:',
      error instanceof Error ? error.message : error
    )
    process.exitCode = 1
  })
}
