import { execFile } from 'node:child_process'
import {
  lstat,
  mkdtemp,
  open,
  readFile,
  readdir,
  realpath,
  rm
} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

import { validateAppleTeamId } from '../apple-notarization.js'
import {
  CUA_DARWIN_ALLOWED_ENTITLEMENTS,
  CUA_DARWIN_HELPER_APP_NAME,
  CUA_DARWIN_HELPER_BUNDLE_IDENTIFIER,
  CUA_DARWIN_HELPER_EXECUTABLE_NAME,
  findDisallowedDarwinLoadPaths,
  parseDarwinLinkedLibraries,
  parseDarwinRpaths
} from '../cua-macos-contract.mjs'

const execFileAsync = promisify(execFile)
const COMMAND_OUTPUT_LIMIT = 4 * 1024 * 1024
const MACH_O_MAGIC = new Set([
  'bebafeca',
  'bfbafeca',
  'cafebabe',
  'cafebabf',
  'cefaedfe',
  'cffaedfe',
  'feedface',
  'feedfacf'
])

async function runCommandWithOutput(runCommand, command, args) {
  return await runCommand(command, args, {
    encoding: 'utf8',
    maxBuffer: COMMAND_OUTPUT_LIMIT
  })
}

function commandOutput(result) {
  return `${result?.stdout ?? ''}\n${result?.stderr ?? ''}`
}

export function assertCuaDeveloperIdMetadata(result) {
  const details = commandOutput(result)
  if (!/^Authority=Developer ID Application:/m.test(details)) {
    throw new Error('CUA macOS helper is not signed with a Developer ID Application certificate')
  }
  const timestamp = details.match(/^Timestamp=(.+)$/m)?.[1]?.trim()
  if (!timestamp || timestamp.toLowerCase() === 'none') {
    throw new Error('CUA macOS helper Developer ID signature does not contain a secure timestamp')
  }
  if (!/^CodeDirectory\b.*\bflags=.*\([^)]*\bruntime\b[^)]*\)/m.test(details)) {
    throw new Error('CUA macOS helper signature does not enable hardened runtime')
  }
  const identifier = details.match(/^Identifier=(.+)$/m)?.[1]?.trim()
  if (identifier !== CUA_DARWIN_HELPER_BUNDLE_IDENTIFIER) {
    throw new Error(
      `CUA macOS helper bundle identifier mismatch: ${identifier || '<missing>'}`
    )
  }
}

export function assertCuaEntitlements(entitlements) {
  if (!entitlements || typeof entitlements !== 'object' || Array.isArray(entitlements)) {
    throw new Error('CUA macOS helper entitlements must be a dictionary')
  }

  const expectedKeys = Object.keys(CUA_DARWIN_ALLOWED_ENTITLEMENTS).sort()
  const actualKeys = Object.keys(entitlements).sort()
  const keysMatch =
    expectedKeys.length === actualKeys.length &&
    expectedKeys.every((key, index) => key === actualKeys[index])
  const valuesMatch = expectedKeys.every(
    (key) => entitlements[key] === CUA_DARWIN_ALLOWED_ENTITLEMENTS[key]
  )
  if (!keysMatch || !valuesMatch) {
    throw new Error(
      `CUA macOS helper entitlements must exactly match ${JSON.stringify(CUA_DARWIN_ALLOWED_ENTITLEMENTS)}, received ${JSON.stringify(entitlements)}`
    )
  }
}

export function assertCuaMachOLoadPaths(inspections) {
  if (!Array.isArray(inspections) || inspections.length === 0) {
    throw new Error('CUA macOS helper does not contain an inspectable Mach-O executable')
  }

  for (const inspection of inspections) {
    const disallowedRpaths = findDisallowedDarwinLoadPaths(inspection.rpaths)
    if (disallowedRpaths.length > 0) {
      throw new Error(
        `CUA Mach-O contains non-system RPATHs (${disallowedRpaths.join(', ')}): ${inspection.filePath}`
      )
    }
    const disallowedLibraries = findDisallowedDarwinLoadPaths(inspection.linkedLibraries)
    if (disallowedLibraries.length > 0) {
      throw new Error(
        `CUA Mach-O contains non-system linked libraries (${disallowedLibraries.join(', ')}): ${inspection.filePath}`
      )
    }
  }
}

function isContainedPath(rootPath, candidatePath) {
  const relative = path.relative(rootPath, candidatePath)
  return (
    relative === '' ||
    (relative !== '..' &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative))
  )
}

async function hasMachOCandidateMagic(filePath) {
  const handle = await open(filePath, 'r')
  try {
    const header = Buffer.alloc(4)
    const { bytesRead } = await handle.read(header, 0, header.length, 0)
    return bytesRead === header.length && MACH_O_MAGIC.has(header.toString('hex'))
  } finally {
    await handle.close()
  }
}

async function collectRegularFiles(directory, bundleRootRealPath) {
  const entries = await readdir(directory, { withFileTypes: true })
  entries.sort((left, right) => left.name.localeCompare(right.name))
  const files = []
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await collectRegularFiles(entryPath, bundleRootRealPath)))
    } else if (entry.isFile()) {
      files.push(entryPath)
    } else if (entry.isSymbolicLink()) {
      let resolvedTarget
      try {
        resolvedTarget = await realpath(entryPath)
      } catch {
        throw new Error(`CUA macOS helper contains a broken symbolic link: ${entryPath}`)
      }
      if (!isContainedPath(bundleRootRealPath, resolvedTarget)) {
        throw new Error(
          `CUA macOS helper symbolic link escapes the bundle: ${entryPath} -> ${resolvedTarget}`
        )
      }
    } else {
      throw new Error(`CUA macOS helper contains an unsupported file type: ${entryPath}`)
    }
  }
  return files
}

export async function extractCuaEntitlements(
  helperAppPath,
  { runCommand = execFileAsync } = {}
) {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'deepchat-cua-entitlements-'))
  const entitlementsPath = path.join(tempRoot, 'entitlements.plist')
  try {
    await runCommandWithOutput(runCommand, '/usr/bin/codesign', [
      '--display',
      '--xml',
      '--entitlements',
      entitlementsPath,
      helperAppPath
    ])
    let entitlementBytes
    try {
      entitlementBytes = await readFile(entitlementsPath)
    } catch {
      throw new Error('CUA macOS helper signature does not contain entitlements')
    }
    if (entitlementBytes.length === 0) {
      throw new Error('CUA macOS helper signature does not contain entitlements')
    }
    const result = await runCommandWithOutput(runCommand, '/usr/bin/plutil', [
      '-convert',
      'json',
      '-o',
      '-',
      '--',
      entitlementsPath
    ])
    return JSON.parse(result.stdout)
  } finally {
    await rm(tempRoot, { recursive: true, force: true })
  }
}

export async function inspectCuaHelperBundle(
  helperAppPath,
  {
    runCommand = execFileAsync,
    readEntitlements = extractCuaEntitlements
  } = {}
) {
  const helperExecutablePath = path.join(
    helperAppPath,
    'Contents',
    'MacOS',
    CUA_DARWIN_HELPER_EXECUTABLE_NAME
  )
  for (const directory of [
    helperAppPath,
    path.join(helperAppPath, 'Contents'),
    path.join(helperAppPath, 'Contents', 'MacOS')
  ]) {
    const directoryStat = await lstat(directory)
    if (directoryStat.isSymbolicLink()) {
      throw new Error(`CUA macOS helper directory must not be a symbolic link: ${directory}`)
    }
    if (!directoryStat.isDirectory()) {
      throw new Error(`CUA macOS helper path is not a directory: ${directory}`)
    }
  }
  const executableStat = await lstat(helperExecutablePath)
  if (executableStat.isSymbolicLink()) {
    throw new Error(
      `CUA macOS helper executable must not be a symbolic link: ${helperExecutablePath}`
    )
  }
  if (!executableStat.isFile()) {
    throw new Error(`CUA macOS helper executable is not a regular file: ${helperExecutablePath}`)
  }

  const entitlements = await readEntitlements(helperAppPath, { runCommand })
  const inspections = []
  const bundleRootRealPath = await realpath(helperAppPath)
  for (const filePath of await collectRegularFiles(helperAppPath, bundleRootRealPath)) {
    if (!(await hasMachOCandidateMagic(filePath))) {
      continue
    }
    const fileResult = await runCommandWithOutput(runCommand, '/usr/bin/file', ['-b', filePath])
    if (!fileResult.stdout.includes('Mach-O')) {
      continue
    }
    const [loadCommands, linkedLibraries] = await Promise.all([
      runCommandWithOutput(runCommand, '/usr/bin/otool', ['-l', filePath]),
      runCommandWithOutput(runCommand, '/usr/bin/otool', ['-L', filePath])
    ])
    inspections.push({
      filePath,
      rpaths: parseDarwinRpaths(loadCommands.stdout),
      linkedLibraries: parseDarwinLinkedLibraries(linkedLibraries.stdout)
    })
  }

  if (!inspections.some(({ filePath }) => filePath === helperExecutablePath)) {
    throw new Error(`CUA macOS helper executable is not Mach-O: ${helperExecutablePath}`)
  }
  return { entitlements, inspections }
}

export async function verifyCuaMacHelperDistribution(
  macAppPath,
  {
    teamId,
    runCommand = execFileAsync,
    inspectBundle = inspectCuaHelperBundle
  } = {}
) {
  const validatedTeamId = validateAppleTeamId(teamId, 'CUA helper Team ID')
  const helperAppPath = path.join(
    macAppPath,
    'Contents',
    'Helpers',
    CUA_DARWIN_HELPER_APP_NAME
  )
  const teamRequirement =
    `=anchor apple generic and certificate leaf[subject.OU] = "${validatedTeamId}"`

  await runCommandWithOutput(runCommand, '/usr/bin/codesign', [
    '--verify',
    '--deep',
    '--strict',
    '--verbose=2',
    helperAppPath
  ])
  const metadata = await runCommandWithOutput(runCommand, '/usr/bin/codesign', [
    '--display',
    '--verbose=4',
    helperAppPath
  ])
  assertCuaDeveloperIdMetadata(metadata)
  await runCommandWithOutput(runCommand, '/usr/bin/codesign', [
    '--verify',
    '--strict',
    '--test-requirement',
    teamRequirement,
    helperAppPath
  ])

  const { entitlements, inspections } = await inspectBundle(helperAppPath, { runCommand })
  assertCuaEntitlements(entitlements)
  assertCuaMachOLoadPaths(inspections)
  for (const { filePath } of inspections) {
    await runCommandWithOutput(runCommand, '/usr/bin/codesign', [
      '--verify',
      '--strict',
      '--test-requirement',
      teamRequirement,
      filePath
    ])
  }

  return {
    helperAppPath,
    inspectedMachOCount: inspections.length
  }
}
