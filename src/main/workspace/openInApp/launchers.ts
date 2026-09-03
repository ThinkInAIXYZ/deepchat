import path from 'path'
import { execFile, spawn } from 'child_process'
import { promisify } from 'util'
import {
  buildLaunchArgs,
  toFileOpenAppPlatform,
  type WorkspaceFileOpenAppPlatform
} from '@shared/workspace/fileOpenApps'
import type { DetectedApp } from './detectors'

const execFileAsync = promisify(execFile)

const LAUNCH_TIMEOUT_MS = 10_000

/**
 * Launch a detected app against a path.
 *
 * Editors receive the file; terminals receive its containing directory, because
 * handing a file to a terminal makes some of them try to execute it.
 *
 * Rejects when the app has no launch strategy for this platform or the process
 * fails to start, so the caller can tell the user instead of silently doing
 * something else.
 */
export async function launchApp(
  target: DetectedApp,
  filePath: string,
  platform: WorkspaceFileOpenAppPlatform = toFileOpenAppPlatform(process.platform)
): Promise<void> {
  // Detection knows whether it resolved a binary or a desktop entry, so its
  // override wins over the registry's declared strategy.
  const strategy = target.launchOverride ?? target.definition.launch[platform]
  if (!strategy) {
    throw new Error(`${target.definition.name} is not available on this platform`)
  }

  const targetPath = target.definition.kind === 'terminal' ? path.dirname(filePath) : filePath

  if (strategy.type === 'macOpenA') {
    // `open` hands off to Launch Services and exits immediately.
    await execFileAsync('open', ['-a', target.launchTarget, targetPath], {
      timeout: LAUNCH_TIMEOUT_MS
    })
    return
  }

  // An exec'd app stays attached, so detach instead of waiting: a timeout would
  // otherwise kill the application the user just opened.
  const [command, args]: [string, string[]] =
    strategy.type === 'desktopEntry'
      ? ['gio', ['launch', target.launchTarget, targetPath]]
      : [target.launchTarget, buildLaunchArgs(strategy.args, targetPath)]

  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { detached: true, stdio: 'ignore' })
    child.once('error', reject)
    child.once('spawn', () => {
      child.unref()
      resolve()
    })
  })
}
