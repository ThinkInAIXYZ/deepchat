import { readdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import type { ToolchainKind } from '@shared/types/toolchains'

export const TOOLCHAINS_DIRNAME = 'toolchains'
export const STATE_FILENAME = 'state.json'
export const PATH_SCAN_LIMIT = 256

export function unpackAppPath(appPath: string): string {
  return appPath.replace(/app\.asar(?!\.unpacked)/, 'app.asar.unpacked')
}

export function bundledKindRoot(appPath: string, kind: ToolchainKind): string {
  return path.join(unpackAppPath(appPath), 'runtime', kind)
}

export function managedRootDir(userDataDir: string): string {
  return path.join(userDataDir, TOOLCHAINS_DIRNAME)
}

export function assertSafeToolchainVersion(version: string): string {
  if (
    !version ||
    version.includes('\0') ||
    version.includes('..') ||
    /[\\/]/.test(version) ||
    !/^[vA-Za-z0-9][A-Za-z0-9._-]*$/.test(version)
  ) {
    throw new Error(`Invalid toolchain version: ${version}`)
  }
  return version
}

export function managedKindRoot(userDataDir: string, kind: ToolchainKind, version: string): string {
  return path.join(managedRootDir(userDataDir), kind, assertSafeToolchainVersion(version))
}

export function stateFilePath(userDataDir: string): string {
  return path.join(managedRootDir(userDataDir), STATE_FILENAME)
}

export function downloadStagingDir(
  userDataDir: string,
  kind: ToolchainKind,
  version: string
): string {
  return path.join(
    managedRootDir(userDataDir),
    'download',
    `${kind}-${assertSafeToolchainVersion(version)}`
  )
}

export function nodeLayout(
  rootDir: string,
  platform: NodeJS.Platform
): {
  binDir: string
  node: string
  npm: string
  npx: string
  corepack: string
} {
  if (platform === 'win32') {
    return {
      binDir: rootDir,
      node: path.join(rootDir, 'node.exe'),
      npm: path.join(rootDir, 'npm.cmd'),
      npx: path.join(rootDir, 'npx.cmd'),
      corepack: path.join(rootDir, 'corepack.cmd')
    }
  }

  const binDir = path.join(rootDir, 'bin')
  return {
    binDir,
    node: path.join(binDir, 'node'),
    npm: path.join(binDir, 'npm'),
    npx: path.join(binDir, 'npx'),
    corepack: path.join(binDir, 'corepack')
  }
}

export function uvLayout(
  rootDir: string,
  platform: NodeJS.Platform
): { binDir: string; uv: string; uvx: string } {
  const extension = platform === 'win32' ? '.exe' : ''
  return {
    binDir: rootDir,
    uv: path.join(rootDir, `uv${extension}`),
    uvx: path.join(rootDir, `uvx${extension}`)
  }
}

export function inferNodeRootFromExecutable(executable: string, platform: NodeJS.Platform): string {
  const directory = path.dirname(executable)
  if (platform !== 'win32' && path.basename(directory) === 'bin') {
    return path.dirname(directory)
  }
  return directory
}

export function inferUvRootFromExecutable(executable: string): string {
  return path.dirname(executable)
}

export function downloadRootDir(userDataDir: string): string {
  return path.join(managedRootDir(userDataDir), 'download')
}

const ACTIVATE_SIDECAR_NAME = /\.(?:prev|next)(?:\.\d+)?$/

function isActivateSidecarName(name: string): boolean {
  return ACTIVATE_SIDECAR_NAME.test(name)
}

export function gcUnreachableToolchainTrees(
  userDataDir: string,
  keepDirectories: Iterable<string>,
  options?: { collectDownload?: boolean; skipKinds?: Iterable<ToolchainKind> }
): void {
  const keep = new Set([...keepDirectories].map((directory) => path.resolve(directory)))
  const skipKinds = new Set(options?.skipKinds ?? [])
  for (const kind of ['node', 'uv'] as const) {
    if (skipKinds.has(kind)) continue
    const kindRoot = path.join(managedRootDir(userDataDir), kind)
    let entries: string[]
    try {
      entries = readdirSync(kindRoot)
    } catch {
      continue
    }
    for (const name of entries) {
      if (isActivateSidecarName(name)) continue
      const fullPath = path.resolve(kindRoot, name)
      if (keep.has(fullPath)) continue
      try {
        rmSync(fullPath, { recursive: true, force: true })
      } catch {
        // Leave the tree for the next startup.
      }
    }
  }
  if (options?.collectDownload === false) return
  try {
    rmSync(downloadRootDir(userDataDir), { recursive: true, force: true })
  } catch {
    // Leave leftover staging for the next startup.
  }
}
