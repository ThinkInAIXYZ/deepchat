import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { lstat, mkdtemp, open, readFile, readdir, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import type { PluginRuntimeFingerprint } from './runtimeSupervisor'

const execFileAsync = promisify(execFile)
const SHA256_PATTERN = /^[a-f0-9]{64}$/
const TEAM_ID_PATTERN = /^[A-Z0-9]{10}$/
const WINDOWS_EXECUTABLE_EXTENSIONS = new Set(['.bat', '.cmd', '.com', '.exe', '.ps1'])
const COMMAND_OUTPUT_LIMIT = 4 * 1024 * 1024
const COMMAND_TIMEOUT_MS = 15_000
const INTEGRITY_DESCRIPTOR_NAME = 'integrity.json'
const CUA_MACOS_ENTITLEMENTS = Object.freeze({
  'com.apple.security.automation.apple-events': true,
  'com.apple.security.device.screen-capture': true
})

type CuaMacosIntegrityContract = {
  bundlePath: string
  bundleIdentifier: string
  signatureType: 'ad-hoc' | 'developer-id'
  teamId: string | null
  hardenedRuntime: true
  entitlements: Record<string, true>
}

export type CuaRuntimeIntegrityDescriptor = {
  schemaVersion: 1
  pluginId: string
  runtimeId: string
  runtimeVersion: string
  target: string
  runtimeRoot: string
  binaryPath: string
  catalogPath: string
  files: Record<string, string>
  executablePaths: string[]
  macos?: CuaMacosIntegrityContract
}

type CommandResult = {
  stdout: string
  stderr: string
}

type IntegrityDependencies = {
  hashFile: (filePath: string) => Promise<string>
  runCommand: (command: string, args: string[]) => Promise<CommandResult>
  verifyMacSignature: (
    appPath: string,
    contract: CuaMacosIntegrityContract,
    runCommand: IntegrityDependencies['runCommand']
  ) => Promise<void>
}

export type CuaRuntimeIntegrityVerifierOptions = {
  pluginRoot: string
  binaryPath: string
  externalBinaryPath?: string
  platform: NodeJS.Platform
  arch: NodeJS.Architecture
  runtimeVersion: string
  descriptor: CuaRuntimeIntegrityDescriptor
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const deepFreeze = <T>(value: T): T => {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) {
    return value
  }
  for (const nested of Object.values(value)) {
    deepFreeze(nested)
  }
  return Object.freeze(value)
}

const exactKeys = (
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string
): void => {
  const actual = Object.keys(value).sort()
  const wanted = [...expected].sort()
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new Error(`${label} must contain exactly: ${wanted.join(', ')}`)
  }
}

const safeRelativePath = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || !value || value.includes('\\')) {
    throw new Error(`${label} must be a non-empty POSIX relative path`)
  }
  const segments = value.split('/')
  if (
    value.startsWith('/') ||
    /^[A-Za-z]:/.test(value) ||
    segments.some((segment) => !segment || segment === '.' || segment === '..')
  ) {
    throw new Error(`${label} is unsafe: ${value}`)
  }
  return value
}

const nonEmptyString = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim()) {
    throw new Error(`${label} must be a non-empty trimmed string`)
  }
  return value
}

const parseMacosContract = (input: unknown): CuaMacosIntegrityContract => {
  if (!isRecord(input)) {
    throw new Error('CUA runtime integrity macos contract must be an object')
  }
  exactKeys(
    input,
    [
      'bundlePath',
      'bundleIdentifier',
      'signatureType',
      'teamId',
      'hardenedRuntime',
      'entitlements'
    ],
    'CUA runtime integrity macos contract'
  )
  const signatureType = input.signatureType
  if (signatureType !== 'ad-hoc' && signatureType !== 'developer-id') {
    throw new Error('CUA runtime integrity macos signatureType is invalid')
  }
  const teamId = input.teamId
  if (
    (signatureType === 'developer-id' &&
      (typeof teamId !== 'string' || !TEAM_ID_PATTERN.test(teamId))) ||
    (signatureType === 'ad-hoc' && teamId !== null)
  ) {
    throw new Error('CUA runtime integrity macos teamId does not match its signature type')
  }
  if (input.hardenedRuntime !== true) {
    throw new Error('CUA runtime integrity macos contract must require hardened runtime')
  }
  if (!isRecord(input.entitlements)) {
    throw new Error('CUA runtime integrity macos entitlements must be an object')
  }
  exactKeys(
    input.entitlements,
    Object.keys(CUA_MACOS_ENTITLEMENTS),
    'CUA runtime integrity macos entitlements'
  )
  for (const entitlement of Object.keys(CUA_MACOS_ENTITLEMENTS)) {
    if (input.entitlements[entitlement] !== true) {
      throw new Error(`CUA runtime integrity entitlement must be true: ${entitlement}`)
    }
  }
  return {
    bundlePath: safeRelativePath(input.bundlePath, 'CUA runtime integrity macos bundlePath'),
    bundleIdentifier: nonEmptyString(
      input.bundleIdentifier,
      'CUA runtime integrity macos bundleIdentifier'
    ),
    signatureType,
    teamId: teamId as string | null,
    hardenedRuntime: true,
    entitlements: { ...CUA_MACOS_ENTITLEMENTS }
  }
}

export const parseCuaRuntimeIntegrityDescriptor = (
  input: unknown,
  source = '<in-memory>'
): CuaRuntimeIntegrityDescriptor => {
  try {
    if (!isRecord(input)) {
      throw new Error('root must be an object')
    }
    const requiredKeys = [
      'schemaVersion',
      'pluginId',
      'runtimeId',
      'runtimeVersion',
      'target',
      'runtimeRoot',
      'binaryPath',
      'catalogPath',
      'files',
      'executablePaths'
    ]
    const expectedKeys = input.macos === undefined ? requiredKeys : [...requiredKeys, 'macos']
    exactKeys(input, expectedKeys, 'CUA runtime integrity descriptor')
    if (input.schemaVersion !== 1) {
      throw new Error(`unsupported schemaVersion: ${String(input.schemaVersion)}`)
    }

    const target = nonEmptyString(input.target, 'CUA runtime integrity target')
    if (!/^(darwin|win32|linux)\/(arm64|x64)$/.test(target)) {
      throw new Error(`CUA runtime integrity target is invalid: ${target}`)
    }
    if (!isRecord(input.files) || Object.keys(input.files).length === 0) {
      throw new Error('CUA runtime integrity files must be a non-empty object')
    }
    const files = Object.fromEntries(
      Object.entries(input.files)
        .map(([filePath, digest]) => {
          const normalized = safeRelativePath(filePath, 'CUA runtime integrity file path')
          if (normalized === INTEGRITY_DESCRIPTOR_NAME) {
            throw new Error('CUA runtime integrity descriptor cannot hash itself')
          }
          if (typeof digest !== 'string' || !SHA256_PATTERN.test(digest)) {
            throw new Error(`CUA runtime integrity file has invalid SHA-256: ${normalized}`)
          }
          return [normalized, digest]
        })
        .sort(([left], [right]) => left.localeCompare(right))
    )
    if (
      !Array.isArray(input.executablePaths) ||
      input.executablePaths.length === 0 ||
      input.executablePaths.some((item) => typeof item !== 'string')
    ) {
      throw new Error('CUA runtime integrity executablePaths must be a non-empty string array')
    }
    const executablePaths = input.executablePaths.map((item) =>
      safeRelativePath(item, 'CUA runtime integrity executable path')
    )
    if (new Set(executablePaths).size !== executablePaths.length) {
      throw new Error('CUA runtime integrity executablePaths must be unique')
    }
    for (const executablePath of executablePaths) {
      if (!files[executablePath]) {
        throw new Error(
          `CUA runtime integrity executable is absent from the file set: ${executablePath}`
        )
      }
    }

    const binaryPath = safeRelativePath(input.binaryPath, 'CUA runtime integrity binaryPath')
    const catalogPath = safeRelativePath(input.catalogPath, 'CUA runtime integrity catalogPath')
    if (!files[binaryPath] || !executablePaths.includes(binaryPath)) {
      throw new Error('CUA runtime integrity binaryPath must be a declared executable file')
    }
    if (!files[catalogPath]) {
      throw new Error('CUA runtime integrity catalogPath must be present in the file set')
    }

    const macos = input.macos === undefined ? undefined : parseMacosContract(input.macos)
    if ((target.startsWith('darwin/') && !macos) || (!target.startsWith('darwin/') && macos)) {
      throw new Error('CUA runtime integrity macos contract must exist only for darwin targets')
    }
    if (macos && !binaryPath.startsWith(`${macos.bundlePath}/`)) {
      throw new Error('CUA runtime integrity macOS binary must be inside the declared bundle')
    }

    return deepFreeze({
      schemaVersion: 1,
      pluginId: nonEmptyString(input.pluginId, 'CUA runtime integrity pluginId'),
      runtimeId: nonEmptyString(input.runtimeId, 'CUA runtime integrity runtimeId'),
      runtimeVersion: nonEmptyString(input.runtimeVersion, 'CUA runtime integrity runtimeVersion'),
      target,
      runtimeRoot: safeRelativePath(input.runtimeRoot, 'CUA runtime integrity runtimeRoot'),
      binaryPath,
      catalogPath,
      files,
      executablePaths,
      ...(macos ? { macos } : {})
    })
  } catch (error) {
    throw new Error(
      `Invalid CUA runtime integrity descriptor "${source}": ${
        error instanceof Error ? error.message : String(error)
      }`,
      { cause: error }
    )
  }
}

const hashFile = async (filePath: string): Promise<string> => {
  const handle = await open(filePath, 'r')
  try {
    const hash = createHash('sha256')
    const buffer = Buffer.allocUnsafe(1024 * 1024)
    let position = 0
    while (true) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, position)
      if (bytesRead === 0) {
        return hash.digest('hex')
      }
      hash.update(buffer.subarray(0, bytesRead))
      position += bytesRead
    }
  } finally {
    await handle.close()
  }
}

const runCommand = async (command: string, args: string[]): Promise<CommandResult> => {
  const result = await execFileAsync(command, args, {
    encoding: 'utf8',
    maxBuffer: COMMAND_OUTPUT_LIMIT,
    timeout: COMMAND_TIMEOUT_MS
  })
  return {
    stdout: String(result.stdout ?? ''),
    stderr: String(result.stderr ?? '')
  }
}

const commandOutput = (result: CommandResult): string => `${result.stdout}\n${result.stderr}`

const extractMacEntitlements = async (
  appPath: string,
  commandRunner: IntegrityDependencies['runCommand']
): Promise<Record<string, unknown>> => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'deepchat-cua-runtime-integrity-'))
  const entitlementPath = path.join(temporaryRoot, 'entitlements.plist')
  let operationError: unknown
  let entitlements: Record<string, unknown> | undefined
  try {
    await commandRunner('/usr/bin/codesign', [
      '--display',
      '--xml',
      '--entitlements',
      entitlementPath,
      appPath
    ])
    const entitlementBytes = await readFile(entitlementPath)
    if (entitlementBytes.length === 0) {
      throw new Error('CUA macOS runtime signature does not contain entitlements')
    }
    const converted = await commandRunner('/usr/bin/plutil', [
      '-convert',
      'json',
      '-o',
      '-',
      '--',
      entitlementPath
    ])
    const parsed = JSON.parse(converted.stdout) as unknown
    if (!isRecord(parsed)) {
      throw new Error('CUA macOS runtime entitlements are not a dictionary')
    }
    entitlements = parsed
  } catch (error) {
    operationError = error
  }
  try {
    await rm(temporaryRoot, { recursive: true, force: true })
  } catch (cleanupError) {
    if (operationError) {
      throw new AggregateError(
        [operationError, cleanupError],
        'CUA macOS entitlement verification failed and cleanup was incomplete'
      )
    }
    throw cleanupError
  }
  if (operationError) {
    throw operationError
  }
  if (!entitlements) {
    throw new Error('CUA macOS runtime entitlement verification returned no result')
  }
  return entitlements
}

const verifyMacSignature = async (
  appPath: string,
  contract: CuaMacosIntegrityContract,
  commandRunner: IntegrityDependencies['runCommand']
): Promise<void> => {
  await commandRunner('/usr/bin/codesign', [
    '--verify',
    '--deep',
    '--strict',
    '--verbose=2',
    appPath
  ])
  const metadata = commandOutput(
    await commandRunner('/usr/bin/codesign', ['--display', '--verbose=4', appPath])
  )
  const identifier = metadata.match(/^Identifier=(.+)$/m)?.[1]?.trim()
  if (identifier !== contract.bundleIdentifier) {
    throw new Error(
      `CUA macOS runtime bundle identifier mismatch: expected ${contract.bundleIdentifier}, received ${identifier ?? '<missing>'}`
    )
  }
  if (!/^CodeDirectory\b.*\bflags=.*\([^)]*\bruntime\b[^)]*\)/m.test(metadata)) {
    throw new Error('CUA macOS runtime signature does not enable hardened runtime')
  }

  const teamId = metadata.match(/^TeamIdentifier=(.+)$/m)?.[1]?.trim()
  if (contract.signatureType === 'developer-id') {
    if (!/^Authority=Developer ID Application:/m.test(metadata)) {
      throw new Error('CUA macOS runtime is not signed with a Developer ID Application identity')
    }
    const timestamp = metadata.match(/^Timestamp=(.+)$/m)?.[1]?.trim()
    if (!timestamp || timestamp.toLowerCase() === 'none') {
      throw new Error('CUA macOS runtime Developer ID signature has no secure timestamp')
    }
    if (teamId !== contract.teamId) {
      throw new Error(
        `CUA macOS runtime Team ID mismatch: expected ${contract.teamId}, received ${teamId ?? '<missing>'}`
      )
    }
    await commandRunner('/usr/bin/codesign', [
      '--verify',
      '--strict',
      '--test-requirement',
      `=anchor apple generic and certificate leaf[subject.OU] = "${contract.teamId}"`,
      appPath
    ])
  } else if (!/^Signature=adhoc$/m.test(metadata) || teamId !== 'not set') {
    throw new Error('CUA macOS runtime does not match the expected ad-hoc signing identity')
  }

  const entitlements = await extractMacEntitlements(appPath, commandRunner)
  exactKeys(entitlements, Object.keys(contract.entitlements), 'CUA macOS runtime entitlements')
  for (const [key, value] of Object.entries(contract.entitlements)) {
    if (entitlements[key] !== value) {
      throw new Error(`CUA macOS runtime entitlement mismatch: ${key}`)
    }
  }
}

const defaultDependencies: IntegrityDependencies = {
  hashFile,
  runCommand,
  verifyMacSignature
}

const isContainedPath = (root: string, candidate: string): boolean => {
  const relative = path.relative(root, candidate)
  return (
    relative === '' ||
    (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  )
}

const resolveRelativePath = (root: string, relativePath: string): string => {
  const resolved = path.resolve(root, ...relativePath.split('/'))
  if (!isContainedPath(root, resolved)) {
    throw new Error(`CUA runtime integrity path escapes its root: ${relativePath}`)
  }
  return resolved
}

const assertDirectoryChain = async (root: string, relativePath: string): Promise<void> => {
  const rootStat = await lstat(root)
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw new Error(`CUA runtime integrity root must be a real directory: ${root}`)
  }
  let current = root
  for (const segment of relativePath.split('/')) {
    current = path.join(current, segment)
    const stat = await lstat(current)
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error(`CUA runtime integrity directory must not be linked: ${current}`)
    }
  }
}

const normalizedAbsolutePath = (value: string): string =>
  process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value)

const pathsEqual = (left: string, right: string): boolean =>
  normalizedAbsolutePath(left) === normalizedAbsolutePath(right)

type CollectedFile = {
  logicalPath: string
  actualPath: string
  mode: number
}

const collectFiles = async (
  directory: string,
  logicalPrefix = '',
  options: { skipTopLevelDirectory?: string; skipDescriptor?: boolean } = {}
): Promise<CollectedFile[]> => {
  const directoryStat = await lstat(directory)
  if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory()) {
    throw new Error(`CUA runtime integrity root must be a real directory: ${directory}`)
  }
  const entries = await readdir(directory, { withFileTypes: true })
  entries.sort((left, right) => left.name.localeCompare(right.name))
  const files: CollectedFile[] = []
  for (const entry of entries) {
    if (!logicalPrefix && entry.name === options.skipTopLevelDirectory) {
      continue
    }
    if (!logicalPrefix && options.skipDescriptor && entry.name === INTEGRITY_DESCRIPTOR_NAME) {
      continue
    }
    const actualPath = path.join(directory, entry.name)
    const logicalPath = logicalPrefix ? `${logicalPrefix}/${entry.name}` : entry.name
    const stat = await lstat(actualPath)
    if (stat.isSymbolicLink()) {
      throw new Error(`CUA runtime integrity rejects symbolic links: ${actualPath}`)
    }
    if (stat.isDirectory()) {
      files.push(...(await collectFiles(actualPath, logicalPath)))
      continue
    }
    if (!stat.isFile()) {
      throw new Error(`CUA runtime integrity rejects non-regular files: ${actualPath}`)
    }
    files.push({ logicalPath, actualPath, mode: stat.mode })
  }
  return files
}

const isExecutableFile = (file: CollectedFile, platform: NodeJS.Platform): boolean =>
  platform === 'win32'
    ? WINDOWS_EXECUTABLE_EXTENSIONS.has(path.extname(file.actualPath).toLowerCase())
    : (file.mode & 0o111) !== 0

export class CuaRuntimeIntegrityVerifier {
  private readonly dependencies: IntegrityDependencies

  constructor(
    private readonly options: CuaRuntimeIntegrityVerifierOptions,
    dependencies: Partial<IntegrityDependencies> = {}
  ) {
    this.dependencies = { ...defaultDependencies, ...dependencies }
  }

  async verifyCatalog(catalogPath: string): Promise<string> {
    this.assertDescriptorIdentity()
    const { descriptor } = this.options
    const runtimeRoot = resolveRelativePath(this.options.pluginRoot, descriptor.runtimeRoot)
    await assertDirectoryChain(this.options.pluginRoot, descriptor.runtimeRoot)
    const expectedCatalogPath = resolveRelativePath(runtimeRoot, descriptor.catalogPath)
    if (!pathsEqual(catalogPath, expectedCatalogPath)) {
      throw new Error(`CUA tool catalog is outside its integrity contract: ${catalogPath}`)
    }
    const stat = await lstat(expectedCatalogPath)
    if (stat.isSymbolicLink() || !stat.isFile()) {
      throw new Error(`CUA tool catalog must be a regular file: ${expectedCatalogPath}`)
    }
    const contents = await readFile(expectedCatalogPath)
    const digest = createHash('sha256').update(contents).digest('hex')
    if (digest !== descriptor.files[descriptor.catalogPath]) {
      throw new Error('CUA tool catalog integrity mismatch; repair or reinstall the plugin')
    }
    return contents.toString('utf8')
  }

  async verify(): Promise<PluginRuntimeFingerprint> {
    this.assertDescriptorIdentity()
    const { descriptor } = this.options
    const expectedTarget = descriptor.target
    const runtimeRoot = resolveRelativePath(this.options.pluginRoot, descriptor.runtimeRoot)
    await assertDirectoryChain(this.options.pluginRoot, descriptor.runtimeRoot)
    const localBinaryPath = resolveRelativePath(runtimeRoot, descriptor.binaryPath)
    const usesLocalRuntime = pathsEqual(this.options.binaryPath, localBinaryPath)
    const usesExternalMacRuntime =
      this.options.platform === 'darwin' &&
      Boolean(this.options.externalBinaryPath) &&
      pathsEqual(this.options.binaryPath, this.options.externalBinaryPath!)
    if (!usesLocalRuntime && !usesExternalMacRuntime) {
      throw new Error(
        `CUA runtime binary is outside its registered launch roots: ${this.options.binaryPath}`
      )
    }

    let files: CollectedFile[]
    let macAppPath: string | undefined
    if (usesExternalMacRuntime) {
      const macos = descriptor.macos!
      macAppPath = path.resolve(
        this.options.binaryPath,
        ...Array(descriptor.binaryPath.split('/').length - macos.bundlePath.split('/').length).fill(
          '..'
        )
      )
      const externalBundleFiles = await collectFiles(macAppPath, macos.bundlePath)
      const installedFiles = await collectFiles(runtimeRoot, '', {
        skipTopLevelDirectory: macos.bundlePath.split('/')[0],
        skipDescriptor: true
      })
      files = [...externalBundleFiles, ...installedFiles]
    } else {
      files = await collectFiles(runtimeRoot, '', { skipDescriptor: true })
      if (descriptor.macos) {
        macAppPath = resolveRelativePath(runtimeRoot, descriptor.macos.bundlePath)
      }
    }

    const actualByLogicalPath = new Map(files.map((file) => [file.logicalPath, file]))
    if (actualByLogicalPath.size !== files.length) {
      throw new Error('CUA runtime integrity found duplicate logical artifact paths')
    }
    const expectedPaths = Object.keys(descriptor.files).sort()
    const actualPaths = [...actualByLogicalPath.keys()].sort()
    if (
      expectedPaths.length !== actualPaths.length ||
      expectedPaths.some((filePath, index) => filePath !== actualPaths[index])
    ) {
      const missing = expectedPaths.filter((filePath) => !actualByLogicalPath.has(filePath))
      const unexpected = actualPaths.filter((filePath) => !descriptor.files[filePath])
      throw new Error(
        `CUA runtime file set mismatch (missing: ${missing.join(', ') || 'none'}; unexpected: ${unexpected.join(', ') || 'none'})`
      )
    }

    const expectedExecutables = new Set(descriptor.executablePaths)
    for (const file of files) {
      const executable = isExecutableFile(file, this.options.platform)
      if (executable !== expectedExecutables.has(file.logicalPath)) {
        throw new Error(
          executable
            ? `CUA runtime contains an unexpected executable: ${file.logicalPath}`
            : `CUA runtime declared executable is not executable: ${file.logicalPath}`
        )
      }
    }

    const actualHashes = new Map<string, string>()
    for (const filePath of expectedPaths) {
      const actualFile = actualByLogicalPath.get(filePath)!
      const digest = await this.dependencies.hashFile(actualFile.actualPath)
      if (digest !== descriptor.files[filePath]) {
        throw new Error(
          `CUA runtime integrity mismatch for ${filePath}; repair or reinstall the plugin`
        )
      }
      actualHashes.set(filePath, digest)
    }

    if (descriptor.macos) {
      if (!macAppPath) {
        throw new Error('CUA macOS runtime bundle path could not be resolved')
      }
      await this.dependencies.verifyMacSignature(
        macAppPath,
        descriptor.macos,
        this.dependencies.runCommand
      )
    }

    const binarySha256 = actualHashes.get(descriptor.binaryPath)!
    const fingerprintFields = {
      pluginId: descriptor.pluginId,
      runtimeId: descriptor.runtimeId,
      target: expectedTarget,
      binarySha256
    }
    return deepFreeze({
      value: createHash('sha256').update(JSON.stringify(fingerprintFields)).digest('hex'),
      ...fingerprintFields
    })
  }

  private assertDescriptorIdentity(): void {
    const { descriptor } = this.options
    const expectedTarget = `${this.options.platform}/${this.options.arch}`
    if (descriptor.pluginId !== 'com.deepchat.plugins.cua') {
      throw new Error(
        `CUA runtime integrity descriptor has unexpected plugin: ${descriptor.pluginId}`
      )
    }
    if (descriptor.runtimeId !== 'cua-driver') {
      throw new Error(
        `CUA runtime integrity descriptor has unexpected runtime: ${descriptor.runtimeId}`
      )
    }
    if (descriptor.runtimeVersion !== this.options.runtimeVersion) {
      throw new Error(
        `CUA runtime integrity version mismatch: expected ${this.options.runtimeVersion}, received ${descriptor.runtimeVersion}`
      )
    }
    if (descriptor.target !== expectedTarget) {
      throw new Error(
        `CUA runtime integrity target mismatch: expected ${expectedTarget}, received ${descriptor.target}`
      )
    }
  }
}
