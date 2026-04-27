import { execFileSync, spawnSync } from 'child_process'
import fs from 'fs/promises'
import fsSync from 'fs'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')

const CUA_REPO_URL = 'https://github.com/trycua/cua.git'
const CUA_TAG = 'cua-driver-v0.0.5'
const CUA_COMMIT = '1a53f4bc33075be1fac5fceee7c7214452d6fda1'
const HELPER_BUNDLE_ID = 'com.wefonk.deepchat.computeruse'
const HELPER_APP_NAME = 'DeepChat Computer Use'
const HELPER_APP_DIR_NAME = `${HELPER_APP_NAME}.app`
const HELPER_BINARY_NAME = 'cua-driver'
const CUA_VERSION = '0.0.5'

const archMap = {
  arm64: {
    swift: 'arm64',
    lipo: 'arm64'
  },
  x64: {
    swift: 'x86_64',
    lipo: 'x86_64'
  }
}

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

function ensureTool(command, args = ['--version']) {
  const result = spawnSync(command, args, { stdio: 'ignore' })
  if (result.error) {
    throw new Error(`Required tool is missing: ${command}`)
  }
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath)
    return true
  } catch {
    return false
  }
}

async function cloneOrUpdateSource(cacheRoot) {
  if (!(await pathExists(path.join(cacheRoot, '.git')))) {
    await fs.rm(cacheRoot, { recursive: true, force: true })
    await fs.mkdir(path.dirname(cacheRoot), { recursive: true })
    run('git', [
      'clone',
      '--filter=blob:none',
      '--branch',
      CUA_TAG,
      '--single-branch',
      CUA_REPO_URL,
      cacheRoot
    ])
  } else {
    run('git', ['fetch', '--tags', 'origin', CUA_TAG], { cwd: cacheRoot })
    run('git', ['checkout', '--force', CUA_TAG], { cwd: cacheRoot })
  }

  const commit = read('git', ['rev-parse', 'HEAD'], { cwd: cacheRoot })
  if (commit !== CUA_COMMIT) {
    throw new Error(`CUA Driver commit mismatch. Expected ${CUA_COMMIT}, got ${commit}`)
  }
}

async function replaceInFile(filePath, replacements) {
  let content = await fs.readFile(filePath, 'utf8')
  const original = content
  for (const [from, to] of replacements) {
    content = content.split(from).join(to)
  }
  if (content !== original) {
    await fs.writeFile(filePath, content)
  }
}

async function patchSource(sourceDir) {
  const replacements = [
    ['com.trycua.driver', HELPER_BUNDLE_ID],
    ['CuaDriver.app', HELPER_APP_DIR_NAME],
    ['Cua Driver', HELPER_APP_NAME],
    ['"CuaDriver"', `"${HELPER_APP_NAME}"`],
    ['CuaDriver Permissions', `${HELPER_APP_NAME} Permissions`],
    ['CuaDriver is ready', `${HELPER_APP_NAME} is ready`],
    ['CuaDriver needs your permission', `${HELPER_APP_NAME} needs your permission`],
    ['CuaDriver can inspect', `${HELPER_APP_NAME} can inspect`],
    ['CuaDriver read', `${HELPER_APP_NAME} read`],
    ['CuaDriver capture', `${HELPER_APP_NAME} capture`],
    ['CuaDriver.app', HELPER_APP_DIR_NAME]
  ]

  const swiftFiles = await collectFiles(path.join(sourceDir, 'Sources'), '.swift')
  for (const filePath of swiftFiles) {
    await replaceInFile(filePath, replacements)
  }

  await patchCommandEntrypoint(
    path.join(sourceDir, 'Sources', 'CuaDriverCLI', 'CuaDriverCommand.swift')
  )
  await patchNonBlockingStartup(path.join(sourceDir, 'Sources', 'CuaDriverCLI'))

  const configPath = path.join(sourceDir, 'Sources', 'CuaDriverCore', 'Config', 'CuaDriverConfig.swift')
  await replaceInFile(configPath, [
    ['telemetryEnabled: Bool = true', 'telemetryEnabled: Bool = false'],
    ['autoUpdateEnabled: Bool = true', 'autoUpdateEnabled: Bool = false'],
    [
      '(try? container.decode(Bool.self, forKey: .telemetryEnabled)) ?? true',
      '(try? container.decode(Bool.self, forKey: .telemetryEnabled)) ?? false'
    ],
    [
      '(try? container.decode(Bool.self, forKey: .autoUpdateEnabled)) ?? true',
      '(try? container.decode(Bool.self, forKey: .autoUpdateEnabled)) ?? false'
    ]
  ])

  const telemetryPath = path.join(
    sourceDir,
    'Sources',
    'CuaDriverCore',
    'Telemetry',
    'TelemetryClient.swift'
  )
  const telemetryContent = await fs.readFile(telemetryPath, 'utf8')
  if (!telemetryContent.includes('guard isEnabledSync() else { return }')) {
    await replaceInFile(telemetryPath, [
      [
        'public func recordInstallation() {\n',
        'public func recordInstallation() {\n        guard isEnabledSync() else { return }\n'
      ]
    ])
  }
}

async function patchCommandEntrypoint(commandPath) {
  let content = await fs.readFile(commandPath, 'utf8')
  if (!content.includes('DeepChatPermissionProbeCommand.self')) {
    content = content.replace(
      'subcommands: [\n            MCPCommand.self,',
      'subcommands: [\n            DeepChatPermissionProbeCommand.self,\n            MCPCommand.self,'
    )
  }

  if (!content.includes('"deepchat-permission-probe"')) {
    content = content.replace(
      'private static let managementSubcommands: Set<String> = [\n        "mcp",',
      'private static let managementSubcommands: Set<String> = [\n        "deepchat-permission-probe",\n        "mcp",'
    )
  }

  if (!content.includes('struct DeepChatPermissionProbeCommand')) {
    content = content.replace(
      '/// Top-level entry point. Before handing to ArgumentParser, rewrite\n',
      `struct DeepChatPermissionProbeCommand: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "deepchat-permission-probe",
        abstract: "Prompt for and write DeepChat helper TCC permission status JSON."
    )

    @Option(name: .long, help: "Path to write the permission status JSON.")
    var output: String

    @Flag(name: .long, help: "Raise macOS permission prompts before checking.")
    var prompt: Bool = false

    func run() async throws {
        if prompt {
            _ = Permissions.requestAccessibility()
            _ = Permissions.requestScreenRecording()
            try? await Task.sleep(nanoseconds: 500_000_000)
        }
        let status = await Permissions.currentStatus()
        let outputURL = URL(fileURLWithPath: output)
        try FileManager.default.createDirectory(
            at: outputURL.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.withoutEscapingSlashes, .sortedKeys]
        let data = try encoder.encode(status)
        try data.write(to: outputURL, options: .atomic)
    }
}

/// Top-level entry point. Before handing to ArgumentParser, rewrite
`
    )
  }

  await fs.writeFile(commandPath, content)
}

async function patchNonBlockingStartup(cliDir) {
  const commandPath = path.join(cliDir, 'CuaDriverCommand.swift')
  await replaceInFile(commandPath, [
    [
      `            // Preflight TCC grants. When both are already active this
            // returns immediately; otherwise a small panel guides the
            // user through granting them and we resume once everything
            // flips green. User closing the panel without granting ->
            // exit with a clear message.
            let granted = await MainActor.run {
                PermissionsGate.shared
            }.ensureGranted()
            if !granted {
                FileHandle.standardError.write(
                    Data(
                        "cua-driver: required permissions (Accessibility + Screen Recording) not granted; MCP server exiting.\\n"
                            .utf8))
                throw AppKitBootstrapError.permissionsDenied
            }

`,
      `            // Keep MCP startup non-blocking. Permission setup is handled by DeepChat's
            // settings UI and individual tools report missing grants when invoked.
`
    ]
  ])

  const servePath = path.join(cliDir, 'ServeCommand.swift')
  await replaceInFile(servePath, [
    [
      `            // Preflight TCC grants BEFORE we acquire the daemon lock —
            // otherwise a first-run user who needs to grant perms would
            // be blocked by "another daemon starting" if they ran
            // \`serve\` once, saw the permissions panel, and triggered
            // any sibling probe. Panel flow is idempotent and cheap
            // (<50ms) when grants are already live.
            let granted = await MainActor.run {
                PermissionsGate.shared
            }.ensureGranted()
            if !granted {
                FileHandle.standardError.write(
                    Data(
                        "cua-driver: required permissions (Accessibility + Screen Recording) not granted; daemon exiting.\\n"
                            .utf8))
                throw AppKitBootstrapError.permissionsDenied
            }

`,
      `            // Keep daemon startup non-blocking. Tools surface permission errors at use time,
            // while DeepChat settings owns the guided TCC setup flow.
`
    ]
  ])
}

async function collectFiles(dir, extension) {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(entryPath, extension)))
    } else if (entry.isFile() && entry.name.endsWith(extension)) {
      files.push(entryPath)
    }
  }
  return files
}

async function findBuiltBinary(scratchPath) {
  const candidates = await collectFiles(scratchPath, '')
  const binaries = candidates.filter((candidate) => path.basename(candidate) === HELPER_BINARY_NAME)
  for (const candidate of binaries) {
    const stat = await fs.stat(candidate)
    if ((stat.mode & 0o111) !== 0 && candidate.includes(`${path.sep}release${path.sep}`)) {
      return candidate
    }
  }
  throw new Error('Built cua-driver binary was not found')
}

function plistXml() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key>
  <string>${HELPER_BUNDLE_ID}</string>
  <key>CFBundleName</key>
  <string>${HELPER_APP_NAME}</string>
  <key>CFBundleDisplayName</key>
  <string>${HELPER_APP_NAME}</string>
  <key>CFBundleExecutable</key>
  <string>${HELPER_BINARY_NAME}</string>
  <key>CFBundleIconFile</key>
  <string>AppIcon</string>
  <key>CFBundleIconName</key>
  <string>AppIcon</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>${CUA_VERSION}</string>
  <key>CFBundleVersion</key>
  <string>${CUA_VERSION}</string>
  <key>LSMinimumSystemVersion</key>
  <string>14.0</string>
  <key>LSUIElement</key>
  <true/>
  <key>NSHighResolutionCapable</key>
  <true/>
  <key>NSSupportsAutomaticTermination</key>
  <true/>
</dict>
</plist>
`
}

async function stageApp(sourceDir, builtBinary, targetArch) {
  const currentDir = path.join(rootDir, 'runtime', 'computer-use', 'cua-driver', 'current')
  const helperAppPath = path.join(currentDir, HELPER_APP_DIR_NAME)
  const contentsPath = path.join(helperAppPath, 'Contents')
  const macosPath = path.join(contentsPath, 'MacOS')
  const resourcesPath = path.join(contentsPath, 'Resources')
  const stagedBinary = path.join(macosPath, HELPER_BINARY_NAME)

  await fs.rm(currentDir, { recursive: true, force: true })
  await fs.mkdir(macosPath, { recursive: true })
  await fs.mkdir(resourcesPath, { recursive: true })
  await fs.copyFile(builtBinary, stagedBinary)
  await fs.chmod(stagedBinary, 0o755)
  await fs.writeFile(path.join(contentsPath, 'Info.plist'), plistXml())

  const iconPath = path.join(sourceDir, 'App', 'CuaDriver', 'AppIcon.icns')
  if (await pathExists(iconPath)) {
    await fs.copyFile(iconPath, path.join(resourcesPath, 'AppIcon.icns'))
  }

  validateArchitecture(stagedBinary, targetArch)
  signHelper(helperAppPath)
  return helperAppPath
}

function validateArchitecture(binaryPath, targetArch) {
  const expected = archMap[targetArch].lipo
  const archs = read('/usr/bin/lipo', ['-archs', binaryPath]).split(/\s+/).filter(Boolean)
  if (!archs.includes(expected)) {
    throw new Error(`Helper arch mismatch. Expected ${expected}, got ${archs.join(', ')}`)
  }
}

function signHelper(helperAppPath) {
  const entitlementsPath = path.join(rootDir, 'build', 'entitlements.computer-use.plist')
  run('codesign', [
    '--force',
    '--deep',
    '--sign',
    '-',
    '--entitlements',
    entitlementsPath,
    '--options',
    'runtime',
    '--timestamp=none',
    helperAppPath
  ])
  run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', helperAppPath])
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const requestedArch = args.get('arch') ?? process.env.TARGET_ARCH ?? process.arch

  if (process.platform !== 'darwin') {
    console.log('Skipping CUA Driver build: macOS is required.')
    return
  }

  if (!archMap[requestedArch]) {
    throw new Error(`Unsupported CUA Driver arch: ${requestedArch}`)
  }

  ensureTool('git')
  ensureTool('swift')
  ensureTool('/usr/bin/lipo', ['-info', process.execPath])
  ensureTool('codesign', ['--version'])

  const cacheRoot = path.join(
    rootDir,
    'node_modules',
    '.cache',
    'deepchat-cua-driver',
    `${CUA_TAG}-${CUA_COMMIT}`
  )
  const workRoot = path.join(
    os.tmpdir(),
    'deepchat-cua-driver-build',
    `${CUA_TAG}-${requestedArch}-${process.pid}`
  )
  const sourceDir = path.join(workRoot, 'cua-driver')
  const scratchPath = path.join(workRoot, '.build', requestedArch)

  await cloneOrUpdateSource(cacheRoot)
  await fs.rm(workRoot, { recursive: true, force: true })
  await fs.mkdir(workRoot, { recursive: true })
  await fs.cp(path.join(cacheRoot, 'libs', 'cua-driver'), sourceDir, { recursive: true })
  await patchSource(sourceDir)

  run(
    'swift',
    [
      'build',
      '-c',
      'release',
      '--arch',
      archMap[requestedArch].swift,
      '--product',
      HELPER_BINARY_NAME,
      '--scratch-path',
      scratchPath
    ],
    {
      cwd: sourceDir,
      env: {
        ...process.env,
        CUA_DRIVER_TELEMETRY_ENABLED: '0',
        CUA_DRIVER_AUTO_UPDATE_ENABLED: '0'
      }
    }
  )

  const builtBinary = await findBuiltBinary(scratchPath)
  const helperAppPath = await stageApp(sourceDir, builtBinary, requestedArch)
  const relativeHelperPath = path.relative(rootDir, helperAppPath)
  const stat = await fs.stat(path.join(helperAppPath, 'Contents', 'MacOS', HELPER_BINARY_NAME))

  if (!fsSync.existsSync(helperAppPath) || stat.size === 0) {
    throw new Error('Staged helper app is invalid')
  }

  console.log(`CUA Driver ${CUA_TAG} staged at ${relativeHelperPath}`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
