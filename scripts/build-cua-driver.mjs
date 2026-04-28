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

const VENDOR_ROOT = process.env.DEEPCHAT_CUA_VENDOR_ROOT
  ? path.resolve(process.env.DEEPCHAT_CUA_VENDOR_ROOT)
  : path.join(rootDir, 'vendor', 'cua-driver')
const VENDOR_SOURCE_DIR = path.join(VENDOR_ROOT, 'source')
const UPSTREAM_METADATA_PATH = path.join(VENDOR_ROOT, 'upstream.json')
const HELPER_APP_NAME = 'DeepChat Computer Use'
const HELPER_APP_DIR_NAME = `${HELPER_APP_NAME}.app`
const HELPER_BINARY_NAME = 'cua-driver'

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

async function readUpstreamMetadata() {
  let metadata
  try {
    metadata = JSON.parse(await fs.readFile(UPSTREAM_METADATA_PATH, 'utf8'))
  } catch (error) {
    throw new Error(
      `Unable to read CUA upstream metadata at ${path.relative(rootDir, UPSTREAM_METADATA_PATH)}: ${error instanceof Error ? error.message : error}`
    )
  }

  const requiredFields = ['upstreamRepo', 'upstreamSubdir', 'tag', 'commit', 'version', 'updatedAt']
  for (const field of requiredFields) {
    if (typeof metadata[field] !== 'string' || metadata[field].length === 0) {
      throw new Error(`CUA upstream metadata is missing required string field: ${field}`)
    }
  }
  return metadata
}

async function validateVendorSource(metadata) {
  const packagePath = path.join(VENDOR_SOURCE_DIR, 'Package.swift')
  const sourcesPath = path.join(VENDOR_SOURCE_DIR, 'Sources')
  if (!(await pathExists(packagePath))) {
    throw new Error(`Vendored CUA Driver source is missing Package.swift at ${packagePath}`)
  }
  if (!(await pathExists(sourcesPath))) {
    throw new Error(`Vendored CUA Driver source is missing Sources at ${sourcesPath}`)
  }

  const packageContent = await fs.readFile(packagePath, 'utf8')
  if (!packageContent.includes('name: "cua-driver"')) {
    throw new Error('Vendored CUA Driver Package.swift does not look like the cua-driver package')
  }

  const commandPath = path.join(
    VENDOR_SOURCE_DIR,
    'Sources',
    'CuaDriverCLI',
    'CuaDriverCommand.swift'
  )
  const commandContent = await fs.readFile(commandPath, 'utf8')
  if (!commandContent.includes('DeepChatPermissionProbeCommand')) {
    throw new Error(
      `Vendored CUA Driver source is missing DeepChat permission probe patch for ${metadata.commit}`
    )
  }
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

function plistXml(version) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key>
  <string>com.wefonk.deepchat.computeruse</string>
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
  <string>${version}</string>
  <key>CFBundleVersion</key>
  <string>${version}</string>
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

async function stageApp(sourceDir, builtBinary, targetArch, version) {
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
  await fs.writeFile(path.join(contentsPath, 'Info.plist'), plistXml(version))

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

  ensureTool('swift')
  ensureTool('/usr/bin/lipo', ['-info', process.execPath])
  ensureTool('codesign', ['--version'])

  const metadata = await readUpstreamMetadata()
  await validateVendorSource(metadata)

  const workRoot = path.join(
    os.tmpdir(),
    'deepchat-cua-driver-build',
    `${metadata.tag}-${requestedArch}-${process.pid}`
  )
  const scratchPath = path.join(workRoot, '.build', requestedArch)

  await fs.rm(workRoot, { recursive: true, force: true })
  await fs.mkdir(workRoot, { recursive: true })

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
      '--package-path',
      VENDOR_SOURCE_DIR,
      '--scratch-path',
      scratchPath
    ],
    {
      env: {
        ...process.env,
        CUA_DRIVER_TELEMETRY_ENABLED: '0',
        CUA_DRIVER_AUTO_UPDATE_ENABLED: '0'
      }
    }
  )

  const builtBinary = await findBuiltBinary(scratchPath)
  const helperAppPath = await stageApp(
    VENDOR_SOURCE_DIR,
    builtBinary,
    requestedArch,
    metadata.version
  )
  const relativeHelperPath = path.relative(rootDir, helperAppPath)
  const stat = await fs.stat(path.join(helperAppPath, 'Contents', 'MacOS', HELPER_BINARY_NAME))

  if (!fsSync.existsSync(helperAppPath) || stat.size === 0) {
    throw new Error('Staged helper app is invalid')
  }

  console.log(`CUA Driver ${metadata.tag} staged at ${relativeHelperPath}`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
