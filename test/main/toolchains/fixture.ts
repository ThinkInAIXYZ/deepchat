import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { vi } from 'vitest'
import { NODE_MODULE_VERSION, NODE_PIN } from '../../../src/main/toolchains/catalog'
import { ToolchainService } from '../../../src/main/toolchains/service'

vi.unmock('fs')
vi.unmock('node:fs')
vi.unmock('path')
vi.unmock('node:path')

export function writeExecutable(filePath: string): void {
  mkdirSync(path.dirname(filePath), { recursive: true })
  writeFileSync(filePath, '')
  chmodSync(filePath, 0o755)
}

export function seedUnixNodeTree(rootDir: string, includeCorepack = false): void {
  writeExecutable(path.join(rootDir, 'bin', 'node'))
  writeExecutable(path.join(rootDir, 'bin', 'npm'))
  writeExecutable(path.join(rootDir, 'bin', 'npx'))
  if (includeCorepack) writeExecutable(path.join(rootDir, 'bin', 'corepack'))
}

export function seedUnixUvTree(rootDir: string): void {
  writeExecutable(path.join(rootDir, 'uv'))
  writeExecutable(path.join(rootDir, 'uvx'))
}

export function createTempDir(prefix: string): string {
  return mkdtempSync(path.join(os.tmpdir(), prefix))
}

export function initializeTestToolchain(options?: {
  seedBundled?: boolean
  env?: NodeJS.ProcessEnv
}): { service: ToolchainService; appPath: string; userDataDir: string } {
  const appPath = createTempDir('dc-app-')
  const userDataDir = createTempDir('dc-data-')
  if (options?.seedBundled !== false) {
    seedUnixNodeTree(path.join(appPath, 'runtime', 'node'))
    seedUnixUvTree(path.join(appPath, 'runtime', 'uv'))
  }
  const service = ToolchainService.initialize({
    appPath,
    userDataDir,
    platform: 'darwin',
    env: options?.env ?? { PATH: '' },
    inspectNode: () => ({ version: NODE_PIN, modules: NODE_MODULE_VERSION })
  })
  return { service, appPath, userDataDir }
}
