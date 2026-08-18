import { spawnSync, type SpawnSyncOptions } from 'node:child_process'
import { mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs'
import path from 'node:path'
import { ToolchainDownloadError } from './errors'
import { probeNodeRoot, probeUvRoot } from './probe'

export type ArchiveExtractor = (archivePath: string, destDir: string) => Promise<void>

export async function extractArchive(archivePath: string, destDir: string): Promise<void> {
  mkdirSync(destDir, { recursive: true })
  const options: SpawnSyncOptions = { encoding: 'utf8', windowsHide: true }
  const result = archivePath.endsWith('.zip')
    ? extractZip(archivePath, destDir, options)
    : spawnSync('tar', ['-xzf', archivePath, '-C', destDir], options)

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
  rmSync(prevDir, { recursive: true, force: true })
  if (!tryRename(sourceDir, nextDir)) {
    throw new ToolchainDownloadError('activation_failed', 'Could not stage the extracted runtime')
  }
  try {
    if (isDirectory(destDir) && !tryRename(destDir, prevDir) && isDirectory(destDir)) {
      throw new Error('Could not move the current runtime aside')
    }
    if (!tryRename(nextDir, destDir)) {
      throw new Error('Could not activate the staged runtime')
    }
  } catch (error) {
    if (isDirectory(prevDir) && !isDirectory(destDir)) {
      tryRename(prevDir, destDir)
    }
    throw new ToolchainDownloadError(
      'activation_failed',
      'Could not activate the extracted runtime',
      {
        cause: error
      }
    )
  }
  rmSync(prevDir, { recursive: true, force: true })
}

function extractZip(
  archivePath: string,
  destDir: string,
  options: SpawnSyncOptions
): ReturnType<typeof spawnSync> {
  if (process.platform === 'win32') {
    return spawnSync(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        `Expand-Archive -LiteralPath '${escapePowerShell(archivePath)}' -DestinationPath '${escapePowerShell(destDir)}' -Force`
      ],
      options
    )
  }
  return spawnSync('unzip', ['-q', archivePath, '-d', destDir], options)
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
