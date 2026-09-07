#!/usr/bin/env node

import { execFile } from 'node:child_process'
import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile
} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'

import { validateAppleTeamId } from '../apple-notarization.js'
import { verifyDmgDistribution } from '../notarize-dmg.js'
import { verifyCuaMacHelperDistribution } from './verify-cua-macos-helper.mjs'
import {
  createDefaultPackageSizePolicy,
  DARWIN_DISTRIBUTION_CHECK_NAMES,
  getMeasuredRoles,
  getTargetDefinition,
  getUpdaterPayloadRole,
  PACKAGE_MANIFEST_SCHEMA_VERSION,
  resolvePackageSizeExpectedDelta,
  SHA512_BASE64_PATTERN,
  SOURCE_SHA_PATTERN,
  targetId,
  validateArtifactPurpose,
  validateSourceSha
} from './package-contract.mjs'
import {
  findRoleFile,
  inspectRegularFile,
  parseYamlObject
} from './package-files.mjs'

const execFileAsync = promisify(execFile)
const COMMAND_OUTPUT_LIMIT = 4 * 1024 * 1024

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

function assertNonEmptyString(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string`)
  }
  return value
}

function optionalNumericString(value, label) {
  if (value === undefined || value === null || value === '') return undefined
  if (!/^\d+$/.test(String(value))) {
    throw new Error(`${label} must be numeric`)
  }
  return String(value)
}

function requireDeveloperIdMetadata(result, label) {
  const metadata = `${result?.stdout ?? ''}\n${result?.stderr ?? ''}`
  if (!/^Authority=Developer ID Application:/m.test(metadata)) {
    throw new Error(`${label} is not signed with a Developer ID Application certificate`)
  }
  const timestamp = metadata.match(/^Timestamp=(.+)$/m)?.[1]?.trim()
  if (!timestamp || timestamp.toLowerCase() === 'none') {
    throw new Error(`${label} Developer ID signature does not contain a secure timestamp`)
  }
}

async function runDistributionCommand(runCommand, command, args) {
  return await runCommand(command, args, {
    encoding: 'utf8',
    maxBuffer: COMMAND_OUTPUT_LIMIT
  })
}

export async function verifyMacAppDistribution(
  appPath,
  { teamId, runCommand = execFileAsync } = {}
) {
  const validatedTeamId = validateAppleTeamId(
    assertNonEmptyString(teamId, 'Apple team ID'),
    'Apple team ID'
  )
  await runDistributionCommand(runCommand, '/usr/bin/codesign', [
    '--verify',
    '--deep',
    '--strict',
    '--verbose=2',
    appPath
  ])
  const metadata = await runDistributionCommand(runCommand, '/usr/bin/codesign', [
    '--display',
    '--verbose=4',
    appPath
  ])
  requireDeveloperIdMetadata(metadata, 'macOS application')
  await runDistributionCommand(runCommand, '/usr/bin/codesign', [
    '--verify',
    '--deep',
    '--strict',
    '--test-requirement',
    `=anchor apple generic and certificate leaf[subject.OU] = "${validatedTeamId}"`,
    appPath
  ])
  await runDistributionCommand(runCommand, '/usr/bin/xcrun', [
    'stapler',
    'validate',
    '-v',
    appPath
  ])
  await runDistributionCommand(runCommand, '/usr/sbin/spctl', [
    '--assess',
    '--type',
    'execute',
    '--verbose=4',
    appPath
  ])
  await runDistributionCommand(runCommand, '/usr/bin/syspolicy_check', [
    'distribution',
    appPath
  ])
}

export function validateMacZipEntries(output) {
  if (typeof output !== 'string') {
    throw new TypeError('macOS updater ZIP entry list must be a string')
  }
  const entries = output.split(/\r?\n/).filter((entry) => entry.length > 0)
  if (entries.length === 0) {
    throw new Error('macOS updater ZIP must not be empty')
  }

  const seenEntries = new Set()
  for (const entry of entries) {
    const normalizedEntry = entry.endsWith('/') ? entry.slice(0, -1) : entry
    const segments = normalizedEntry.split('/')
    if (
      normalizedEntry.length === 0 ||
      normalizedEntry.includes('\0') ||
      normalizedEntry.includes('\\') ||
      path.posix.isAbsolute(normalizedEntry) ||
      /^[A-Za-z]:/.test(normalizedEntry) ||
      segments.some((segment) => segment === '' || segment === '.' || segment === '..') ||
      segments[0] !== 'DeepChat.app'
    ) {
      throw new Error(`macOS updater ZIP contains an unsafe entry: ${JSON.stringify(entry)}`)
    }
    if (seenEntries.has(normalizedEntry)) {
      throw new Error(`macOS updater ZIP contains a duplicate entry: ${normalizedEntry}`)
    }
    seenEntries.add(normalizedEntry)
  }
  return entries
}

export async function verifyMacZipDistribution(
  zipPath,
  {
    teamId,
    runCommand = execFileAsync,
    verifyMacApp = verifyMacAppDistribution,
    verifyCuaMacHelper = verifyCuaMacHelperDistribution
  } = {}
) {
  const zipEntries = await runDistributionCommand(runCommand, '/usr/bin/unzip', [
    '-Z1',
    zipPath
  ])
  validateMacZipEntries(zipEntries.stdout)
  const extractionRoot = await mkdtemp(
    path.join(os.tmpdir(), 'deepchat-macos-update-zip-')
  )
  let verificationError
  try {
    await runDistributionCommand(runCommand, '/usr/bin/ditto', [
      '-x',
      '-k',
      zipPath,
      extractionRoot
    ])
    const entries = await readdir(extractionRoot, { withFileTypes: true })
    if (
      entries.length !== 1 ||
      entries[0].name !== 'DeepChat.app' ||
      !entries[0].isDirectory()
    ) {
      throw new Error('macOS updater ZIP must contain exactly one root DeepChat.app directory')
    }

    const extractedAppPath = path.join(extractionRoot, 'DeepChat.app')
    const appStat = await lstat(extractedAppPath)
    if (appStat.isSymbolicLink() || !appStat.isDirectory()) {
      throw new Error(
        'macOS updater ZIP root DeepChat.app must be a real application directory'
      )
    }
    await verifyCuaMacHelper(extractedAppPath, { teamId, runCommand })
    await verifyMacApp(extractedAppPath, { teamId, runCommand })
  } catch (error) {
    verificationError = error
  }
  try {
    await rm(extractionRoot, { recursive: true, force: true })
  } catch (cleanupError) {
    if (verificationError) {
      throw new AggregateError(
        [verificationError, cleanupError],
        'macOS updater ZIP verification failed and extraction cleanup was incomplete'
      )
    }
    throw cleanupError
  }
  if (verificationError) {
    throw verificationError
  }
  return true
}

function normalizeMetadataFiles(metadata, label) {
  if (!Array.isArray(metadata.files) || metadata.files.length !== 1) {
    throw new Error(`${label} must contain exactly one updater file`)
  }
  const file = metadata.files[0]
  if (!file || typeof file !== 'object' || Array.isArray(file)) {
    throw new Error(`${label} updater file must be an object`)
  }
  const allowedFileFields = new Set([
    'url',
    'sha512',
    'size',
    'blockMapSize',
    'isAdminRightsRequired'
  ])
  const unexpectedFileFields = Object.keys(file).filter(
    (name) => !allowedFileFields.has(name)
  )
  if (unexpectedFileFields.length > 0) {
    throw new Error(
      `${label} updater file has unsupported fields: ${unexpectedFileFields.join(', ')}`
    )
  }
  return file
}

function normalizeReleaseNotes(value, label) {
  if (value === undefined || value === null) return undefined
  if (typeof value === 'string') return value
  if (!Array.isArray(value)) {
    throw new Error(`${label} releaseNotes must be a string or an array`)
  }
  return value.map((entry, index) => {
    if (
      !entry ||
      typeof entry !== 'object' ||
      Array.isArray(entry) ||
      Object.keys(entry).some((name) => name !== 'version' && name !== 'note') ||
      typeof entry.version !== 'string' ||
      entry.version.length === 0 ||
      (entry.note !== null && typeof entry.note !== 'string')
    ) {
      throw new Error(`${label} releaseNotes[${index}] is invalid`)
    }
    return { version: entry.version, note: entry.note }
  })
}

export function validateRawUpdateMetadata({
  metadata,
  metadataName,
  target,
  version,
  updaterPayload
}) {
  const definition =
    typeof target === 'string' ? getTargetDefinition(target) : getTargetDefinition(target.id)
  if (metadataName !== definition.metadataName) {
    throw new Error(
      `Unexpected updater metadata name for ${definition.id}: ${metadataName}`
    )
  }
  const allowedMetadataFields = new Set([
    'version',
    'files',
    'path',
    'sha512',
    'releaseDate',
    'releaseName',
    'releaseNotes',
    'stagingPercentage',
    'minimumSystemVersion'
  ])
  const unexpectedMetadataFields = Object.keys(metadata).filter(
    (name) => !allowedMetadataFields.has(name)
  )
  if (unexpectedMetadataFields.length > 0) {
    throw new Error(
      `${definition.id}/${metadataName} has unsupported fields: ${unexpectedMetadataFields.join(', ')}`
    )
  }
  if (metadata.version !== version) {
    throw new Error(
      `Updater metadata version mismatch for ${definition.id}: ${metadata.version} != ${version}`
    )
  }
  const file = normalizeMetadataFiles(metadata, `${definition.id}/${metadataName}`)
  if (file.url !== updaterPayload.name) {
    throw new Error(
      `Updater metadata URL mismatch for ${definition.id}: ${file.url} != ${updaterPayload.name}`
    )
  }
  if (
    typeof file.sha512 !== 'string' ||
    !SHA512_BASE64_PATTERN.test(file.sha512) ||
    file.sha512 !== updaterPayload.sha512
  ) {
    throw new Error(`Updater metadata SHA-512 mismatch for ${definition.id}`)
  }
  if (!Number.isSafeInteger(file.size) || file.size < 0 || file.size !== updaterPayload.bytes) {
    throw new Error(`Updater metadata size mismatch for ${definition.id}`)
  }
  if (metadata.path !== updaterPayload.name || metadata.sha512 !== updaterPayload.sha512) {
    throw new Error(`Updater metadata legacy fields mismatch for ${definition.id}`)
  }
  const blockMapSize = file.blockMapSize
  if (
    blockMapSize !== undefined &&
    (!Number.isSafeInteger(blockMapSize) ||
      blockMapSize <= 0 ||
      blockMapSize >= updaterPayload.bytes)
  ) {
    throw new Error(`Updater metadata blockMapSize is invalid for ${definition.id}`)
  }
  if (definition.platform === 'linux' && blockMapSize === undefined) {
    throw new Error(`Linux updater metadata is missing blockMapSize for ${definition.id}`)
  }
  const isAdminRightsRequired = file.isAdminRightsRequired
  if (
    isAdminRightsRequired !== undefined &&
    typeof isAdminRightsRequired !== 'boolean'
  ) {
    throw new Error(`Updater metadata isAdminRightsRequired is invalid for ${definition.id}`)
  }
  if (
    definition.platform === 'darwin' &&
    metadata.files.some(({ url }) => typeof url === 'string' && url.endsWith('.dmg'))
  ) {
    throw new Error('macOS updater metadata must not contain a DMG')
  }
  if (
    typeof metadata.releaseDate !== 'string' ||
    !Number.isFinite(Date.parse(metadata.releaseDate)) ||
    new Date(metadata.releaseDate).toISOString() !== metadata.releaseDate
  ) {
    throw new Error(`Updater metadata releaseDate is invalid for ${definition.id}`)
  }
  if (
    metadata.releaseName !== undefined &&
    metadata.releaseName !== null &&
    typeof metadata.releaseName !== 'string'
  ) {
    throw new Error(`Updater metadata releaseName is invalid for ${definition.id}`)
  }
  const releaseNotes = normalizeReleaseNotes(
    metadata.releaseNotes,
    `${definition.id}/${metadataName}`
  )
  if (
    metadata.stagingPercentage !== undefined &&
    (!Number.isFinite(metadata.stagingPercentage) ||
      metadata.stagingPercentage < 0 ||
      metadata.stagingPercentage > 100)
  ) {
    throw new Error(
      `Updater metadata stagingPercentage is invalid for ${definition.id}`
    )
  }
  if (
    metadata.minimumSystemVersion !== undefined &&
    (typeof metadata.minimumSystemVersion !== 'string' ||
      metadata.minimumSystemVersion.length === 0)
  ) {
    throw new Error(
      `Updater metadata minimumSystemVersion is invalid for ${definition.id}`
    )
  }

  return {
    version,
    files: [
      {
        url: file.url,
        sha512: file.sha512,
        size: file.size,
        ...(blockMapSize === undefined ? {} : { blockMapSize }),
        ...(isAdminRightsRequired === undefined ? {} : { isAdminRightsRequired })
      }
    ],
    path: metadata.path,
    sha512: metadata.sha512,
    releaseDate: metadata.releaseDate,
    ...(typeof metadata.releaseName === 'string'
      ? { releaseName: metadata.releaseName }
      : {}),
    ...(releaseNotes === undefined ? {} : { releaseNotes }),
    ...(metadata.stagingPercentage === undefined
      ? {}
      : { stagingPercentage: metadata.stagingPercentage }),
    ...(metadata.minimumSystemVersion === undefined
      ? {}
      : { minimumSystemVersion: metadata.minimumSystemVersion })
  }
}

async function ensureEmptyDirectory(directory) {
  await mkdir(directory, { recursive: true })
  const entries = await readdir(directory)
  if (entries.length > 0) {
    throw new Error(`Package output directory must be empty: ${directory}`)
  }
}

async function readPackageVersion(projectDirectory) {
  const packageJson = JSON.parse(
    await readFile(path.join(projectDirectory, 'package.json'), 'utf8')
  )
  return {
    version: assertNonEmptyString(packageJson.version, 'package.json version'),
    electron: assertNonEmptyString(
      packageJson.devDependencies?.electron ?? packageJson.dependencies?.electron,
      'Electron version'
    ),
    electronBuilder: assertNonEmptyString(
      packageJson.devDependencies?.['electron-builder'] ??
        packageJson.dependencies?.['electron-builder'],
      'electron-builder version'
    )
  }
}

async function copyReport(reportPath, outputReportsDirectory, stagedNames) {
  const reportName = path.basename(reportPath)
  if (stagedNames.has(reportName)) {
    throw new Error(`Duplicate diagnostic report basename: ${reportName}`)
  }
  const source = await inspectRegularFile(reportPath, path.dirname(reportPath))
  const stagedPath = path.join(outputReportsDirectory, reportName)
  await copyFile(reportPath, stagedPath)
  const inspected = await inspectRegularFile(stagedPath, outputReportsDirectory)
  if (inspected.bytes !== source.bytes || inspected.sha256 !== source.sha256) {
    throw new Error(`Diagnostic report changed while staging: ${reportName}`)
  }
  const report = JSON.parse(await readFile(stagedPath, 'utf8'))
  stagedNames.add(reportName)
  return {
    name: reportName,
    bytes: inspected.bytes,
    sha256: inspected.sha256,
    data: report
  }
}

export function validateInstallerSizeReport(
  report,
  expectedTarget,
  expectedCommit,
  policy = createDefaultPackageSizePolicy()
) {
  const definition = getTargetDefinition(expectedTarget)
  const expectedRoles = getMeasuredRoles(definition).map(({ name }) => name)
  if (
    report?.schemaVersion !== 1 ||
    report.target !== expectedTarget ||
    report.withinPolicy !== true ||
    !Array.isArray(report.comparisons) ||
    report.comparisons.length !== expectedRoles.length
  ) {
    throw new Error(`Installer-size report did not pass for ${expectedTarget}`)
  }
  if (expectedCommit !== undefined && report.candidateCommit !== expectedCommit) {
    throw new Error(`Installer-size report source mismatch for ${expectedTarget}`)
  }
  const seenRoles = new Set()
  for (const comparison of report.comparisons) {
    if (
      !comparison ||
      typeof comparison !== 'object' ||
      !expectedRoles.includes(comparison.role) ||
      seenRoles.has(comparison.role) ||
      comparison.withinPolicy !== true
    ) {
      throw new Error(`Installer-size report has invalid roles for ${expectedTarget}`)
    }
    seenRoles.add(comparison.role)
    for (const [label, artifact] of [
      ['baseline', comparison.baseline],
      ['candidate', comparison.candidate]
    ]) {
      if (
        !artifact ||
        typeof artifact.name !== 'string' ||
        !Number.isSafeInteger(artifact.bytes) ||
        artifact.bytes < 0 ||
        typeof artifact.sha256 !== 'string' ||
        !/^[a-f0-9]{64}$/.test(artifact.sha256)
      ) {
        throw new Error(
          `Installer-size report has an invalid ${label} artifact for ${expectedTarget}/${comparison.role}`
        )
      }
    }
    const baselineCommit =
      typeof report.baseline?.commit === 'string' ? report.baseline.commit : expectedCommit
    const expectedDeltaBytes = resolvePackageSizeExpectedDelta(policy, baselineCommit)
    if (
      (Number.isSafeInteger(report.expectedDeltaBytes) &&
        report.expectedDeltaBytes !== expectedDeltaBytes) ||
      (Number.isSafeInteger(comparison.expectedDeltaBytes) &&
        comparison.expectedDeltaBytes !== expectedDeltaBytes)
    ) {
      throw new Error(
        `Installer-size report expectedDelta does not match policy for ${expectedTarget}/${comparison.role}`
      )
    }
    const policyLimits = policy.targets?.[expectedTarget]?.[comparison.role]
    if (
      !policyLimits ||
      comparison.maxGrowthBytes !== policyLimits.maxGrowthBytes ||
      comparison.maxShrinkBytes !== policyLimits.maxShrinkBytes
    ) {
      throw new Error(
        `Installer-size report does not match policy for ${expectedTarget}/${comparison.role}`
      )
    }
    const adjustedDeltaBytes = comparison.deltaBytes - expectedDeltaBytes
    if (
      !Number.isSafeInteger(comparison.deltaBytes) ||
      comparison.deltaBytes !== comparison.candidate.bytes - comparison.baseline.bytes ||
      !Number.isSafeInteger(policyLimits.maxGrowthBytes) ||
      policyLimits.maxGrowthBytes < 0 ||
      !Number.isSafeInteger(policyLimits.maxShrinkBytes) ||
      policyLimits.maxShrinkBytes < 0 ||
      (comparison.adjustedDeltaBytes !== undefined &&
        comparison.adjustedDeltaBytes !== adjustedDeltaBytes) ||
      adjustedDeltaBytes > policyLimits.maxGrowthBytes ||
      adjustedDeltaBytes < -policyLimits.maxShrinkBytes
    ) {
      throw new Error(
        `Installer-size report has invalid limits for ${expectedTarget}/${comparison.role}`
      )
    }
  }
}

export function validateSmokeReports(reports, expectedTarget) {
  const lightOcrReports = reports.filter(({ name }) => name.startsWith('light-ocr-smoke-'))
  if (lightOcrReports.length === 0) {
    throw new Error(`Missing Light OCR smoke report for ${expectedTarget}`)
  }
  for (const lightOcrReport of lightOcrReports) {
    const reportTarget = lightOcrReport.data?.target
    const componentMetrics = lightOcrReport.data?.componentMetrics
    if (
      !reportTarget ||
      targetId(reportTarget.platform, reportTarget.arch) !== expectedTarget ||
      lightOcrReport.data.executed !== true ||
      !componentMetrics ||
      typeof componentMetrics !== 'object' ||
      Array.isArray(componentMetrics) ||
      !['ocrAssets', 'nodeRuntime', 'otherRuntime'].every(
        (name) =>
          componentMetrics[name] &&
          typeof componentMetrics[name] === 'object' &&
          !Array.isArray(componentMetrics[name])
      )
    ) {
      throw new Error(
        `Invalid Light OCR smoke report ${lightOcrReport.name} for ${expectedTarget}`
      )
    }
  }
}

async function resolveGitHead(projectDirectory) {
  const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], {
    cwd: projectDirectory,
    encoding: 'utf8'
  })
  return stdout.trim()
}

export async function createPackageManifest({
  projectDirectory = repositoryRoot,
  distDirectory = path.join(projectDirectory, 'dist'),
  outputDirectory = path.join(projectDirectory, 'package-output'),
  platform,
  arch,
  sourceSha,
  purpose,
  reportPaths = [],
  installerSizeReportPath = null,
  workflow = {},
  actualSourceSha,
  macAppPath,
  appleTeamId,
  verifyMacApp = verifyMacAppDistribution,
  verifyCuaMacHelper = verifyCuaMacHelperDistribution,
  verifyMacZip = verifyMacZipDistribution,
  verifyMacDmg = verifyDmgDistribution
}) {
  const definition = getTargetDefinition(platform, arch)
  validateSourceSha(sourceSha)
  validateArtifactPurpose(purpose)
  const resolvedActualSourceSha =
    actualSourceSha ?? (await resolveGitHead(path.resolve(projectDirectory)))
  if (resolvedActualSourceSha !== sourceSha) {
    throw new Error(
      `Checked out source SHA does not match requested source: ${resolvedActualSourceSha} != ${sourceSha}`
    )
  }

  const packageInfo = await readPackageVersion(projectDirectory)
  const workflowRunId = optionalNumericString(workflow.runId, 'workflow run ID')
  const workflowRunAttempt = optionalNumericString(
    workflow.runAttempt,
    'workflow run attempt'
  )
  if ((workflowRunId === undefined) !== (workflowRunAttempt === undefined)) {
    throw new Error('Workflow run ID and attempt must be provided together')
  }
  const resolvedDistDirectory = path.resolve(distDirectory)
  const resolvedOutputDirectory = path.resolve(outputDirectory)
  await ensureEmptyDirectory(resolvedOutputDirectory)
  const filesDirectory = path.join(resolvedOutputDirectory, 'files')
  const metadataDirectory = path.join(resolvedOutputDirectory, 'metadata')
  const reportsDirectory = path.join(resolvedOutputDirectory, 'reports')
  await Promise.all([
    mkdir(filesDirectory, { recursive: true }),
    mkdir(metadataDirectory, { recursive: true }),
    mkdir(reportsDirectory, { recursive: true })
  ])

  const discoveredFiles = []
  for (const roleDefinition of definition.roles) {
    const discovered = await findRoleFile(
      resolvedDistDirectory,
      roleDefinition,
      `${definition.id} dist`
    )
    const outputSubdirectory =
      roleDefinition.directory === 'metadata' ? metadataDirectory : filesDirectory
    const stagedPath = path.join(outputSubdirectory, discovered.name)
    await copyFile(discovered.path, stagedPath)
    const staged = await inspectRegularFile(stagedPath, resolvedOutputDirectory)
    discoveredFiles.push({
      role: roleDefinition.name,
      name: discovered.name,
      storagePath: `${roleDefinition.directory}/${discovered.name}`,
      bytes: staged.bytes,
      sha256: staged.sha256,
      sha512: staged.sha512
    })
  }

  const updaterRole = getUpdaterPayloadRole(definition)
  const updaterPayload = discoveredFiles.find(({ role }) => role === updaterRole.name)
  const metadataFile = discoveredFiles.find(({ role }) => role === 'update-metadata')
  const rawMetadata = parseYamlObject(
    await readFile(path.join(resolvedOutputDirectory, metadataFile.storagePath), 'utf8'),
    `${definition.id}/${metadataFile.name}`
  )
  validateRawUpdateMetadata({
    metadata: rawMetadata,
    metadataName: metadataFile.name,
    target: definition,
    version: packageInfo.version,
    updaterPayload
  })

  const stagedReports = []
  const stagedReportNames = new Set()
  for (const reportPath of reportPaths) {
    stagedReports.push(
      await copyReport(path.resolve(reportPath), reportsDirectory, stagedReportNames)
    )
  }
  validateSmokeReports(stagedReports, definition.id)

  let installerSize = 'not-run'
  if (installerSizeReportPath) {
    const sizeReport = await copyReport(
      path.resolve(installerSizeReportPath),
      reportsDirectory,
      stagedReportNames
    )
    validateInstallerSizeReport(sizeReport.data, definition.id, sourceSha)
    stagedReports.push(sizeReport)
    installerSize = 'passed'
  }

  const checks = {
    packageSmoke: 'passed',
    componentSize: 'passed',
    installerSize
  }

  if (definition.platform === 'darwin' && purpose === 'distribution') {
    const dmg = discoveredFiles.find(({ role }) => role === 'installer')
    const resolvedAppPath =
      macAppPath ??
      path.join(
        resolvedDistDirectory,
        definition.arch === 'arm64' ? 'mac-arm64' : 'mac',
        'DeepChat.app'
      )
    const resolvedDmgPath = path.join(resolvedDistDirectory, dmg.name)
    const resolvedZipPath = path.join(
      resolvedOutputDirectory,
      updaterPayload.storagePath
    )
    await verifyCuaMacHelper(resolvedAppPath, { teamId: appleTeamId })
    await verifyMacApp(resolvedAppPath, { teamId: appleTeamId })
    await verifyMacZip(resolvedZipPath, { teamId: appleTeamId })
    await verifyMacDmg(resolvedDmgPath, { teamId: appleTeamId })
    for (const checkName of DARWIN_DISTRIBUTION_CHECK_NAMES) {
      checks[checkName] = 'passed'
    }
  }

  const manifest = {
    schemaVersion: PACKAGE_MANIFEST_SCHEMA_VERSION,
    target: {
      id: definition.id,
      platform: definition.platform,
      arch: definition.arch
    },
    source: {
      commit: sourceSha,
      version: packageInfo.version
    },
    build: {
      purpose,
      electron: packageInfo.electron,
      electronBuilder: packageInfo.electronBuilder,
      ...(workflowRunId ? { workflowRunId } : {}),
      ...(workflowRunAttempt ? { workflowRunAttempt } : {})
    },
    checks,
    files: discoveredFiles.map(({ sha512: _sha512, ...file }) => file),
    reports: stagedReports.map(({ data: _data, ...report }) => report)
  }
  await writeFile(
    path.join(resolvedOutputDirectory, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8'
  )
  return manifest
}

function parseArguments(argv) {
  const options = { reportPaths: [] }
  const valueArguments = new Set([
    'platform',
    'arch',
    'source-sha',
    'purpose',
    'dist-dir',
    'output-dir',
    'project-dir',
    'report',
    'installer-size-report',
    'workflow-run-id',
    'workflow-run-attempt',
    'mac-app-path'
  ])
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--') continue
    if (!argument.startsWith('--')) throw new Error(`Unexpected argument: ${argument}`)
    const [name, inlineValue] = argument.slice(2).split('=', 2)
    if (!valueArguments.has(name)) throw new Error(`Unknown argument: --${name}`)
    const value = inlineValue ?? argv[++index]
    if (!value || value.startsWith('--')) throw new Error(`Missing value for --${name}`)
    if (name === 'report') {
      options.reportPaths.push(value)
    } else {
      options[name] = value
    }
  }
  return options
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArguments(argv)
  for (const required of ['platform', 'arch', 'source-sha', 'purpose']) {
    if (!options[required]) throw new Error(`--${required} is required`)
  }
  if (!SOURCE_SHA_PATTERN.test(options['source-sha'])) {
    throw new Error('--source-sha must be a 40-character lowercase Git SHA')
  }
  const projectDirectory = path.resolve(options['project-dir'] ?? repositoryRoot)
  return await createPackageManifest({
    projectDirectory,
    distDirectory: path.resolve(options['dist-dir'] ?? path.join(projectDirectory, 'dist')),
    outputDirectory: path.resolve(
      options['output-dir'] ?? path.join(projectDirectory, 'package-output')
    ),
    platform: options.platform,
    arch: options.arch,
    sourceSha: options['source-sha'],
    purpose: options.purpose,
    reportPaths: options.reportPaths,
    installerSizeReportPath: options['installer-size-report'] ?? null,
    workflow: {
      runId: options['workflow-run-id'],
      runAttempt: options['workflow-run-attempt']
    },
    macAppPath: options['mac-app-path'],
    appleTeamId: process.env.DEEPCHAT_APPLE_NOTARY_TEAM_ID
  })
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    console.error(
      '[Package Manifest] failed:',
      error instanceof Error ? error.message : error
    )
    process.exitCode = 1
  })
}
