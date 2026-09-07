import { spawn } from 'node:child_process'
import { mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs'
import path from 'node:path'
import { ToolchainDownloadError } from './errors'
import { probeNodeRoot, probeUvRoot } from './probe'

export type ArchiveExtractor = (
  archivePath: string,
  destDir: string,
  signal?: AbortSignal
) => Promise<void>

export async function extractArchive(
  archivePath: string,
  destDir: string,
  signal?: AbortSignal
): Promise<void> {
  mkdirSync(destDir, { recursive: true })
  const job = archivePath.endsWith('.zip')
    ? zipExtractCommand(archivePath, destDir)
    : { command: 'tar', args: ['-xzf', archivePath, '-C', destDir] }
  const result = await runExtract(job, signal)

  if (result.error) {
    throw new ToolchainDownloadError('disk', 'Failed to start archive extraction', {
      cause: result.error
    })
  }
  if (result.status !== 0) {
    throw new ToolchainDownloadError(
      'disk',
      `Archive extraction failed: ${String(result.stderr || result.status)}`
    )
  }
}

export function takeExtractedRoot(extractDir: string, platform: NodeJS.Platform): string {
  if (isExtractedToolchainRoot(extractDir, platform)) return extractDir
  const entries = readdirSync(extractDir).filter((name) => name !== '.DS_Store')
  if (entries.length === 1) {
    const only = path.join(extractDir, entries[0])
    if (isDirectory(only) && isExtractedToolchainRoot(only, platform)) return only
  }
  return extractDir
}

function isExtractedToolchainRoot(rootDir: string, platform: NodeJS.Platform): boolean {
  return (
    probeNodeRoot(rootDir, platform, true).status === 'complete' ||
    probeNodeRoot(rootDir, platform, false).status === 'complete' ||
    probeUvRoot(rootDir, platform).status === 'complete'
  )
}

export function replaceDirectory(sourceDir: string, destDir: string): void {
  const nextDir = `${destDir}.next`
  const prevDir = `${destDir}.prev`
  mkdirSync(path.dirname(destDir), { recursive: true })
  rmSync(nextDir, { recursive: true, force: true })
  if (isDirectory(prevDir) && !archivePreviousTree(prevDir)) {
    throw new ToolchainDownloadError(
      'activation_failed',
      'Could not archive the previous runtime tree'
    )
  }
  if (!tryRename(sourceDir, nextDir)) {
    throw new ToolchainDownloadError('activation_failed', 'Could not stage the extracted runtime')
  }
  try {
    if (isDirectory(destDir) && !tryRename(destDir, prevDir)) {
      rmSync(nextDir, { recursive: true, force: true })
      throw new Error('Could not move the current runtime aside')
    }
    if (!tryRename(nextDir, destDir)) {
      throw new Error('Could not activate the staged runtime')
    }
  } catch (error) {
    if (isDirectory(prevDir) && !isDirectory(destDir)) {
      tryRename(prevDir, destDir)
    }
    rmSync(nextDir, { recursive: true, force: true })
    throw new ToolchainDownloadError(
      'activation_failed',
      'Could not activate the extracted runtime',
      {
        cause: error
      }
    )
  }
}

function zipExtractCommand(
  archivePath: string,
  destDir: string
): { command: string; args: string[] } {
  if (process.platform === 'win32') {
    return {
      command: 'powershell',
      args: [
        '-NoProfile',
        '-Command',
        `Expand-Archive -LiteralPath '${escapePowerShell(archivePath)}' -DestinationPath '${escapePowerShell(destDir)}' -Force`
      ]
    }
  }
  return { command: 'unzip', args: ['-qo', archivePath, '-d', destDir] }
}

function runExtract(
  job: { command: string; args: string[] },
  signal?: AbortSignal
): Promise<{ status: number | null; stderr: string; error?: Error }> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new ToolchainDownloadError('cancelled', 'Toolchain install cancelled'))
      return
    }
    const child = spawn(job.command, job.args, {
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe']
    })
    let stderr = ''
    child.stderr?.on('data', (chunk) => {
      stderr += String(chunk)
    })
    const onAbort = () => {
      child.kill()
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    child.once('error', (error) => {
      signal?.removeEventListener('abort', onAbort)
      if (signal?.aborted) {
        reject(new ToolchainDownloadError('cancelled', 'Toolchain install cancelled'))
        return
      }
      resolve({ status: null, stderr, error })
    })
    child.once('close', (status) => {
      signal?.removeEventListener('abort', onAbort)
      if (signal?.aborted) {
        reject(new ToolchainDownloadError('cancelled', 'Toolchain install cancelled'))
        return
      }
      resolve({ status, stderr })
    })
  })
}

function archivePreviousTree(prevDir: string): boolean {
  const archived = `${prevDir}.${Date.now()}`
  if (tryRename(prevDir, archived)) return true
  try {
    rmSync(prevDir, { recursive: true, force: true })
    return !isDirectory(prevDir)
  } catch {
    return false
  }
}

function tryRename(sourceDir: string, destDir: string): boolean {
  try {
    renameSync(sourceDir, destDir)
    return true
  } catch {
    return false
  }
}

function isDirectory(filePath: string): boolean {
  try {
    return statSync(filePath).isDirectory()
  } catch {
    return false
  }
}

function escapePowerShell(value: string): string {
  return value.replaceAll("'", "''")
}
