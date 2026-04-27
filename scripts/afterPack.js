import fs from 'fs/promises'
import path from 'path'
import { execFileSync } from 'child_process'

const APP_NAME = 'DeepChat'
const LINUX_APP_NAME = 'deepchat'
const HELPER_APP_NAME = 'DeepChat Computer Use.app'
const HELPER_BINARY_NAME = 'cua-driver'
const HELPER_ENTITLEMENTS = path.resolve('build', 'entitlements.computer-use.plist')

const ELECTRON_BUILDER_ARCH = {
  1: 'x64',
  3: 'arm64'
}

function isLinux(targets) {
  const re = /AppImage|snap|deb|rpm|freebsd|pacman/i
  return !!targets.find((target) => re.test(target.name))
}

function resolveArch(context) {
  if (typeof context.arch === 'string') {
    return context.arch
  }
  if (typeof context.arch === 'number') {
    return ELECTRON_BUILDER_ARCH[context.arch]
  }
  if (process.env.TARGET_ARCH === 'arm64' || process.env.TARGET_ARCH === 'x64') {
    return process.env.TARGET_ARCH
  }
  if (context.appOutDir.includes('arm64')) {
    return 'arm64'
  }
  return 'x64'
}

function expectedLipoArch(arch) {
  if (arch === 'arm64') {
    return 'arm64'
  }
  if (arch === 'x64') {
    return 'x86_64'
  }
  throw new Error(`Unsupported macOS arch for Computer Use helper: ${arch}`)
}

function exec(command, args, options = {}) {
  console.log(`$ ${command} ${args.join(' ')}`)
  execFileSync(command, args, {
    stdio: 'inherit',
    ...options
  })
}

function read(command, args, options = {}) {
  return execFileSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options
  }).trim()
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath)
    return true
  } catch {
    return false
  }
}

async function removeComputerUseRuntime(appOutDir) {
  const runtimePath = path.join(
    appOutDir,
    'resources',
    'app.asar.unpacked',
    'runtime',
    'computer-use'
  )
  await fs.rm(runtimePath, { recursive: true, force: true })
}

function resolveSigningIdentity(releaseFlag) {
  if (process.env.CSC_NAME) {
    return process.env.CSC_NAME
  }

  const identities = read('security', ['find-identity', '-v', '-p', 'codesigning'])
  const developerIdLine = identities
    .split('\n')
    .find((line) => line.includes('Developer ID Application'))
  const identity = developerIdLine?.match(/"([^"]+)"/)?.[1]
  if (identity) {
    return identity
  }

  if (releaseFlag) {
    throw new Error('Developer ID Application identity is required for release helper signing')
  }

  return '-'
}

function validateHelperArchitecture(binaryPath, arch) {
  const expected = expectedLipoArch(arch)
  const actual = read('/usr/bin/lipo', ['-archs', binaryPath]).split(/\s+/).filter(Boolean)
  if (!actual.includes(expected)) {
    throw new Error(`Computer Use helper arch mismatch. Expected ${expected}, got ${actual}`)
  }
}

function signHelper(helperAppPath, releaseFlag) {
  const identity = resolveSigningIdentity(releaseFlag)
  const args = [
    '--force',
    '--deep',
    '--sign',
    identity,
    '--entitlements',
    HELPER_ENTITLEMENTS,
    '--options',
    'runtime'
  ]

  if (identity === '-') {
    args.push('--timestamp=none')
  } else {
    args.push('--timestamp')
  }

  args.push(helperAppPath)
  exec('codesign', args)
  exec('codesign', ['--verify', '--deep', '--strict', '--verbose=2', helperAppPath])
}

async function afterPackMac(context) {
  const { appOutDir } = context
  const releaseFlag = process.env.build_for_release
  const arch = resolveArch(context)
  const helperAppPath = path.join(
    appOutDir,
    `${APP_NAME}.app`,
    'Contents',
    'Resources',
    'app.asar.unpacked',
    'runtime',
    'computer-use',
    'cua-driver',
    'current',
    HELPER_APP_NAME
  )
  const helperBinaryPath = path.join(helperAppPath, 'Contents', 'MacOS', HELPER_BINARY_NAME)

  if (!(await pathExists(helperBinaryPath))) {
    if (releaseFlag) {
      throw new Error(`Computer Use helper is missing: ${helperBinaryPath}`)
    }
    console.warn(`Computer Use helper is missing: ${helperBinaryPath}`)
    return
  }

  validateHelperArchitecture(helperBinaryPath, arch)
  signHelper(helperAppPath, releaseFlag)
}

async function afterPackLinux({ appOutDir }) {
  const scriptPath = path.join(appOutDir, LINUX_APP_NAME)
  const script = `#!/bin/bash\n"\${BASH_SOURCE%/*}"/${LINUX_APP_NAME}.bin --no-sandbox "$@"`
  await fs.rename(scriptPath, `${scriptPath}.bin`)
  await fs.writeFile(scriptPath, script)
  await fs.chmod(scriptPath, 0o755)
}

async function afterPack(context) {
  const { targets, appOutDir, electronPlatformName } = context
  if (electronPlatformName === 'darwin') {
    await afterPackMac(context)
    return
  }

  await removeComputerUseRuntime(appOutDir)

  if (isLinux(targets)) {
    await afterPackLinux({ appOutDir })
  }
}

export default afterPack
