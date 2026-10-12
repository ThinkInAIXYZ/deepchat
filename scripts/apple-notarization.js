import { notarize } from '@electron/notarize'
import { isReleaseNotarizationEnabled } from './macos-release-contract.mjs'

const APPLE_TEAM_ID_PATTERN = /^[A-Z0-9]{10}$/

export { isReleaseNotarizationEnabled }

export async function validateStapledTicket(artifactPath, runCommand) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      await runCommand('/usr/bin/xcrun', ['stapler', 'validate', '-v', artifactPath], {
        encoding: 'utf8',
        maxBuffer: 4 * 1024 * 1024
      })
      return
    } catch (error) {
      const output = [error.message, error.stdout, error.stderr].filter(Boolean).join('\n')
      // EX_NOHOST also covers unexpected ticket-service responses; validation still must pass.
      if (error.code !== 68 || attempt === 3) {
        throw new Error(
          `Notarization ticket validation failed (exit ${error.code ?? 'unknown'}): ${artifactPath}\n${output}`,
          { cause: error }
        )
      }
      console.warn(`Retrying notarization ticket validation after EX_NOHOST (${attempt + 1}/3)`)
      await new Promise((resolve) => setTimeout(resolve, 5000 * 2 ** attempt))
    }
  }
}

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
