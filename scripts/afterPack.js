import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import { execFileSync } from 'child_process'
import { createRequire } from 'module'
import { fileURLToPath } from 'url'

const require = createRequire(import.meta.url)
const fsSync = require('node:fs')

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

function execSecret(command, args, label) {
  try {
    execFileSync(command, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    })
  } catch (error) {
    const stderr =
      error && typeof error === 'object' && 'stderr' in error && error.stderr
        ? String(error.stderr).trim()
        : ''
    throw new Error(`${label} failed${stderr ? `: ${stderr}` : ''}`)
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

function parseDeveloperIdIdentity(identities) {
  const developerIdLine = identities
    .split('\n')
    .find((line) => line.includes('Developer ID Application'))
  const hash = developerIdLine?.match(/\)\s+([A-Fa-f0-9]{40})\s+"/)?.[1]
  const name = developerIdLine?.match(/"([^"]+)"/)?.[1]
  return hash || name || null
}

function findDeveloperIdIdentity(keychainPath) {
  const args = ['find-identity', '-v', '-p', 'codesigning']
  if (keychainPath) {
    args.push(keychainPath)
  }

  try {
    return parseDeveloperIdIdentity(read('security', args))
  } catch {
    return null
  }
}

function expandHome(candidate) {
  if (candidate === '~') {
    return os.homedir()
  }
  if (candidate.startsWith(`~${path.sep}`)) {
    return path.join(os.homedir(), candidate.slice(2))
  }
  return candidate
}

function materializeCscCertificate(cscLink, tempDir) {
  const expanded = expandHome(cscLink)
  if (fsSync.existsSync(expanded)) {
    return expanded
  }

  if (cscLink.startsWith('file://')) {
    return fileURLToPath(cscLink)
  }

  const certificatePath = path.join(tempDir, 'certificate.p12')
  if (/^https?:\/\//i.test(cscLink)) {
    execSecret(
      '/usr/bin/curl',
      ['--fail', '--location', '--silent', '--show-error', '--output', certificatePath, cscLink],
      'Downloading CSC_LINK certificate'
    )
    return certificatePath
  }

  const base64 = cscLink.replace(/^data:.*?;base64,/i, '').replace(/\s/g, '')
  fsSync.writeFileSync(certificatePath, Buffer.from(base64, 'base64'), { mode: 0o600 })
  return certificatePath
}

let importedSigningIdentity = null

function importCscSigningIdentity() {
  if (importedSigningIdentity) {
    return importedSigningIdentity
  }
  if (!process.env.CSC_LINK) {
    return null
  }

  const tempDir = fsSync.mkdtempSync(path.join(os.tmpdir(), 'deepchat-codesign-'))
  const keychainPath = path.join(tempDir, 'codesign.keychain-db')
  const keychainPassword =
    process.env.CSC_KEYCHAIN_PASSWORD || `deepchat-${process.pid}-${Date.now()}`
  const certificatePath = materializeCscCertificate(process.env.CSC_LINK, tempDir)
  const certificatePassword = process.env.CSC_KEY_PASSWORD || ''

  execSecret('security', ['create-keychain', '-p', keychainPassword, keychainPath], 'Creating signing keychain')
  execSecret('security', ['unlock-keychain', '-p', keychainPassword, keychainPath], 'Unlocking signing keychain')
  execSecret(
    'security',
    ['set-keychain-settings', '-lut', '21600', keychainPath],
    'Configuring signing keychain'
  )

  const currentKeychains = read('security', ['list-keychains', '-d', 'user'])
    .split('\n')
    .map((line) => line.trim().replace(/^"|"$/g, ''))
    .filter(Boolean)
    .filter((candidate) => candidate !== keychainPath)
  execSecret(
    'security',
    ['list-keychains', '-d', 'user', '-s', keychainPath, ...currentKeychains],
    'Adding signing keychain to search list'
  )

  execSecret(
    'security',
    [
      'import',
      certificatePath,
      '-k',
      keychainPath,
      '-P',
      certificatePassword,
      '-T',
      '/usr/bin/codesign',
      '-T',
      '/usr/bin/productsign'
    ],
    'Importing CSC_LINK certificate'
  )
  execSecret(
    'security',
    [
      'set-key-partition-list',
      '-S',
      'apple-tool:,apple:,codesign:',
      '-s',
      '-k',
      keychainPassword,
      keychainPath
    ],
    'Configuring signing key access'
  )

  const identity = findDeveloperIdIdentity(keychainPath)
  if (!identity) {
    throw new Error('CSC_LINK did not contain a Developer ID Application identity')
  }

  importedSigningIdentity = { identity, keychainPath }
  return importedSigningIdentity
}

function resolveSigningIdentity(releaseFlag) {
  if (process.env.CSC_NAME) {
    const imported = releaseFlag ? importCscSigningIdentity() : null
    return {
      identity: process.env.CSC_NAME,
      keychainPath: imported?.keychainPath
    }
  }

  const existingIdentity = findDeveloperIdIdentity()
  if (existingIdentity) {
    return { identity: existingIdentity }
  }

  if (releaseFlag) {
    const imported = importCscSigningIdentity()
    if (imported) {
      return imported
    }
    throw new Error('Developer ID Application identity is required for release helper signing')
  }

  return { identity: '-' }
}

function validateHelperArchitecture(binaryPath, arch) {
  const expected = expectedLipoArch(arch)
  const actual = read('/usr/bin/lipo', ['-archs', binaryPath]).split(/\s+/).filter(Boolean)
  if (!actual.includes(expected)) {
    throw new Error(`Computer Use helper arch mismatch. Expected ${expected}, got ${actual}`)
  }
}

function signHelper(helperAppPath, releaseFlag) {
  const signing = resolveSigningIdentity(releaseFlag)
  const args = [
    '--force',
    '--deep',
    '--sign',
    signing.identity,
    '--entitlements',
    HELPER_ENTITLEMENTS,
    '--options',
    'runtime'
  ]

  if (signing.keychainPath) {
    args.push('--keychain', signing.keychainPath)
  }

  if (signing.identity === '-') {
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
