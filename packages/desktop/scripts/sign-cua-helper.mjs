import { execFile } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { validateArtifactPurpose } from './ci/package-contract.mjs'
import { isReleaseNotarizationEnabled } from './macos-release-contract.mjs'

const execFileAsync = promisify(execFile)
const DEVELOPMENT_SIGNING_PURPOSE = 'development'
const SECURITY_DIAGNOSTIC_LIMIT = 1000
const SENSITIVE_SECURITY_ARGUMENTS = new Set(['-k', '-p', '-P'])

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

function redactSensitiveSecurityDiagnostic(value, args) {
  let redacted = String(value ?? '')
  for (let index = 0; index < args.length - 1; index += 1) {
    if (!SENSITIVE_SECURITY_ARGUMENTS.has(args[index])) {
      continue
    }
    const sensitiveValue = args[index + 1]
    if (sensitiveValue) {
      redacted = redacted.split(sensitiveValue).join('<redacted>')
    }
  }
  for (const argument of args) {
    if (isAbsoluteOrRelativeFilePath(argument)) {
      redacted = redacted.split(argument).join('<redacted>')
    }
  }
  return redacted
    .replace(
      /(^|\s)(-[kPp])(?:\s+|=)(?:"[^"]*"|'[^']*'|\S+)/g,
      '$1$2 <redacted>'
    )
    .trim()
}

function boundSecurityDiagnostic(value) {
  return value.length > SECURITY_DIAGNOSTIC_LIMIT
    ? `${value.slice(0, SECURITY_DIAGNOSTIC_LIMIT)}…`
    : value
}

function formatSensitiveSecurityError(error, args) {
  if (!error || typeof error !== 'object') {
    return ''
  }

  const details = []
  for (const field of ['status', 'code', 'signal']) {
    const value = error[field]
    if (typeof value === 'string' || typeof value === 'number') {
      details.push(`${field}=${value}`)
    }
  }
  const message = redactSensitiveSecurityDiagnostic(error.message, args)
  if (message) {
    details.push(`message=${boundSecurityDiagnostic(message)}`)
  }
  const stderr = redactSensitiveSecurityDiagnostic(error.stderr, args)
  if (stderr) {
    details.push(`stderr=${boundSecurityDiagnostic(stderr)}`)
  }
  return details.length > 0 ? ` (${details.join('; ')})` : ''
}

async function runSensitiveSecurityCommand(args, failureMessage) {
  try {
    return await run('/usr/bin/security', args)
  } catch (error) {
    throw new Error(`${failureMessage}${formatSensitiveSecurityError(error, args)}`)
  }
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
  const certificatePassword = env.CSC_KEY_PASSWORD ?? ''
  let existingKeychains = []
  let keychainCreated = false
  let searchListChanged = false
  let cleaned = false
  const cleanup = async () => {
    if (cleaned) {
      return
    }
    cleaned = true
    const cleanupErrors = []
    if (searchListChanged) {
      await run('/usr/bin/security', [
        'list-keychains',
        '-d',
        'user',
        '-s',
        ...existingKeychains
      ]).catch((error) => {
        cleanupErrors.push(error)
      })
    }
    if (keychainCreated) {
      await run('/usr/bin/security', ['delete-keychain', keychainFile]).catch((error) => {
        cleanupErrors.push(error)
      })
    }
    await fs.rm(tempRoot, { recursive: true, force: true }).catch((error) => {
      cleanupErrors.push(error)
    })
    if (cleanupErrors.length > 0) {
      throw new AggregateError(cleanupErrors, 'Unable to fully clean the CUA signing keychain')
    }
  }

  try {
    const certificatePath = await resolveCertificatePath(env.CSC_LINK, tempRoot, cwd)
    existingKeychains = await listUserKeychains()
    await runSensitiveSecurityCommand(
      ['create-keychain', '-p', keychainPassword, keychainFile],
      'Unable to create the temporary CUA signing keychain'
    )
    keychainCreated = true
    await runSensitiveSecurityCommand(
      ['unlock-keychain', '-p', keychainPassword, keychainFile],
      'Unable to unlock the temporary CUA signing keychain'
    )
    await run('/usr/bin/security', ['set-keychain-settings', keychainFile])
    await runSensitiveSecurityCommand(
      [
        'import',
        certificatePath,
        '-k',
        keychainFile,
        '-T',
        '/usr/bin/codesign',
        '-P',
        certificatePassword
      ],
      'Unable to import the CUA signing certificate'
    )
    await runSensitiveSecurityCommand(
      [
        'set-key-partition-list',
        '-S',
        'apple-tool:,apple:',
        '-s',
        '-k',
        keychainPassword,
        keychainFile
      ],
      'Unable to configure access to the temporary CUA signing keychain'
    )
    searchListChanged = true
    await run('/usr/bin/security', [
      'list-keychains',
      '-d',
      'user',
      '-s',
      keychainFile,
      ...existingKeychains
    ])

    return {
      keychainFile,
      cleanup
    }
  } catch (error) {
    try {
      await cleanup()
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        'CUA signing keychain setup failed and cleanup was incomplete'
      )
    }
    throw error
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
  const releaseNotarizationEnabled = isReleaseNotarizationEnabled(env)
  if (resolvedPurpose === 'distribution') {
    if (!releaseNotarizationEnabled) {
      throw new Error(
        'CUA distribution signing requires build_for_release to enable release notarization'
      )
    }
  } else if (releaseNotarizationEnabled) {
    throw new Error(
      `CUA ${resolvedPurpose} signing must not enable release notarization`
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
  let signingError
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
  } catch (error) {
    signingError = error
  }
  try {
    await signingKeychain.cleanup()
  } catch (cleanupError) {
    if (signingError) {
      throw new AggregateError(
        [signingError, cleanupError],
        'CUA helper signing failed and keychain cleanup was incomplete'
      )
    }
    throw cleanupError
  }
  if (signingError) {
    throw signingError
  }
  console.info(`Signed CUA helper for distribution: ${appPath}`)
  return {
    purpose: resolvedPurpose,
    signature: 'developer-id'
  }
}
