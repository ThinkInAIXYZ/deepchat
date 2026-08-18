#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import {
  getMeasuredRoles,
  getTargetDefinition,
  PACKAGE_SIZE_BASELINE_SCHEMA_VERSION,
  PACKAGE_SIZE_POLICY_SCHEMA_VERSION,
  SOURCE_SHA_PATTERN,
  TARGET_DEFINITIONS,
  matchesRoleFileName,
  resolvePackageSizeExpectedDelta,
  validateSourceSha
} from './package-contract.mjs'
import { findRoleFile } from './package-files.mjs'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

async function readJson(filePath, label) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'))
  } catch (error) {
    throw new Error(`Cannot read ${label}: ${filePath}`, { cause: error })
  }
}

function validateNonNegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer`)
  }
  return value
}

export function validatePackageSizeBaseline(baseline) {
  if (
    baseline?.schemaVersion !== PACKAGE_SIZE_BASELINE_SCHEMA_VERSION ||
    typeof baseline.source !== 'object' ||
    baseline.source === null
  ) {
    throw new Error('Invalid package-size baseline manifest')
  }
  if (!/^\d+$/.test(String(baseline.source.runId ?? ''))) {
    throw new Error('Package-size baseline run ID must be numeric')
  }
  if (
    typeof baseline.source.version !== 'string' ||
    baseline.source.version.length === 0 ||
    typeof baseline.source.workflow !== 'string' ||
    baseline.source.workflow.length === 0
  ) {
    throw new Error('Package-size baseline source provenance is incomplete')
  }
  validateSourceSha(baseline.source.commit, 'package-size baseline source commit')
  if (!baseline.targets || typeof baseline.targets !== 'object') {
    throw new Error('Package-size baseline targets are missing')
  }
  for (const definition of TARGET_DEFINITIONS) {
    const target = baseline.targets[definition.id]
    if (!target || typeof target !== 'object') {
      throw new Error(`Package-size baseline is missing ${definition.id}`)
    }
    for (const roleDefinition of getMeasuredRoles(definition)) {
      const artifact = target[roleDefinition.name]
      if (
        !artifact ||
        typeof artifact.name !== 'string' ||
        !matchesRoleFileName(artifact.name, roleDefinition) ||
        typeof artifact.sha256 !== 'string' ||
        !/^[a-f0-9]{64}$/.test(artifact.sha256)
      ) {
        throw new Error(
          `Package-size baseline has invalid ${definition.id}/${roleDefinition.name}`
        )
      }
      validateNonNegativeInteger(
        artifact.bytes,
        `Package-size baseline ${definition.id}/${roleDefinition.name} bytes`
      )
      if (!/^\d+$/.test(String(artifact.artifactId ?? ''))) {
        throw new Error(
          `Package-size baseline ${definition.id}/${roleDefinition.name} artifact ID must be numeric`
        )
      }
    }
    const unexpectedRoles = Object.keys(target).filter(
      (roleName) => !getMeasuredRoles(definition).some(({ name }) => name === roleName)
    )
    if (unexpectedRoles.length > 0) {
      throw new Error(
        `Package-size baseline has unexpected ${definition.id} roles: ${unexpectedRoles.join(', ')}`
      )
    }
  }
  const unexpectedTargets = Object.keys(baseline.targets).filter(
    (id) => !TARGET_DEFINITIONS.some((definition) => definition.id === id)
  )
  if (unexpectedTargets.length > 0) {
    throw new Error(
      `Package-size baseline has unexpected targets: ${unexpectedTargets.join(', ')}`
    )
  }
  return baseline
}

export function validatePackageSizePolicy(policy) {
  if (
    policy?.schemaVersion !== PACKAGE_SIZE_POLICY_SCHEMA_VERSION ||
    !policy.targets ||
    typeof policy.targets !== 'object'
  ) {
    throw new Error('Invalid package-size policy')
  }
  if (policy.expectedDelta !== undefined) {
    const expected = policy.expectedDelta
    if (
      !expected ||
      typeof expected !== 'object' ||
      typeof expected.baselineCommit !== 'string' ||
      !SOURCE_SHA_PATTERN.test(expected.baselineCommit) ||
      !Number.isSafeInteger(expected.bytes) ||
      expected.bytes > 0
    ) {
      throw new Error('Package-size policy expectedDelta is invalid')
    }
  }
  for (const definition of TARGET_DEFINITIONS) {
    const target = policy.targets[definition.id]
    if (!target || typeof target !== 'object') {
      throw new Error(`Package-size policy is missing ${definition.id}`)
    }
    for (const roleDefinition of getMeasuredRoles(definition)) {
      const limit = target[roleDefinition.name]
      if (!limit || typeof limit !== 'object') {
        throw new Error(
          `Package-size policy is missing ${definition.id}/${roleDefinition.name}`
        )
      }
      validateNonNegativeInteger(
        limit.maxGrowthBytes,
        `Package-size policy ${definition.id}/${roleDefinition.name} maxGrowthBytes`
      )
      validateNonNegativeInteger(
        limit.maxShrinkBytes,
        `Package-size policy ${definition.id}/${roleDefinition.name} maxShrinkBytes`
      )
    }
    const expectedRoles = new Set(getMeasuredRoles(definition).map(({ name }) => name))
    const unexpectedRoles = Object.keys(target).filter(
      (roleName) => !expectedRoles.has(roleName)
    )
    if (unexpectedRoles.length > 0) {
      throw new Error(
        `Package-size policy has unexpected ${definition.id} roles: ${unexpectedRoles.join(', ')}`
      )
    }
  }
  const expectedTargets = new Set(TARGET_DEFINITIONS.map(({ id }) => id))
  const unexpectedTargets = Object.keys(policy.targets).filter(
    (target) => !expectedTargets.has(target)
  )
  if (unexpectedTargets.length > 0) {
    throw new Error(
      `Package-size policy has unexpected targets: ${unexpectedTargets.join(', ')}`
    )
  }
  return policy
}

async function inspectMeasuredTarget(directory, definition) {
  return Object.fromEntries(
    await Promise.all(
      getMeasuredRoles(definition).map(async (roleDefinition) => {
        const artifact = await findRoleFile(
          directory,
          roleDefinition,
          `${definition.id} package directory`
        )
        return [
          roleDefinition.name,
          {
            name: artifact.name,
            bytes: artifact.bytes,
            sha256: artifact.sha256
          }
        ]
      })
    )
  )
}

export async function createPackageSizeBaseline({
  artifactsDirectory,
  runId,
  sourceSha,
  version,
  workflowName = 'Build Application',
  artifactIds = {}
}) {
  validateSourceSha(sourceSha)
  if (!/^\d+$/.test(String(runId))) {
    throw new Error('Baseline run ID must be numeric')
  }
  if (typeof version !== 'string' || version.length === 0) {
    throw new Error('Baseline version must be a non-empty string')
  }
  const targets = {}
  for (const definition of TARGET_DEFINITIONS) {
    const artifactDirectory = path.join(
      path.resolve(artifactsDirectory),
      definition.legacyArtifactName
    )
    const measured = await inspectMeasuredTarget(artifactDirectory, definition)
    const artifactId = artifactIds[definition.id]
    if (!/^\d+$/.test(String(artifactId ?? ''))) {
      throw new Error(`Baseline artifact ID is missing for ${definition.id}`)
    }
    targets[definition.id] = Object.fromEntries(
      Object.entries(measured).map(([roleName, artifact]) => [
        roleName,
        {
          ...artifact,
          artifactId: String(artifactId)
        }
      ])
    )
  }
  return validatePackageSizeBaseline({
    schemaVersion: PACKAGE_SIZE_BASELINE_SCHEMA_VERSION,
    source: {
      runId: String(runId),
      commit: sourceSha,
      version,
      workflow: workflowName
    },
    targets
  })
}

export async function comparePackageSize({
  target,
  candidateDirectory,
  candidateCommit,
  baseline,
  policy
}) {
  const definition = getTargetDefinition(target)
  if (candidateCommit !== null && candidateCommit !== undefined) {
    validateSourceSha(candidateCommit, 'candidate commit')
  }
  validatePackageSizeBaseline(baseline)
  validatePackageSizePolicy(policy)
  const candidate = await inspectMeasuredTarget(path.resolve(candidateDirectory), definition)
  const comparisons = []
  let withinPolicy = true
  for (const roleDefinition of getMeasuredRoles(definition)) {
    const baselineArtifact = baseline.targets[definition.id][roleDefinition.name]
    const candidateArtifact = candidate[roleDefinition.name]
    const limits = policy.targets[definition.id][roleDefinition.name]
    const deltaBytes = candidateArtifact.bytes - baselineArtifact.bytes
    const expectedDeltaBytes = resolvePackageSizeExpectedDelta(policy, baseline.source.commit)
    const adjustedDeltaBytes = deltaBytes - expectedDeltaBytes
    const roleWithinPolicy =
      adjustedDeltaBytes <= limits.maxGrowthBytes &&
      adjustedDeltaBytes >= -limits.maxShrinkBytes
    if (!roleWithinPolicy) withinPolicy = false
    comparisons.push({
      role: roleDefinition.name,
      baseline: baselineArtifact,
      candidate: candidateArtifact,
      deltaBytes,
      expectedDeltaBytes,
      adjustedDeltaBytes,
      maxGrowthBytes: limits.maxGrowthBytes,
      maxShrinkBytes: limits.maxShrinkBytes,
      withinPolicy: roleWithinPolicy
    })
  }
  return {
    schemaVersion: 1,
    target: definition.id,
    baseline: baseline.source,
    candidateCommit: candidateCommit ?? null,
    expectedDeltaBytes: resolvePackageSizeExpectedDelta(policy, baseline.source.commit),
    comparisons,
    withinPolicy
  }
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function parseArguments(argv) {
  const explicitCommand = argv[0] && !argv[0].startsWith('--')
  const command = explicitCommand ? argv[0] : 'compare'
  const rest = explicitCommand ? argv.slice(1) : argv
  const options = { command, artifactIds: [] }
  for (let index = 0; index < rest.length; index += 1) {
    const argument = rest[index]
    if (argument === '--') continue
    if (!argument.startsWith('--')) throw new Error(`Unexpected argument: ${argument}`)
    const [name, inlineValue] = argument.slice(2).split('=', 2)
    const value = inlineValue ?? rest[++index]
    if (!value || value.startsWith('--')) throw new Error(`Missing value for --${name}`)
    if (name === 'artifact-id') {
      options.artifactIds.push(value)
    } else {
      options[name] = value
    }
  }
  return options
}

function parseArtifactIds(values) {
  const artifactIds = {}
  for (const value of values) {
    const separator = value.indexOf('=')
    if (separator <= 0) {
      throw new Error('--artifact-id must use <target>=<numeric-id>')
    }
    const target = value.slice(0, separator)
    const artifactId = value.slice(separator + 1)
    getTargetDefinition(target)
    if (artifactIds[target] !== undefined || !/^\d+$/.test(artifactId)) {
      throw new Error(`Invalid or duplicate baseline artifact ID for ${target}`)
    }
    artifactIds[target] = artifactId
  }
  return artifactIds
}

function rejectUnknownOptions(options, allowedOptions) {
  const unexpected = Object.keys(options).filter(
    (name) =>
      name !== 'command' &&
      name !== 'artifactIds' &&
      !allowedOptions.has(name)
  )
  if (unexpected.length > 0) {
    throw new Error(`Unknown package-size option: --${unexpected[0]}`)
  }
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArguments(argv)
  if (options.command === 'baseline') {
    rejectUnknownOptions(
      options,
      new Set(['artifacts-dir', 'run-id', 'source-sha', 'version', 'output'])
    )
    for (const required of [
      'artifacts-dir',
      'run-id',
      'source-sha',
      'version',
      'output'
    ]) {
      if (!options[required]) throw new Error(`--${required} is required`)
    }
    if (!SOURCE_SHA_PATTERN.test(options['source-sha'])) {
      throw new Error('--source-sha must be a 40-character lowercase Git SHA')
    }
    const baseline = await createPackageSizeBaseline({
      artifactsDirectory: options['artifacts-dir'],
      runId: options['run-id'],
      sourceSha: options['source-sha'],
      version: options.version,
      artifactIds: parseArtifactIds(options.artifactIds)
    })
    await writeJson(path.resolve(options.output), baseline)
    return baseline
  }
  if (options.command !== 'compare') {
    throw new Error(`Unsupported package-size command: ${options.command}`)
  }
  if (options.artifactIds.length > 0) {
    throw new Error('--artifact-id is only valid for baseline generation')
  }
  rejectUnknownOptions(
    options,
    new Set([
      'target',
      'candidate-dir',
      'candidate-commit',
      'baseline',
      'policy',
      'report'
    ])
  )
  for (const required of ['target', 'candidate-dir', 'report']) {
    if (!options[required]) throw new Error(`--${required} is required`)
  }
  const baselinePath = path.resolve(
    options.baseline ?? path.join(repositoryRoot, 'resources/package-size-baseline.json')
  )
  const policyPath = path.resolve(
    options.policy ?? path.join(repositoryRoot, 'resources/package-size-policy.json')
  )
  const report = await comparePackageSize({
    target: options.target,
    candidateDirectory: options['candidate-dir'],
    candidateCommit: options['candidate-commit'],
    baseline: await readJson(baselinePath, 'package-size baseline'),
    policy: await readJson(policyPath, 'package-size policy')
  })
  await writeJson(path.resolve(options.report), report)
  if (!report.withinPolicy) {
    throw new Error(`Package-size policy failed for ${report.target}`)
  }
  console.log(`[Package Size] ${JSON.stringify(report)}`)
  return report
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    console.error('[Package Size] failed:', error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
