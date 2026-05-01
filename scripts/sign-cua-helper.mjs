import { execFile } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

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
    '--deep',
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
  await run('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath])
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

export async function signMacHelperForRelease({
  appPath,
  entitlementsPath,
  cwd = process.cwd(),
  env = process.env
}) {
  if (!env.build_for_release) {
    return false
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
    await assertReleaseSignature(appPath)
    console.info(`Signed CUA helper for release: ${appPath}`)
    return true
  } finally {
    await signingKeychain.cleanup()
  }
}
