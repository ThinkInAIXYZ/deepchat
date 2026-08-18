import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  writeSync
} from 'node:fs'
import path from 'node:path'
import type { ToolchainSelection, ToolchainSource, ToolchainState } from '@shared/types/toolchains'
import { TOOLCHAIN_SOURCES } from '@shared/types/toolchains'
import { stateFilePath } from './layout'

const SOURCE_SET = new Set<string>(TOOLCHAIN_SOURCES)

export function emptyToolchainState(): ToolchainState {
  return {
    schemaVersion: 1,
    node: { source: 'unconfigured' },
    uv: { source: 'unconfigured' }
  }
}

export function loadToolchainState(userDataDir: string): ToolchainState | null {
  const filePath = stateFilePath(userDataDir)
  try {
    const raw = readFileSync(filePath, 'utf8')
    return parseToolchainState(JSON.parse(raw))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

export function quarantineCorruptState(userDataDir: string): void {
  const filePath = stateFilePath(userDataDir)
  try {
    renameSync(filePath, `${filePath}.corrupt`)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}

export function saveToolchainState(userDataDir: string, state: ToolchainState): void {
  const filePath = stateFilePath(userDataDir)
  mkdirSync(path.dirname(filePath), { recursive: true })
  const payload = `${JSON.stringify(state, null, 2)}\n`
  const tempPath = `${filePath}.tmp`
  const fd = openSync(tempPath, 'w')
  try {
    writeSync(fd, payload)
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
  renameSync(tempPath, filePath)
}

export function parseToolchainState(value: unknown): ToolchainState {
  if (!value || typeof value !== 'object') {
    throw new Error('Toolchain state is not an object')
  }
  const record = value as Record<string, unknown>
  if (record.schemaVersion !== 1) {
    throw new Error('Unsupported toolchain state schema')
  }
  return {
    schemaVersion: 1,
    node: parseSelection(record.node, 'node'),
    uv: parseSelection(record.uv, 'uv')
  }
}

function parseSelection(value: unknown, label: string): ToolchainSelection {
  if (!value || typeof value !== 'object') {
    throw new Error(`Toolchain ${label} selection is invalid`)
  }
  const record = value as Record<string, unknown>
  if (typeof record.source !== 'string' || !SOURCE_SET.has(record.source)) {
    throw new Error(`Toolchain ${label} source is invalid`)
  }
  const source = record.source as ToolchainSource
  const selection: ToolchainSelection = { source }
  if (typeof record.version === 'string' && record.version.length > 0) {
    selection.version = record.version
  }
  if (typeof record.customPath === 'string' && record.customPath.length > 0) {
    selection.customPath = record.customPath
  }
  if (source === 'managed' && !selection.version) {
    throw new Error(`Toolchain ${label} managed source is missing a version`)
  }
  if (source === 'custom' && !selection.customPath) {
    throw new Error(`Toolchain ${label} custom source is missing a path`)
  }
  return selection
}
