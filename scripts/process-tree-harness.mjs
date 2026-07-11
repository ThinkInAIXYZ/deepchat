#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir, release, tmpdir } from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import {
  captureProcessIdentity,
  censusMarkedProcesses,
  cleanupMarkedIdentity,
  getProcessIdentityStatus,
  ProcessIdentityVerificationError,
  ProcessVisibilityUnknownError
} from './process-tree-harness/identity.mjs'

const require = createRequire(import.meta.url)
const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const MODES = new Set(['healthy-shutdown', 'owner-loss', 'callback-observation'])

function parseArguments(argv) {
  const options = {
    mode: 'owner-loss',
    observationMs: 5_000,
    outputDir: null,
    phase: 'pre-change'
  }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--') continue
    const value = argv[index + 1]
    if (argument === '--mode') options.mode = value
    else if (argument === '--observation-ms') options.observationMs = Number(value)
    else if (argument === '--output-dir') options.outputDir = path.resolve(value)
    else if (argument === '--phase') options.phase = value
    else if (argument === '--electron') options.electronPath = path.resolve(value)
    else throw new Error(`Unknown process-tree harness argument: ${argument}`)
    index += 1
  }
  if (!MODES.has(options.mode)) throw new Error(`Unsupported harness mode: ${options.mode}`)
  if (!Number.isFinite(options.observationMs) || options.observationMs < 0) {
    throw new Error('Observation time must be a non-negative number')
  }
  return options
}

function readEvents(text) {
  return text
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))
}

async function readEventFile(eventPath) {
  return readEvents(await readFile(eventPath, 'utf8').catch(() => ''))
}

async function waitForEvent(eventPath, predicate, timeoutMs, signal) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const event = (await readEventFile(eventPath)).find(predicate)
    if (event) return event
    await delay(25, undefined, { signal })
  }
  throw new Error(`Harness event timed out after ${timeoutMs}ms`)
}

function describeExit(exit) {
  return `code ${exit.code ?? 'null'}, signal ${exit.signal ?? 'null'}`
}

export function waitForChildExit(child, timeoutMs) {
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (handler, value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      child.removeListener('exit', onExit)
      child.removeListener('error', onError)
      handler(value)
    }
    const onExit = (code, signal) => finish(resolve, { code, signal })
    const onError = (error) => finish(reject, error)
    const timer = setTimeout(
      () => finish(reject, new Error(`Electron harness timed out after ${timeoutMs}ms`)),
      timeoutMs
    )
    child.once('exit', onExit)
    child.once('error', onError)
    if (child.exitCode !== null && child.exitCode !== undefined) {
      finish(resolve, { code: child.exitCode, signal: child.signalCode ?? null })
    } else if (child.signalCode !== null && child.signalCode !== undefined) {
      finish(resolve, { code: child.exitCode ?? null, signal: child.signalCode })
    }
  })
}

async function waitForTreeReady(eventPath, ownerExitPromise, timeoutMs) {
  const controller = new AbortController()
  const readyPromise = waitForEvent(
    eventPath,
    (event) => event.type === 'tree-ready',
    timeoutMs,
    controller.signal
  )
  try {
    return await Promise.race([
      readyPromise,
      ownerExitPromise.then((exit) => {
        throw new Error(`Electron harness owner exited before tree-ready (${describeExit(exit)})`)
      })
    ])
  } finally {
    controller.abort()
    await readyPromise.catch(() => undefined)
  }
}

function roleIdentities(events, census, unverified) {
  const pids = new Map()
  for (const event of events) {
    if (event.type !== 'process-ready') continue
    const role = event.role === 'utility-host' ? 'utility' : event.role
    pids.set(role, event.pid)
  }
  return Object.fromEntries(
    [...pids].map(([role, pid]) => [
      role,
      census.find((entry) => entry.role === role) ??
        unverified.find((entry) => entry.role === role) ?? { pid }
    ])
  )
}

function captureResult(verified, unverified) {
  return { verified: [...verified], unverified: [...unverified] }
}

function captureError(error, verified, unverified) {
  const capturedError = error instanceof Error ? error : new Error(String(error))
  capturedError.captureResult = captureResult(verified, unverified)
  return capturedError
}

function visibilityError(errors, stage, error, identity) {
  errors.push({
    stage,
    role: identity?.role ?? null,
    pid: identity?.pid ?? null,
    error: error instanceof Error ? error.message : String(error)
  })
}

async function captureCensus(marker, stage, errors, census) {
  try {
    return await census(marker)
  } catch (error) {
    visibilityError(errors, stage, error)
    return null
  }
}

async function captureStatus(identity, stage, errors, getStatus) {
  try {
    return await getStatus(identity)
  } catch (error) {
    visibilityError(errors, stage, error, identity)
    return 'unknown'
  }
}

export async function captureReadyIdentities(
  events,
  marker,
  requireCompleteTree,
  captureIdentity = captureProcessIdentity
) {
  const readyByRole = new Map()
  for (const event of events) {
    if (event.type !== 'process-ready') continue
    const role = event.role === 'utility-host' ? 'utility' : event.role
    readyByRole.set(role, event)
  }
  const verified = []
  const unverified = []
  for (const role of ['owner', 'utility', 'shell', 'grandchild']) {
    const event = readyByRole.get(role)
    if (!event) {
      if (requireCompleteTree) {
        throw captureError(
          new Error(`Missing process-ready event for ${role}`),
          verified,
          unverified
        )
      }
      continue
    }
    const commandMarkerRequired =
      role !== 'utility' || event.markerMechanism === 'process-title'
    try {
      const identity = await captureIdentity(event.pid, marker, commandMarkerRequired)
      if (!commandMarkerRequired) {
        const unverifiedIdentity = {
          ...identity,
          role,
          markerSource: 'utility-event-unverified',
          signalable: false,
          verificationCode: 'PROCESS_IDENTITY_UNVERIFIED'
        }
        unverified.push(unverifiedIdentity)
        if (requireCompleteTree) {
          throw new ProcessIdentityVerificationError(
            `Process ${event.pid} utility marker cannot be verified outside the process`,
            captureResult(verified, unverified)
          )
        }
        continue
      }
      verified.push({
        ...identity,
        role,
        markerSource:
          role === 'utility' && event.markerMechanism === 'process-title'
            ? 'process-title'
            : 'command-line',
        signalable: true
      })
    } catch (error) {
      if (error instanceof ProcessVisibilityUnknownError && error.processEntry) {
        unverified.push({
          ...error.processEntry,
          role,
          markerSource: 'visibility-unknown',
          signalable: false,
          verificationCode: error.code
        })
      }
      if (requireCompleteTree) throw captureError(error, verified, unverified)
    }
  }
  if (requireCompleteTree) {
    const byRole = Object.fromEntries(verified.map((identity) => [identity.role, identity]))
    for (const [childRole, parentRole] of [
      ['utility', 'owner'],
      ['shell', 'utility'],
      ['grandchild', 'shell']
    ]) {
      if (byRole[childRole].parentPid !== byRole[parentRole].pid) {
        throw captureError(
          new Error(
            `Unexpected marked-tree parent for ${childRole}: ${byRole[childRole].parentPid}`
          ),
          verified,
          unverified
        )
      }
    }
  }
  return { verified, unverified }
}

export async function cleanupCapturedIdentities(
  verified,
  postObservation,
  unverified,
  cleanupIdentity = cleanupMarkedIdentity
) {
  const unverifiedPids = new Set(unverified.map((identity) => identity.pid))
  const identities = new Map()
  for (const identity of [...verified, ...postObservation]) {
    if (unverifiedPids.has(identity.pid) || identity.signalable === false) continue
    identities.set(`${identity.pid}:${identity.startIdentity}`, identity)
  }
  const attempts = []
  for (const identity of [...identities.values()].reverse()) {
    try {
      attempts.push(await cleanupIdentity(identity))
    } catch (error) {
      attempts.push({ pid: identity.pid, error: String(error) })
    }
  }
  return attempts
}

function renderReport(artifact) {
  const statusRows = Object.entries(artifact.observation.statusByRole)
    .map(([role, status]) => {
      const identity = artifact.processTree[role]
      return `| ${role} | ${identity.pid} | ${identity.parentPid} | ${identity.markerSource} | ${identity.startIdentity} | ${status} |`
    })
    .join('\n')
  const callbacks = artifact.observation.utilityCallbacks.length
    ? artifact.observation.utilityCallbacks.map((event) => event.name).join(', ')
    : 'none observed'
  const probes = artifact.observation.utilityProbes.length
    ? artifact.observation.utilityProbes
        .map(
          (event) =>
            `${event.target}.${event.eventName} (registered: ${event.registered}, documented: ${event.documentedByElectron ?? event.documentedByNode ?? false})`
        )
        .join(', ')
    : 'none registered'
  const settlements = artifact.observation.utilitySettlements.length
    ? artifact.observation.utilitySettlements
        .map((event) => `${event.reason} / code ${event.code} / count ${event.settlementCount}`)
        .join(', ')
    : 'none observed'
  return `# PTG marked-tree harness result

- Run: \`${artifact.runId}\`
- Phase: \`${artifact.phase}\`
- Mode: \`${artifact.mode}\`
- Started: \`${artifact.startedAt}\`
- Observation window: \`${artifact.observation.windowMs}ms\`
- Platform: \`${artifact.runtime.platform}/${artifact.runtime.arch}\` (${artifact.runtime.osRelease})
- Distribution: \`${artifact.runtime.distribution}\` (packaged: \`${artifact.runtime.packaged}\`)
- Electron: \`${artifact.runtime.electronVersion ?? 'unknown'}\`
- Harness SHA-256: \`${artifact.runtime.harnessSha256}\`
- Owner exit: code \`${artifact.ownerExit.code}\`, signal \`${artifact.ownerExit.signal}\`
- Contract satisfied before cleanup: \`${artifact.observation.contractSatisfied}\`
- Expected owner exit: code \`${artifact.observation.expectedOwnerExit.code}\`, signal \`${artifact.observation.expectedOwnerExit.signal}\`
- Utility callbacks: ${callbacks}
- Utility callback probes: ${probes}
- Utility settlements: ${settlements}
- Cleanup left no marked process: \`${artifact.cleanup.allMarkedGone}\`
- Manual cleanup required: \`${artifact.cleanup.manualCleanupRequired}\`

| Role | PID | Parent PID | Marker source | Start identity | Status after observation |
| --- | ---: | ---: | --- | --- | --- |
${statusRows}

The result is a measurement, not a containment success assertion. Cleanup signals only a process
whose PID, marker, and OS start identity still match the captured identity. A role whose marker
cannot be externally verified is never signalled and is recorded for manual cleanup if it survives.
`
}

async function writeArtifact(artifact, outputDir) {
  await mkdir(outputDir, { recursive: true })
  const stem = `ptg-${artifact.phase}-${artifact.mode}-${artifact.runtime.platform}-${artifact.runId}`
  const jsonPath = path.join(outputDir, `${stem}.json`)
  const markdownPath = path.join(outputDir, `${stem}.md`)
  const report = renderReport(artifact)
  await writeFile(jsonPath, `${JSON.stringify(artifact, null, 2)}\n`)
  await writeFile(markdownPath, report)
  return { jsonPath, markdownPath, report }
}

async function hashHarnessSources(paths) {
  const hash = createHash('sha256')
  for (const sourcePath of paths.sort()) {
    hash.update(path.basename(sourcePath))
    hash.update(await readFile(sourcePath))
  }
  return hash.digest('hex')
}

export function redactArtifactPaths(value, pathBindings) {
  const replacements = Object.entries(pathBindings)
    .filter(([, sourcePath]) => typeof sourcePath === 'string' && sourcePath.length > 0)
    .sort(([, left], [, right]) => right.length - left.length)

  const redact = (entry) => {
    if (typeof entry === 'string') {
      return replacements.reduce(
        (result, [label, sourcePath]) => result.replaceAll(sourcePath, `<${label}>`),
        entry
      )
    }
    if (Array.isArray(entry)) return entry.map(redact)
    if (entry && typeof entry === 'object') {
      return Object.fromEntries(Object.entries(entry).map(([key, child]) => [key, redact(child)]))
    }
    return entry
  }

  return redact(value)
}

export function evaluateHarnessContract({
  mode,
  error,
  statusByRole,
  ownerExit,
  utilitySettlements,
  before,
  preExit,
  postObservation
}) {
  const expectedOwnerExit = {
    code: mode === 'healthy-shutdown' ? 0 : 17,
    signal: null
  }
  const processStatusesSatisfied =
    error === null &&
    Object.keys(statusByRole).length === 4 &&
    Object.values(statusByRole).every((status) => status === 'absent') &&
    postObservation !== null &&
    postObservation.length === 0
  const ownerExitSatisfied =
    ownerExit.code === expectedOwnerExit.code && ownerExit.signal === expectedOwnerExit.signal
  const healthySettlementSatisfied =
    mode !== 'healthy-shutdown' ||
    (utilitySettlements.length === 1 &&
      utilitySettlements[0].reason === 'shell-close:0:null' &&
      utilitySettlements[0].code === 0 &&
      utilitySettlements[0].settlementCount === 1)
  const censusSatisfied =
    before !== null &&
    before.length === 0 &&
    preExit.length === 4 &&
    postObservation !== null &&
    postObservation.length === 0
  const checks = {
    processStatusesSatisfied,
    ownerExitSatisfied,
    healthySettlementSatisfied,
    censusSatisfied
  }
  return {
    expectedOwnerExit,
    checks,
    contractSatisfied: Object.values(checks).every(Boolean)
  }
}

export function evaluateCleanupOutcome({
  postCleanup,
  statusAfterCleanup,
  visibilityErrors,
  unverifiedCleanup
}) {
  return {
    manualCleanupRequired:
      postCleanup === null ||
      visibilityErrors.length > 0 ||
      Object.values(statusAfterCleanup).some((status) => status === 'unknown') ||
      unverifiedCleanup.some((entry) => entry.manualCleanupRequired),
    allMarkedGone:
      postCleanup !== null &&
      postCleanup.length === 0 &&
      visibilityErrors.length === 0 &&
      Object.values(statusAfterCleanup).every(
        (status) => status !== 'match' && status !== 'unknown'
      ) &&
      unverifiedCleanup.every((entry) => !entry.manualCleanupRequired)
  }
}

export async function runProcessTreeHarness(options = {}) {
  const mode = options.mode ?? 'owner-loss'
  if (!MODES.has(mode)) throw new Error(`Unsupported harness mode: ${mode}`)

  const runId = options.runId ?? randomUUID()
  const marker = `deepchat-ptg-${runId}`
  const phase = options.phase ?? 'pre-change'
  const observationMs = options.observationMs ?? 5_000
  const electronPath = options.electronPath ?? require('electron')
  const outputDir =
    options.outputDir ?? path.join(tmpdir(), 'deepchat-process-tree-harness-artifacts')
  const runRoot = await mkdtemp(path.join(tmpdir(), 'deepchat-process-tree-harness-'))
  const eventPath = path.join(runRoot, 'events.jsonl')
  const controlFile = path.join(runRoot, 'continue')
  const stopFile = path.join(runRoot, 'healthy-stop')
  const electronMainPath =
    options.electronMainPath ?? path.join(scriptDir, 'process-tree-harness/electron-main.mjs')
  const utilityPath = path.join(scriptDir, 'process-tree-harness/utility.mjs')
  const grandchildPath = path.join(scriptDir, 'process-tree-harness/grandchild.mjs')
  const harnessSha256 = await hashHarnessSources([
    fileURLToPath(import.meta.url),
    electronMainPath,
    utilityPath,
    grandchildPath,
    path.join(scriptDir, 'process-tree-harness/identity.mjs')
  ])
  const startedAt = new Date().toISOString()
  const captureIdentity = options.captureIdentity ?? captureProcessIdentity
  const census = options.censusMarkedProcesses ?? censusMarkedProcesses
  const cleanupIdentity = options.cleanupMarkedIdentity ?? cleanupMarkedIdentity
  const getIdentityStatus = options.getProcessIdentityStatus ?? getProcessIdentityStatus
  let child
  let ownerExit = { code: null, signal: null }
  let preExit = []
  let postObservation = []
  let statusAfterObservation = {}
  let events = []
  let stderr = ''
  let error = null
  let errorCode = null
  let unverifiedIdentities = []
  const cleanupAttempts = []
  const identityVisibilityErrors = []
  const before = await captureCensus(marker, 'before-census', identityVisibilityErrors, census)

  try {
    child = spawn(electronPath, [electronMainPath, `--ptg-marker=${marker}`], {
      env: {
        ...process.env,
        DEEPCHAT_PTG_MODE: mode,
        DEEPCHAT_PTG_MARKER: marker,
        DEEPCHAT_PTG_EVENT_PATH: eventPath,
        DEEPCHAT_PTG_CONTROL_FILE: controlFile,
        DEEPCHAT_PTG_STOP_FILE: stopFile,
        DEEPCHAT_PTG_UTILITY_PATH: utilityPath,
        DEEPCHAT_PTG_GRANDCHILD_PATH: grandchildPath,
        DEEPCHAT_PTG_NODE_PATH: process.execPath,
        DEEPCHAT_PTG_OBSERVE_CALLBACKS: mode === 'callback-observation' ? '1' : '0'
      },
      stdio: ['ignore', 'ignore', 'pipe']
    })
    const ownerExitPromise = waitForChildExit(child, 10_000).then((exit) => {
      ownerExit = exit
      return exit
    })
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })

    await waitForTreeReady(eventPath, ownerExitPromise, 10_000)
    events = await readEventFile(eventPath)
    ;({ verified: preExit, unverified: unverifiedIdentities } = await captureReadyIdentities(
      events,
      marker,
      true,
      captureIdentity
    ))
    await writeFile(controlFile, 'continue\n')
    ownerExit = await ownerExitPromise
    await new Promise((resolve) => setTimeout(resolve, observationMs))
    events = await readEventFile(eventPath)
    postObservation = await captureCensus(
      marker,
      'post-observation-census',
      identityVisibilityErrors,
      census
    )
    statusAfterObservation = Object.fromEntries(
      await Promise.all(
        preExit.map(async (identity) => [
          identity.role,
          await captureStatus(
            identity,
            'post-observation-status',
            identityVisibilityErrors,
            getIdentityStatus
          )
        ])
      )
    )
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught)
    errorCode = caught?.code ?? null
    events = await readEventFile(eventPath)
    if (caught?.captureResult) {
      preExit = caught.captureResult.verified
      unverifiedIdentities = caught.captureResult.unverified
    }
    postObservation = await captureCensus(
      marker,
      'error-census',
      identityVisibilityErrors,
      census
    )
    statusAfterObservation = Object.fromEntries(
      await Promise.all(
        [...preExit, ...unverifiedIdentities].map(async (identity) => [
          identity.role,
          await captureStatus(
            identity,
            'error-status',
            identityVisibilityErrors,
            getIdentityStatus
          )
        ])
      )
    )
  } finally {
    try {
      cleanupAttempts.push(
        ...(await cleanupCapturedIdentities(
          preExit.map((identity) => ({ ...identity, marker })),
          (postObservation ?? []).map((identity) => ({ ...identity, marker })),
          unverifiedIdentities,
          cleanupIdentity
        ))
      )
    } catch (cleanupError) {
      cleanupAttempts.push({ error: String(cleanupError) })
    }
    if (child && child.exitCode === null && child.signalCode === null) {
      const currentOwner = (
        (await captureCensus(
          marker,
          'owner-cleanup-census',
          identityVisibilityErrors,
          census
        )) ?? []
      ).find((entry) => entry.pid === child.pid)
      if (currentOwner) {
        try {
          cleanupAttempts.push(await cleanupIdentity({ ...currentOwner, marker }))
        } catch (cleanupError) {
          cleanupAttempts.push({ pid: currentOwner.pid, error: String(cleanupError) })
        }
      }
    }
  }

  const postCleanup = await captureCensus(
    marker,
    'post-cleanup-census',
    identityVisibilityErrors,
    census
  )
  const unverifiedCleanup = await Promise.all(
    unverifiedIdentities.map(async (identity) => {
      const status = await captureStatus(
        identity,
        'unverified-cleanup-status',
        identityVisibilityErrors,
        getIdentityStatus
      )
      return {
        role: identity.role,
        pid: identity.pid,
        parentPid: identity.parentPid,
        startIdentity: identity.startIdentity,
        markerSource: identity.markerSource,
        verificationCode: identity.verificationCode,
        status,
        signalable: false,
        signalAttempted: false,
        signalAttempts: 0,
        manualCleanupRequired: status !== 'absent'
      }
    })
  )
  const statusAfterCleanup = Object.fromEntries(
    await Promise.all(
      [...preExit, ...unverifiedIdentities].map(async (identity) => [
        identity.role,
        await captureStatus(
          identity,
          'post-cleanup-status',
          identityVisibilityErrors,
          getIdentityStatus
        )
      ])
    )
  )
  const identitiesByRole = roleIdentities(events, preExit, unverifiedIdentities)
  const statusByRole = Object.fromEntries(
    Object.keys(identitiesByRole).map((role) => [role, statusAfterObservation[role] ?? 'not-captured'])
  )
  const utilityCallbacks = events.filter((event) => event.type === 'utility-callback')
  const utilityProbes = events.filter((event) => event.type === 'utility-probe')
  const utilitySettlements = events.filter((event) => event.type === 'utility-settled')
  const contract = evaluateHarnessContract({
    mode,
    error,
    statusByRole,
    ownerExit,
    utilitySettlements,
    before,
    preExit,
    postObservation
  })
  const cleanupOutcome = evaluateCleanupOutcome({
    postCleanup,
    statusAfterCleanup,
    visibilityErrors: identityVisibilityErrors,
    unverifiedCleanup
  })

  const artifact = redactArtifactPaths(
    {
    schemaVersion: 3,
    runId,
    marker,
    phase,
    mode,
    startedAt,
    completedAt: new Date().toISOString(),
    runtime: {
      platform: process.platform,
      arch: process.arch,
      osRelease: release(),
      distribution: 'development-fixture',
      packaged: false,
      nodeVersion: process.version,
      electronVersion: events.find((event) => event.electronVersion)?.electronVersion ?? null,
      electronExecutable: electronPath,
      harnessSha256
    },
    processTree: identitiesByRole,
    events,
    census: { before, preExit, postObservation, postCleanup },
    ownerExit,
    observation: {
      windowMs: observationMs,
      statusByRole,
      expectedOwnerExit: contract.expectedOwnerExit,
      utilityCallbacks,
      utilityProbes,
      utilitySettlements,
      checks: contract.checks,
      contractSatisfied: contract.contractSatisfied
    },
    cleanup: {
      attempts: cleanupAttempts,
      statusByRole: statusAfterCleanup,
      unverified: unverifiedCleanup,
      visibilityErrors: identityVisibilityErrors,
      ...cleanupOutcome
    },
    stderr,
    error,
    errorCode
    },
    {
      'run-root': runRoot,
      'output-dir': outputDir,
      'electron-executable': electronPath,
      'node-executable': process.execPath,
      'harness-root': scriptDir,
      home: homedir(),
      tmp: tmpdir()
    }
  )
  const output = await writeArtifact(artifact, outputDir)
  await rm(runRoot, { recursive: true, force: true })
  return { artifact, ...output }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = parseArguments(process.argv.slice(2))
  const result = await runProcessTreeHarness(options)
  process.stdout.write(result.report)
  process.stdout.write(`\nJSON artifact: ${result.jsonPath}\nMarkdown artifact: ${result.markdownPath}\n`)
  if (result.artifact.error || !result.artifact.cleanup.allMarkedGone) process.exitCode = 1
}
