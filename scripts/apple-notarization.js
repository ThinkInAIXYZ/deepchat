import { notarize } from '@electron/notarize'
import { isReleaseNotarizationEnabled } from './macos-release-contract.mjs'

const APPLE_TEAM_ID_PATTERN = /^[A-Z0-9]{10}$/

export { isReleaseNotarizationEnabled }

function requireEnvironmentValue(env, name) {
  const value = env[name]
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Missing required macOS notarization environment variable: ${name}`)
  }
  return value
}

export function validateAppleTeamId(
  teamId,
  label = 'DEEPCHAT_APPLE_NOTARY_TEAM_ID'
) {
  if (typeof teamId !== 'string' || !APPLE_TEAM_ID_PATTERN.test(teamId)) {
    throw new Error(`${label} must be a 10-character Apple team ID`)
  }
  return teamId
}

export function createNotarizationOptions(artifactPath, env = process.env) {
  if (!isReleaseNotarizationEnabled(env)) {
    return null
  }

  if (env.build_for_release === '2') {
    const appleId = requireEnvironmentValue(env, 'DEEPCHAT_APPLE_NOTARY_USERNAME')
    const teamId = validateAppleTeamId(
      requireEnvironmentValue(env, 'DEEPCHAT_APPLE_NOTARY_TEAM_ID')
    )
    const appleIdPassword = requireEnvironmentValue(env, 'DEEPCHAT_APPLE_NOTARY_PASSWORD')

    return {
      appPath: artifactPath,
      appleId,
      appleIdPassword,
      teamId
    }
  }

  return {
    appPath: artifactPath,
    keychainProfile: 'DeepChat'
  }
}

export async function notarizeReleaseArtifact(
  artifactPath,
  { env = process.env, notarizeImpl = notarize } = {}
) {
  const options = createNotarizationOptions(artifactPath, env)
  if (options === null) {
    return false
  }

  await notarizeImpl(options)
  return true
}
