#!/usr/bin/env node

import { copyFile, lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { Scalar, stringify } from 'yaml'

import {
  compareFileNames,
  expectedReleaseAssetCount,
  getPublicRoles,
  getRoleDefinition,
  getUpdaterPayloadRole,
  matchesRoleFileName,
  PACKAGE_MANIFEST_SCHEMA_VERSION,
  RELEASE_INDEX_SCHEMA_VERSION,
  TARGET_DEFINITIONS,
  validateSourceSha
} from './package-contract.mjs'
import {
  inspectRegularFile,
  parseYamlObject,
  resolveContainedRelativePath,
  validateManifestDigest
} from './package-files.mjs'
import {
  validateInstallerSizeReport,
  validateRawUpdateMetadata,
  validateSmokeReports
} from './package-manifest.mjs'

const RELEASE_VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-(?:alpha|beta)\.\d+)?$/

function assertObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
  return value
}

function assertExactKeys(value, allowedKeys, label) {
  const unexpectedKeys = Object.keys(value).filter((key) => !allowedKeys.includes(key))
  if (unexpectedKeys.length > 0) {
    throw new Error(`${label} has unexpected fields: ${unexpectedKeys.join(', ')}`)
  }
}

async function ensureEmptyDirectory(directory) {
  await mkdir(directory, { recursive: true })
  const entries = await readdir(directory)
  if (entries.length > 0) {
    throw new Error(`Release output directory must be empty: ${directory}`)
  }
}

function validateChecks(manifest, definition) {
  const checks = assertObject(manifest.checks, `${definition.id} checks`)
  const requiredChecks = ['packageSmoke', 'componentSize', 'installerSize']
  if (definition.platform === 'darwin') {
    requiredChecks.push('macAppDistribution', 'macDmgDistribution')
  }
  assertExactKeys(checks, requiredChecks, `${definition.id} checks`)
  for (const name of requiredChecks) {
    if (checks[name] !== 'passed') {
      throw new Error(`${definition.id} check ${name} did not pass`)
    }
  }
  return checks
}

function validateManifestIdentity(manifest, definition, expected) {
  assertObject(manifest, `${definition.id} manifest`)
  assertExactKeys(
    manifest,
    ['schemaVersion', 'target', 'source', 'build', 'checks', 'files', 'reports'],
    `${definition.id} manifest`
  )
  if (manifest.schemaVersion !== PACKAGE_MANIFEST_SCHEMA_VERSION) {
    throw new Error(`Unsupported manifest schema for ${definition.id}`)
  }
  const target = assertObject(manifest.target, `${definition.id} target`)
  assertExactKeys(target, ['id', 'platform', 'arch'], `${definition.id} target`)
  if (
    target.id !== definition.id ||
    target.platform !== definition.platform ||
    target.arch !== definition.arch
  ) {
    throw new Error(`Manifest target identity mismatch for ${definition.id}`)
  }
  const source = assertObject(manifest.source, `${definition.id} source`)
  assertExactKeys(source, ['commit', 'version'], `${definition.id} source`)
  if (source.commit !== expected.sourceSha || source.version !== expected.version) {
    throw new Error(`Manifest source identity mismatch for ${definition.id}`)
  }
  const build = assertObject(manifest.build, `${definition.id} build`)
  assertExactKeys(
    build,
    [
      'purpose',
      'electron',
      'electronBuilder',
      'workflowRunId',
      'workflowRunAttempt'
    ],
    `${definition.id} build`
  )
  if (build.purpose !== 'distribution') {
    throw new Error(`Release requires a distribution manifest for ${definition.id}`)
  }
  if (
    expected.workflowRunId &&
    String(build.workflowRunId ?? '') !== String(expected.workflowRunId)
  ) {
    throw new Error(`Workflow run identity mismatch for ${definition.id}`)
  }
  if (
    expected.workflowRunAttempt &&
    String(build.workflowRunAttempt ?? '') !== String(expected.workflowRunAttempt)
  ) {
    throw new Error(`Workflow run attempt mismatch for ${definition.id}`)
  }
  if (
    typeof build.electron !== 'string' ||
    build.electron.length === 0 ||
    typeof build.electronBuilder !== 'string' ||
    build.electronBuilder.length === 0
  ) {
    throw new Error(`${definition.id} manifest has invalid package toolchain versions`)
  }
}

async function validateManifestFiles(packageRoot, manifest, definition) {
  if (!Array.isArray(manifest.files)) {
    throw new Error(`${definition.id} manifest files must be an array`)
  }
  if (manifest.files.length !== definition.roles.length) {
    throw new Error(
      `${definition.id} manifest must contain ${definition.roles.length} files; found ${manifest.files.length}`
    )
  }
  const roleNames = new Set()
  const basenames = new Set()
  const validatedFiles = []
  for (const file of manifest.files) {
    assertObject(file, `${definition.id} manifest file`)
    assertExactKeys(
      file,
      ['role', 'name', 'storagePath', 'bytes', 'sha256'],
      `${definition.id}/${file.role ?? 'unknown'} file`
    )
    if (roleNames.has(file.role)) {
      throw new Error(`${definition.id} contains duplicate role ${file.role}`)
    }
    roleNames.add(file.role)
    const roleDefinition = getRoleDefinition(definition, file.role)
    if (!matchesRoleFileName(file.name, roleDefinition)) {
      throw new Error(`${definition.id}/${file.role} has unexpected filename ${file.name}`)
    }
    if (basenames.has(file.name)) {
      throw new Error(`${definition.id} contains duplicate basename ${file.name}`)
    }
    basenames.add(file.name)
    const expectedStoragePath = `${roleDefinition.directory}/${file.name}`
    if (file.storagePath !== expectedStoragePath) {
      throw new Error(
        `${definition.id}/${file.role} storage path mismatch: ${file.storagePath}`
      )
    }
    validateManifestDigest(file.sha256, `${definition.id}/${file.role} SHA-256`)
    if (!Number.isSafeInteger(file.bytes) || file.bytes < 0) {
      throw new Error(`${definition.id}/${file.role} byte size is invalid`)
    }
    const filePath = resolveContainedRelativePath(
      packageRoot,
      file.storagePath,
      `${definition.id}/${file.role} storage path`
    )
    const inspected = await inspectRegularFile(filePath, packageRoot)
    if (inspected.bytes !== file.bytes || inspected.sha256 !== file.sha256) {
      throw new Error(`${definition.id}/${file.role} manifest digest or size mismatch`)
    }
    validatedFiles.push({
      ...file,
      path: filePath,
      sha512: inspected.sha512,
      public: roleDefinition.public
    })
  }
  for (const roleDefinition of definition.roles) {
    if (!roleNames.has(roleDefinition.name)) {
      throw new Error(`${definition.id} is missing role ${roleDefinition.name}`)
    }
  }
  return validatedFiles
}

async function validateManifestReports(packageRoot, manifest, definition, files) {
  if (!Array.isArray(manifest.reports) || manifest.reports.length === 0) {
    throw new Error(`${definition.id} manifest must contain diagnostic reports`)
  }
  const names = new Set()
  const reports = []
  for (const report of manifest.reports) {
    assertObject(report, `${definition.id} report`)
    assertExactKeys(report, ['name', 'bytes', 'sha256'], `${definition.id} report`)
    if (
      typeof report.name !== 'string' ||
      path.basename(report.name) !== report.name ||
      names.has(report.name)
    ) {
      throw new Error(`${definition.id} report name is invalid or duplicated`)
    }
    names.add(report.name)
    validateManifestDigest(report.sha256, `${definition.id}/${report.name} SHA-256`)
    const reportPath = resolveContainedRelativePath(
      packageRoot,
      `reports/${report.name}`,
      `${definition.id}/${report.name} report path`
    )
    const inspected = await inspectRegularFile(reportPath, packageRoot)
    if (inspected.bytes !== report.bytes || inspected.sha256 !== report.sha256) {
      throw new Error(`${definition.id}/${report.name} report digest or size mismatch`)
    }
    reports.push({
      ...report,
      data: JSON.parse(await readFile(reportPath, 'utf8'))
    })
  }
  validateSmokeReports(reports, definition.id)
  const installerSizeReports = reports.filter(
    ({ data }) =>
      data?.schemaVersion === 1 &&
      data?.target === definition.id &&
      Array.isArray(data?.comparisons)
  )
  if (installerSizeReports.length !== 1) {
    throw new Error(
      `${definition.id} must contain exactly one installer-size report; found ${installerSizeReports.length}`
    )
  }
  const installerSizeReport = installerSizeReports[0].data
  validateInstallerSizeReport(
    installerSizeReport,
    definition.id,
    manifest.source.commit
  )
  for (const comparison of installerSizeReport.comparisons) {
    const packagedFile = files.find(({ role }) => role === comparison.role)
    if (
      !packagedFile ||
      comparison.candidate.name !== packagedFile.name ||
      comparison.candidate.bytes !== packagedFile.bytes ||
      comparison.candidate.sha256 !== packagedFile.sha256
    ) {
      throw new Error(
        `${definition.id}/${comparison.role} installer-size candidate does not match the package manifest`
      )
    }
  }
  return reports
}

async function validatePackageLayout(packageRoot, manifest, definition) {
  const rootStat = await lstat(packageRoot)
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error(`${definition.id} package artifact must be a non-symlink directory`)
  }
  const expectedRootEntries = new Map([
    ['files', 'directory'],
    ['manifest.json', 'file'],
    ['metadata', 'directory'],
    ['reports', 'directory']
  ])
  const rootEntries = await readdir(packageRoot, { withFileTypes: true })
  if (
    rootEntries.length !== expectedRootEntries.size ||
    rootEntries.some((entry) => {
      const expectedType = expectedRootEntries.get(entry.name)
      return (
        !expectedType ||
        (expectedType === 'file' && !entry.isFile()) ||
        (expectedType === 'directory' && !entry.isDirectory()) ||
        entry.isSymbolicLink()
      )
    })
  ) {
    throw new Error(`${definition.id} package artifact has an unexpected root layout`)
  }

  const expectedFiles = {
    files: manifest.files
      .filter(({ storagePath }) => storagePath.startsWith('files/'))
      .map(({ name }) => name),
    metadata: manifest.files
      .filter(({ storagePath }) => storagePath.startsWith('metadata/'))
      .map(({ name }) => name),
    reports: manifest.reports.map(({ name }) => name)
  }
  for (const [directoryName, expectedNames] of Object.entries(expectedFiles)) {
    const entries = await readdir(path.join(packageRoot, directoryName), {
      withFileTypes: true
    })
    const expectedNameSet = new Set(expectedNames)
    if (
      entries.length !== expectedNameSet.size ||
      entries.some(
        (entry) =>
          !expectedNameSet.has(entry.name) ||
          !entry.isFile() ||
          entry.isSymbolicLink()
      )
    ) {
      throw new Error(
        `${definition.id} package artifact has unexpected ${directoryName} entries`
      )
    }
  }
}

async function loadTargetPackage(artifactsDirectory, definition, expected) {
  const artifactRoot = path.join(path.resolve(artifactsDirectory), definition.artifactName)
  const manifestPath = path.join(artifactRoot, 'manifest.json')
  await inspectRegularFile(manifestPath, artifactRoot)
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  validateManifestIdentity(manifest, definition, expected)
  const checks = validateChecks(manifest, definition)
  const files = await validateManifestFiles(artifactRoot, manifest, definition)
  const reports = await validateManifestReports(
    artifactRoot,
    manifest,
    definition,
    files
  )
  await validatePackageLayout(artifactRoot, manifest, definition)
  const metadataFile = files.find(({ role }) => role === 'update-metadata')
  const updaterRole = getUpdaterPayloadRole(definition)
  const updaterPayload = files.find(({ role }) => role === updaterRole.name)
  const rawMetadata = validateRawUpdateMetadata({
    metadata: parseYamlObject(
      await readFile(metadataFile.path, 'utf8'),
      `${definition.id}/${metadataFile.name}`
    ),
    metadataName: metadataFile.name,
    target: definition,
    version: expected.version,
    updaterPayload
  })
  for (const sidecar of definition.roles.filter(({ sidecarFor }) => sidecarFor)) {
    const payload = files.find(({ role }) => role === sidecar.sidecarFor)
    const sidecarFile = files.find(({ role }) => role === sidecar.name)
    if (sidecarFile.name !== `${payload.name}.blockmap`) {
      throw new Error(`${definition.id} blockmap does not match ${payload.name}`)
    }
  }
  return {
    definition,
    manifest,
    checks,
    files,
    reports,
    rawMetadata
  }
}

function selectReleaseDate(packages) {
  const dates = packages.map(({ rawMetadata, definition }) => {
    const timestamp = Date.parse(rawMetadata.releaseDate ?? '')
    if (!Number.isFinite(timestamp)) {
      throw new Error(`${definition.id} updater metadata has an invalid releaseDate`)
    }
    return timestamp
  })
  return new Date(Math.max(...dates)).toISOString()
}

function selectSharedUpdateFields(packages) {
  const result = {}
  for (const field of [
    'releaseName',
    'releaseNotes',
    'stagingPercentage',
    'minimumSystemVersion'
  ]) {
    const values = packages.map(({ rawMetadata }) => rawMetadata[field])
    const serializedValues = new Set(
      values.map((value) => (value === undefined ? '<undefined>' : JSON.stringify(value)))
    )
    if (serializedValues.size !== 1) {
      throw new Error(`Updater metadata contains conflicting ${field}`)
    }
    if (values[0] !== undefined) {
      result[field] = values[0]
    }
  }
  return result
}

function mergeArchitectureMetadata(packages, version) {
  const sorted = [...packages].sort((left, right) =>
    left.definition.arch === right.definition.arch
      ? 0
      : left.definition.arch === 'x64'
        ? -1
        : 1
  )
  if (sorted.map(({ definition }) => definition.arch).join(',') !== 'x64,arm64') {
    throw new Error('Architecture metadata requires x64 and arm64 packages')
  }
  const files = sorted.map(({ rawMetadata }) => rawMetadata.files[0])
  const metadata = {
    version,
    files,
    path: files[0].url,
    sha512: files[0].sha512,
    releaseDate: selectReleaseDate(sorted),
    ...selectSharedUpdateFields(sorted)
  }
  return metadata
}

function normalizeSingleArchitectureMetadata(packageEntry, version) {
  const file = packageEntry.rawMetadata.files[0]
  const metadata = {
    version,
    files: [file],
    path: file.url,
    sha512: file.sha512,
    releaseDate: selectReleaseDate([packageEntry]),
    ...selectSharedUpdateFields([packageEntry])
  }
  return metadata
}

async function writeMetadata(outputDirectory, name, metadata) {
  const outputPath = path.join(outputDirectory, name)
  // electron-updater parses updater yml with js-yaml, which turns an unquoted ISO
  // timestamp into a Date object. The app's typed-IPC zod contract requires
  // releaseDate to be a string, so force-quote it to guarantee a string round-trip
  // under js-yaml. The `yaml` package used here does not quote ISO timestamps by
  // default, unlike js-yaml's dump — this mismatch previously broke auto-update.
  const serializable = { ...metadata }
  if (typeof serializable.releaseDate === 'string') {
    const quotedReleaseDate = new Scalar(serializable.releaseDate)
    quotedReleaseDate.type = 'QUOTE_SINGLE'
    serializable.releaseDate = quotedReleaseDate
  }
  await writeFile(outputPath, stringify(serializable), 'utf8')
  const inspected = await inspectRegularFile(outputPath, outputDirectory)
  return {
    name,
    bytes: inspected.bytes,
    sha256: inspected.sha256
  }
}

async function validateFinalMetadata(outputDirectory, name, publicAssets) {
  const metadataPath = path.join(outputDirectory, name)
  const metadata = parseYamlObject(await readFile(metadataPath, 'utf8'), name)
  const expectedEntries =
    name === 'latest-linux.yml' || name === 'latest-linux-arm64.yml' ? 1 : 2
  if (!Array.isArray(metadata.files) || metadata.files.length !== expectedEntries) {
    throw new Error(`${name} must contain ${expectedEntries} updater files`)
  }
  for (const file of metadata.files) {
    const publicAsset = publicAssets.find(({ name: assetName }) => assetName === file.url)
    if (!publicAsset) {
      throw new Error(`${name} references missing release asset ${file.url}`)
    }
    if (
      file.size !== publicAsset.bytes ||
      file.sha512 !== publicAsset.sha512 ||
      typeof publicAsset.sha512 !== 'string'
    ) {
      throw new Error(`${name} digest or size mismatch for ${file.url}`)
    }
  }
  const first = metadata.files[0]
  if (metadata.path !== first.url || metadata.sha512 !== first.sha512) {
    throw new Error(`${name} legacy updater fields must select the first architecture`)
  }
  if (
    name === 'latest-mac.yml' &&
    metadata.files.some(({ url }) => typeof url === 'string' && url.endsWith('.dmg'))
  ) {
    throw new Error('latest-mac.yml must not contain a DMG updater entry')
  }
}

export async function assembleRelease({
  artifactsDirectory,
  outputDirectory,
  sourceSha,
  version,
  workflowRunId,
  workflowRunAttempt,
  generatedAt = new Date().toISOString()
}) {
  validateSourceSha(sourceSha, 'release source SHA')
  if (typeof version !== 'string' || !RELEASE_VERSION_PATTERN.test(version)) {
    throw new Error('Release version has an unsupported format')
  }
  if (
    typeof generatedAt !== 'string' ||
    !Number.isFinite(Date.parse(generatedAt)) ||
    new Date(generatedAt).toISOString() !== generatedAt
  ) {
    throw new Error('Release index generatedAt must be an ISO date')
  }
  if (workflowRunId !== undefined && !/^\d+$/.test(String(workflowRunId))) {
    throw new Error('Workflow run ID must be numeric')
  }
  if (workflowRunAttempt !== undefined && !/^\d+$/.test(String(workflowRunAttempt))) {
    throw new Error('Workflow run attempt must be numeric')
  }
  if (
    (workflowRunId === undefined || workflowRunId === '') !==
    (workflowRunAttempt === undefined || workflowRunAttempt === '')
  ) {
    throw new Error('Workflow run ID and attempt must be provided together')
  }
  const resolvedArtifactsDirectory = path.resolve(artifactsDirectory)
  const artifactEntries = await readdir(resolvedArtifactsDirectory, {
    withFileTypes: true
  })
  const expectedArtifactNames = new Set(
    TARGET_DEFINITIONS.map(({ artifactName }) => artifactName)
  )
  if (
    artifactEntries.length !== expectedArtifactNames.size ||
    artifactEntries.some(
      (entry) =>
        !expectedArtifactNames.has(entry.name) ||
        !entry.isDirectory() ||
        entry.isSymbolicLink()
    )
  ) {
    throw new Error('Release input must contain exactly the six package artifacts')
  }
  const expected = { sourceSha, version, workflowRunId, workflowRunAttempt }
  const packages = []
  for (const definition of TARGET_DEFINITIONS) {
    packages.push(
      await loadTargetPackage(resolvedArtifactsDirectory, definition, expected)
    )
  }
  const toolchains = new Set(
    packages.map(
      ({ manifest }) => `${manifest.build.electron}\0${manifest.build.electronBuilder}`
    )
  )
  if (toolchains.size !== 1) {
    throw new Error('Package manifests were built with inconsistent toolchain versions')
  }

  const outputPath = path.resolve(outputDirectory)
  await ensureEmptyDirectory(outputPath)
  const publicAssets = []
  const publicNames = new Set()
  for (const packageEntry of packages) {
    for (const roleDefinition of getPublicRoles(packageEntry.definition)) {
      const file = packageEntry.files.find(({ role }) => role === roleDefinition.name)
      if (publicNames.has(file.name)) {
        throw new Error(`Release contains duplicate public filename ${file.name}`)
      }
      publicNames.add(file.name)
      const stagedPath = path.join(outputPath, file.name)
      await copyFile(file.path, stagedPath)
      const staged = await inspectRegularFile(stagedPath, outputPath)
      if (staged.bytes !== file.bytes || staged.sha256 !== file.sha256) {
        throw new Error(`Release staging changed ${file.name}`)
      }
      publicAssets.push({
        name: file.name,
        bytes: staged.bytes,
        sha256: staged.sha256,
        sha512: staged.sha512,
        target: packageEntry.definition.id,
        role: file.role
      })
    }
  }

  const windows = packages.filter(({ definition }) => definition.platform === 'win32')
  const macOS = packages.filter(({ definition }) => definition.platform === 'darwin')
  const linuxX64 = packages.find(({ definition }) => definition.id === 'linux-x64')
  const linuxArm64 = packages.find(({ definition }) => definition.id === 'linux-arm64')
  const metadataAssets = await Promise.all([
    writeMetadata(outputPath, 'latest.yml', mergeArchitectureMetadata(windows, version)),
    writeMetadata(outputPath, 'latest-mac.yml', mergeArchitectureMetadata(macOS, version)),
    writeMetadata(
      outputPath,
      'latest-linux.yml',
      normalizeSingleArchitectureMetadata(linuxX64, version)
    ),
    writeMetadata(
      outputPath,
      'latest-linux-arm64.yml',
      normalizeSingleArchitectureMetadata(linuxArm64, version)
    )
  ])
  for (const metadataAsset of metadataAssets) {
    if (publicNames.has(metadataAsset.name)) {
      throw new Error(`Release contains duplicate metadata name ${metadataAsset.name}`)
    }
    publicNames.add(metadataAsset.name)
    publicAssets.push({
      ...metadataAsset,
      target: null,
      role: 'update-metadata'
    })
  }
  await Promise.all(
    metadataAssets.map(({ name }) => validateFinalMetadata(outputPath, name, publicAssets))
  )

  if (publicAssets.length !== expectedReleaseAssetCount() - 1) {
    throw new Error(
      `Release must contain ${expectedReleaseAssetCount() - 1} assets before its index; found ${publicAssets.length}`
    )
  }
  const releaseIndexAssets = publicAssets
    .map(({ sha512: _sha512, ...asset }) => asset)
    .sort((left, right) => compareFileNames(left.name, right.name))
  const releaseIndex = {
    schemaVersion: RELEASE_INDEX_SCHEMA_VERSION,
    version,
    sourceCommit: sourceSha,
    generatedAt,
    ...(workflowRunId ? { workflowRunId: String(workflowRunId) } : {}),
    ...(workflowRunAttempt
      ? { workflowRunAttempt: String(workflowRunAttempt) }
      : {}),
    targets: packages.map(({ definition, checks }) => ({
      id: definition.id,
      platform: definition.platform,
      arch: definition.arch,
      checks: {
        packageSmoke: checks.packageSmoke,
        componentSize: checks.componentSize,
        installerSize: checks.installerSize,
        ...(definition.platform === 'darwin'
          ? {
              macAppDistribution: checks.macAppDistribution,
              macDmgDistribution: checks.macDmgDistribution
            }
          : {})
      }
    })),
    assets: releaseIndexAssets
  }
  const indexPath = path.join(outputPath, 'release-index.json')
  await writeFile(indexPath, `${JSON.stringify(releaseIndex, null, 2)}\n`, 'utf8')

  const finalEntries = await readdir(outputPath, { withFileTypes: true })
  if (
    finalEntries.length !== expectedReleaseAssetCount() ||
    finalEntries.some((entry) => !entry.isFile())
  ) {
    throw new Error(
      `Release directory must contain exactly ${expectedReleaseAssetCount()} regular files`
    )
  }
  return releaseIndex
}

function parseArguments(argv) {
  const options = {}
  const allowedArguments = new Set([
    'artifacts-dir',
    'output-dir',
    'source-sha',
    'version',
    'workflow-run-id',
    'workflow-run-attempt'
  ])
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (!argument.startsWith('--')) throw new Error(`Unexpected argument: ${argument}`)
    const [name, inlineValue] = argument.slice(2).split('=', 2)
    if (!allowedArguments.has(name)) throw new Error(`Unknown argument: --${name}`)
    const value = inlineValue ?? argv[++index]
    if (!value || value.startsWith('--')) throw new Error(`Missing value for --${name}`)
    options[name] = value
  }
  return options
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArguments(argv)
  for (const required of ['artifacts-dir', 'output-dir', 'source-sha', 'version']) {
    if (!options[required]) throw new Error(`--${required} is required`)
  }
  const releaseIndex = await assembleRelease({
    artifactsDirectory: path.resolve(options['artifacts-dir']),
    outputDirectory: path.resolve(options['output-dir']),
    sourceSha: options['source-sha'],
    version: options.version,
    workflowRunId: options['workflow-run-id'],
    workflowRunAttempt: options['workflow-run-attempt']
  })
  console.log(
    `[Release Assembly] prepared ${releaseIndex.assets.length + 1} verified assets`
  )
  return releaseIndex
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    console.error(
      '[Release Assembly] failed:',
      error instanceof Error ? error.message : error
    )
    process.exitCode = 1
  })
}
