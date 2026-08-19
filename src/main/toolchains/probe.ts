import { statSync } from 'node:fs'
import path from 'node:path'
import type { ResolvedNodeToolchain, ResolvedUvToolchain } from '@shared/types/toolchains'
import {
  inferNodeRootFromExecutable,
  inferUvRootFromExecutable,
  nodeLayout,
  PATH_SCAN_LIMIT,
  uvLayout
} from './layout'

export type NodeProbeResult =
  | { status: 'complete'; toolchain: Omit<ResolvedNodeToolchain, 'source'> }
  | { status: 'incomplete'; rootDir: string }
  | { status: 'missing' }

export type UvProbeResult =
  | { status: 'complete'; toolchain: Omit<ResolvedUvToolchain, 'source'> }
  | { status: 'incomplete'; rootDir: string }
  | { status: 'missing' }

export function probeNodeRoot(
  rootDir: string,
  platform: NodeJS.Platform,
  requireCorepack: boolean
): NodeProbeResult {
  if (!isExistingDirectory(rootDir)) return { status: 'missing' }
  const layout = nodeLayout(rootDir, platform)
  if (!isExistingFile(layout.node) || !isExistingFile(layout.npm) || !isExistingFile(layout.npx)) {
    return { status: 'incomplete', rootDir }
  }
  if (requireCorepack && !isExistingFile(layout.corepack)) {
    return { status: 'incomplete', rootDir }
  }
  return {
    status: 'complete',
    toolchain: {
      kind: 'node',
      version: null,
      nodeModuleVersion: null,
      rootDir,
      binDir: layout.binDir,
      node: layout.node,
      npm: layout.npm,
      npx: layout.npx,
      corepack: isExistingFile(layout.corepack) ? layout.corepack : null
    }
  }
}

export function probeUvRoot(rootDir: string, platform: NodeJS.Platform): UvProbeResult {
  if (!isExistingDirectory(rootDir)) return { status: 'missing' }
  const layout = uvLayout(rootDir, platform)
  if (!isExistingFile(layout.uv) || !isExistingFile(layout.uvx)) {
    return { status: 'incomplete', rootDir }
  }
  return {
    status: 'complete',
    toolchain: {
      kind: 'uv',
      version: null,
      rootDir,
      binDir: layout.binDir,
      uv: layout.uv,
      uvx: layout.uvx
    }
  }
}

export function probeSystemNode(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform
): NodeProbeResult {
  const executable = findOnPath(platform === 'win32' ? 'node.exe' : 'node', env, platform)
  if (!executable) return { status: 'missing' }
  const rootDir = inferNodeRootFromExecutable(executable, platform)
  const probed = probeNodeRoot(rootDir, platform, false)
  if (probed.status === 'complete') return probed
  return locateSystemNodeSiblings(executable, env, platform)
}

export function probeSystemUv(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): UvProbeResult {
  const uvName = platform === 'win32' ? 'uv.exe' : 'uv'
  const uvxName = platform === 'win32' ? 'uvx.exe' : 'uvx'
  const uv = findOnPath(uvName, env, platform)
  const uvx = findOnPath(uvxName, env, platform)
  if (!uv && !uvx) return { status: 'missing' }
  if (!uv || !uvx) {
    return { status: 'incomplete', rootDir: inferUvRootFromExecutable(uv ?? uvx ?? '') }
  }
  const rootDir = inferUvRootFromExecutable(uv)
  return {
    status: 'complete',
    toolchain: {
      kind: 'uv',
      version: null,
      rootDir,
      binDir: rootDir,
      uv,
      uvx
    }
  }
}

export function probeCustomNode(customPath: string, platform: NodeJS.Platform): NodeProbeResult {
  if (!path.isAbsolute(customPath) || customPath.includes('\0')) return { status: 'missing' }
  if (isExistingFile(customPath)) {
    return locateCustomNodeSiblings(customPath, platform)
  }
  const rootDir = resolveCustomRoot(customPath, platform, 'node')
  if (!rootDir) return { status: 'missing' }
  return probeNodeRoot(rootDir, platform, false)
}

export function probeCustomUv(customPath: string, platform: NodeJS.Platform): UvProbeResult {
  const rootDir = resolveCustomRoot(customPath, platform, 'uv')
  if (!rootDir) return { status: 'missing' }
  return probeUvRoot(rootDir, platform)
}

export function findOnPath(
  command: string,
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform
): string | null {
  const pathValue = readPathValue(env, platform)
  if (!pathValue) return null
  const delimiter = platform === 'win32' ? ';' : ':'
  const extensions =
    platform === 'win32' && !hasWindowsExtension(command) ? parsePathExt(env) : ['']
  const entries = pathValue.split(delimiter, PATH_SCAN_LIMIT)
  for (const entry of entries) {
    const trimmed = entry.trim().replace(/^"(.*)"$/, '$1')
    if (!trimmed || !path.isAbsolute(trimmed)) continue
    for (const extension of extensions) {
      const candidate = path.join(trimmed, `${command}${extension}`)
      if (isExistingFile(candidate)) return candidate
    }
  }
  return null
}

function locateCustomNodeSiblings(
  nodeExecutable: string,
  platform: NodeJS.Platform
): NodeProbeResult {
  const binDir = path.dirname(nodeExecutable)
  const npmName = platform === 'win32' ? 'npm.cmd' : 'npm'
  const npxName = platform === 'win32' ? 'npx.cmd' : 'npx'
  const corepackName = platform === 'win32' ? 'corepack.cmd' : 'corepack'
  const npm = fileIfExists(path.join(binDir, npmName))
  const npx = fileIfExists(path.join(binDir, npxName))
  if (!npm || !npx) {
    return { status: 'incomplete', rootDir: inferNodeRootFromExecutable(nodeExecutable, platform) }
  }
  return {
    status: 'complete',
    toolchain: {
      kind: 'node',
      version: null,
      nodeModuleVersion: null,
      rootDir: inferNodeRootFromExecutable(nodeExecutable, platform),
      binDir,
      node: nodeExecutable,
      npm,
      npx,
      corepack: fileIfExists(path.join(binDir, corepackName))
    }
  }
}

function locateSystemNodeSiblings(
  nodeExecutable: string,
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform
): NodeProbeResult {
  const binDir = path.dirname(nodeExecutable)
  const npmName = platform === 'win32' ? 'npm.cmd' : 'npm'
  const npxName = platform === 'win32' ? 'npx.cmd' : 'npx'
  const corepackName = platform === 'win32' ? 'corepack.cmd' : 'corepack'
  const npm = fileIfExists(path.join(binDir, npmName)) ?? findOnPath(npmName, env, platform)
  const npx = fileIfExists(path.join(binDir, npxName)) ?? findOnPath(npxName, env, platform)
  if (!npm || !npx) {
    return { status: 'incomplete', rootDir: inferNodeRootFromExecutable(nodeExecutable, platform) }
  }
  const corepack =
    fileIfExists(path.join(binDir, corepackName)) ?? findOnPath(corepackName, env, platform)
  return {
    status: 'complete',
    toolchain: {
      kind: 'node',
      version: null,
      nodeModuleVersion: null,
      rootDir: inferNodeRootFromExecutable(nodeExecutable, platform),
      binDir,
      node: nodeExecutable,
      npm,
      npx,
      corepack
    }
  }
}

function resolveCustomRoot(
  customPath: string,
  platform: NodeJS.Platform,
  kind: 'node' | 'uv'
): string | null {
  if (!path.isAbsolute(customPath) || customPath.includes('\0')) return null
  if (isExistingDirectory(customPath)) return customPath
  if (!isExistingFile(customPath)) return null
  return kind === 'node'
    ? inferNodeRootFromExecutable(customPath, platform)
    : inferUvRootFromExecutable(customPath)
}

function readPathValue(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string | undefined {
  if (platform === 'win32') return env.Path || env.PATH || env.path
  return env.PATH || env.Path || env.path
}

function parsePathExt(env: NodeJS.ProcessEnv): string[] {
  const raw = env.PATHEXT || '.COM;.EXE;.BAT;.CMD'
  return raw.split(';').filter(Boolean)
}

function hasWindowsExtension(command: string): boolean {
  return /\.(exe|cmd|bat|com)$/i.test(command)
}

function isExistingFile(filePath: string): boolean {
  try {
    return statSync(filePath).isFile()
  } catch {
    return false
  }
}

function isExistingDirectory(directory: string): boolean {
  try {
    return statSync(directory).isDirectory()
  } catch {
    return false
  }
}

function fileIfExists(filePath: string): string | null {
  return isExistingFile(filePath) ? filePath : null
}
