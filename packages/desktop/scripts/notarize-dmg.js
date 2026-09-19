import { execFile } from 'node:child_process'
import path from 'node:path'
import { promisify } from 'node:util'

import { notarize } from '@electron/notarize'

import { createNotarizationOptions, validateAppleTeamId } from './apple-notarization.js'

const execFileAsync = promisify(execFile)
const COMMAND_OUTPUT_LIMIT = 4 * 1024 * 1024

function isDmgArtifact(context) {
  return (
    context?.target?.name === 'dmg' &&
    typeof context.file === 'string' &&
    path.extname(context.file).toLowerCase() === '.dmg'
  )
}

async function runDistributionCommand(runCommand, command, args) {
  return await runCommand(command, args, { maxBuffer: COMMAND_OUTPUT_LIMIT })
}

function requireDeveloperIdMetadata(result) {
  const metadata = `${result?.stdout ?? ''}\n${result?.stderr ?? ''}`
  if (!/^Authority=Developer ID Application:/m.test(metadata)) {
    throw new Error('The DMG is not signed with a Developer ID Application certificate')
  }
  const timestamp = metadata.match(/^Timestamp=(.+)$/m)?.[1]?.trim()
  if (!timestamp || timestamp.toLowerCase() === 'none') {
    throw new Error('The DMG Developer ID signature does not contain a secure timestamp')
  }
}

export async function verifyDmgSignature(
  dmgPath,
  { teamId, runCommand = execFileAsync } = {}
) {
  await runDistributionCommand(runCommand, '/usr/bin/codesign', [
    '--verify',
    '--strict',
    '--verbose=2',
    dmgPath
  ])

  const metadata = await runDistributionCommand(runCommand, '/usr/bin/codesign', [
    '--display',
    '--verbose=4',
    dmgPath
  ])
  requireDeveloperIdMetadata(metadata)

  const teamRequirement = teamId
    ? ` and certificate leaf[subject.OU] = "${validateAppleTeamId(teamId, 'DMG Team ID')}"`
    : ''
  await runDistributionCommand(runCommand, '/usr/bin/codesign', [
    '--verify',
    '--strict',
    '--test-requirement',
    `=anchor apple generic${teamRequirement}`,
    dmgPath
  ])
}

export async function verifyDmgDistribution(
  dmgPath,
  { teamId, runCommand = execFileAsync } = {}
) {
  await verifyDmgSignature(dmgPath, { teamId, runCommand })
  await runDistributionCommand(runCommand, '/usr/bin/hdiutil', ['verify', dmgPath])
  await runDistributionCommand(runCommand, '/usr/bin/xcrun', [
    'stapler',
    'validate',
    '-v',
    dmgPath
  ])
  await runDistributionCommand(runCommand, '/usr/sbin/spctl', [
    '--assess',
    '--type',
    'open',
    '--context',
    'context:primary-signature',
    '--verbose=4',
    dmgPath
  ])
}

export async function finalizeMacDmg(
  context,
  {
    env = process.env,
    notarizeImpl = notarize,
    runCommand = execFileAsync,
    logger = console
  } = {}
) {
  if (!isDmgArtifact(context)) {
    return false
  }

  const options = createNotarizationOptions(context.file, env)
  if (options === null) {
    logger.info('Skipping DMG notarization because build_for_release is not set')
    return false
  }

  const teamId = 'teamId' in options ? options.teamId : undefined
  await verifyDmgSignature(context.file, { teamId, runCommand })
  logger.info(`Notarizing final macOS DMG: ${path.basename(context.file)}`)
  await notarizeImpl(options)
  await verifyDmgDistribution(context.file, { teamId, runCommand })
  return true
}

export default finalizeMacDmg
