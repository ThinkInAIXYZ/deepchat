import { execFile } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { validateArtifactPurpose } from './ci/package-contract.mjs'

const execFileAsync = promisify(execFile)
const DEVELOPMENT_SIGNING_PURPOSE = 'development'

function isAbsoluteOrRelativeFilePath(value) {
  return (
    (value.length > 3 && value[1] === ':') ||
    value.startsWith('/') ||
    value.startsWith('./') ||
    value.startsWith('../')
  )
}

async function run(command, args, options = {}) {
  return await execFileAsync(command, args, {
    windowsHide: true,
    ...options
  })
}

async function listUserKeychains() {
  const { stdout } = await run('/usr/bin/security', ['list-keychains', '-d', 'user'])
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^"|"$/g, ''))
    .filter(Boolean)
}

async function resolveCertificatePath(cscLink, tempRoot, cwd) {
  const trimmedLink = cscLink.trim()
  if (trimmedLink.startsWith('file://')) {
    return trimmedLink.slice('file://'.length)
  }
  if (trimmedLink.startsWith('~/')) {
    return path.join(os.homedir(), trimmedLink.slice(2))
  }
  if (isAbsoluteOrRelativeFilePath(trimmedLink)) {
    return path.resolve(cwd, trimmedLink)
  }
  if (trimmedLink.startsWith('https://')) {
    const response = await fetch(trimmedLink)
    if (!response.ok) {
      throw new Error(`Failed to download macOS signing certificate: ${response.status}`)
    }
    const certificatePath = path.join(tempRoot, 'certificate.p12')
    await fs.writeFile(certificatePath, Buffer.from(await response.arrayBuffer()))
    return certificatePath
  }

  const base64Prefix = trimmedLink.match(/^data:.*;base64,/)
  const encodedCertificate = base64Prefix
    ? trimmedLink.slice(base64Prefix[0].length)
    : trimmedLink
  const certificatePath = path.join(tempRoot, 'certificate.p12')
  await fs.writeFile(certificatePath, Buffer.from(encodedCertificate, 'base64'))
  return certificatePath
}

async function prepareSigningKeychain({ cwd, env }) {
  if (!env.CSC_LINK) {
    return {
      keychainFile: env.CSC_KEYCHAIN || null,
      cleanup: async () => {}
    }
  }

  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'deepchat-cua-codesign-'))
  const keychainFile = path.join(tempRoot, 'deepchat-cua.keychain')
  const keychainPassword = randomBytes(32).toString('base64')
  const certificatePath = await resolveCertificatePath(env.CSC_LINK, tempRoot, cwd)
  const certificatePassword = env.CSC_KEY_PASSWORD ?? ''
  const existingKeychains = await listUserKeychains()

  await run('/usr/bin/security', ['create-keychain', '-p', keychainPassword, keychainFile])
  await run('/usr/bin/security', ['unlock-keychain', '-p', keychainPassword, keychainFile])
  await run('/usr/bin/security', ['set-keychain-settings', keychainFile])
  await run('/usr/bin/security', [
    'list-keychains',
    '-d',
    'user',
    '-s',
    keychainFile,
    ...existingKeychains
  ])
  await run('/usr/bin/security', [
    'import',
    certificatePath,
    '-k',
    keychainFile,
    '-T',
    '/usr/bin/codesign',
    '-P',
    certificatePassword
  ])
  await run('/usr/bin/security', [
    'set-key-partition-list',
    '-S',
    'apple-tool:,apple:',
    '-s',
    '-k',
    keychainPassword,
    keychainFile
  ])

  return {
    keychainFile,
    cleanup: async () => {
      if (existingKeychains.length > 0) {
        await run('/usr/bin/security', [
          'list-keychains',
          '-d',
          'user',
          '-s',
          ...existingKeychains
        ]).catch(() => {})
      }
      await run('/usr/bin/security', ['delete-keychain', keychainFile]).catch(() => {})
      await fs.rm(tempRoot, { recursive: true, force: true })
    }
  }
}

async function findDeveloperIdIdentity({ keychainFile, qualifier }) {
  const args = ['find-identity', '-v', '-p', 'codesigning']
  if (keychainFile) {
    args.push(keychainFile)
  }

  const { stdout } = await run('/usr/bin/security', args)
  const normalizedQualifier = qualifier?.trim()
  const identityLine = stdout
    .split(/\r?\n/)
    .find(
      (line) =>
        line.includes('"Developer ID Application:') &&
        (!normalizedQualifier || line.includes(normalizedQualifier))
    )
  const match = identityLine?.match(/[A-Fa-f0-9]{40}/)
  if (!match) {
    throw new Error('Unable to find a Developer ID Application identity for CUA helper signing')
  }

  return match[0]
}

async function signHelperApp({ appPath, entitlementsPath, identity, keychainFile }) {
  const args = [
    '--force',
    '--sign',
    identity,
    '--entitlements',
    entitlementsPath,
    '--options',
    'runtime',
    '--timestamp'
  ]

  if (keychainFile) {
    args.push('--keychain', keychainFile)
  }

  args.push(appPath)
  await run('/usr/bin/codesign', args)
}

async function assertReleaseSignature(appPath) {
  const { stdout, stderr } = await run('/usr/bin/codesign', ['-dv', '--verbose=4', appPath])
  const details = `${stdout}\n${stderr}`
  if (!details.includes('Authority=Developer ID Application:')) {
    throw new Error('CUA helper must be signed with a Developer ID Application certificate')
  }
  if (!details.includes('Timestamp=')) {
    throw new Error('CUA helper signature must include a secure timestamp')
  }
}

function isCiEnvironment(env) {
  const value = String(env.CI ?? '')
    .trim()
    .toLowerCase()
  return value !== '' && value !== '0' && value !== 'false'
}

export function resolveCuaSigningPurpose(purpose, env = process.env) {
  if (purpose !== undefined && purpose !== null && typeof purpose !== 'string') {
    throw new TypeError('CUA signing purpose must be a string')
  }
  const normalizedPurpose = purpose?.trim() ?? ''
  if (normalizedPurpose === '') {
    if (isCiEnvironment(env)) {
      throw new Error(
        'CUA macOS packaging in CI requires an explicit distribution or verification purpose'
      )
    }
    return DEVELOPMENT_SIGNING_PURPOSE
  }
  return validateArtifactPurpose(normalizedPurpose)
}

export function validateCuaSigningContext({ purpose, env = process.env }) {
  const resolvedPurpose = resolveCuaSigningPurpose(purpose, env)
  const environmentPurpose = String(env.PACKAGE_PURPOSE ?? '').trim()
  if (environmentPurpose !== '') {
    const validatedEnvironmentPurpose = validateArtifactPurpose(environmentPurpose)
    if (validatedEnvironmentPurpose !== resolvedPurpose) {
      throw new Error(
        `CUA signing purpose mismatch: argument=${resolvedPurpose}, PACKAGE_PURPOSE=${validatedEnvironmentPurpose}`
      )
    }
  }
  const releaseMode = String(env.build_for_release ?? '').trim()
  if (resolvedPurpose === 'distribution') {
    if (releaseMode !== '2') {
      throw new Error('CUA distribution signing requires build_for_release=2')
    }
  } else if (releaseMode !== '') {
    throw new Error(
      `CUA ${resolvedPurpose} signing must not set build_for_release (received ${releaseMode})`
    )
  }
  return resolvedPurpose
}

async function signHelperAdHoc({ appPath, entitlementsPath }) {
  await run('/usr/bin/codesign', [
    '--force',
    '--sign',
    '-',
    '--entitlements',
    entitlementsPath,
    '--options',
    'runtime',
    '--timestamp=none',
    appPath
  ])
}

async function verifyHelperSignature(appPath) {
  await run('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath])
}

export async function signMacHelper({
  appPath,
  entitlementsPath,
  purpose,
  cwd = process.cwd(),
  env = process.env
}) {
  const resolvedPurpose = validateCuaSigningContext({ purpose, env })
  if (resolvedPurpose !== 'distribution') {
    await signHelperAdHoc({ appPath, entitlementsPath })
    await verifyHelperSignature(appPath)
    console.info(`Signed CUA helper for ${resolvedPurpose}: ${appPath}`)
    return {
      purpose: resolvedPurpose,
      signature: 'ad-hoc'
    }
  }

  const signingKeychain = await prepareSigningKeychain({ cwd, env })
  try {
    const identity = await findDeveloperIdIdentity({
      keychainFile: signingKeychain.keychainFile,
      qualifier: env.DEEPCHAT_MAC_CODESIGN_IDENTITY ?? env.CSC_NAME
    })
    await signHelperApp({
      appPath,
      entitlementsPath,
      identity,
      keychainFile: signingKeychain.keychainFile
    })
    await verifyHelperSignature(appPath)
    await assertReleaseSignature(appPath)
    console.info(`Signed CUA helper for distribution: ${appPath}`)
    return {
      purpose: resolvedPurpose,
      signature: 'developer-id'
    }
  } finally {
    await signingKeychain.cleanup()
  }
}
