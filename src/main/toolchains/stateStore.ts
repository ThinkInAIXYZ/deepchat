import { randomUUID } from 'node:crypto'
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
import type {
  ToolchainPersistedState,
  ToolchainSelection,
  ToolchainSource
} from '@shared/types/toolchains'
import { TOOLCHAIN_SOURCES } from '@shared/types/toolchains'
import { assertSafeToolchainVersion, stateFilePath } from './layout'

const SOURCE_SET = new Set<string>(TOOLCHAIN_SOURCES)

export function emptyPersistedToolchainState(): ToolchainPersistedState {
  return { schemaVersion: 1 }
}

export function loadToolchainState(userDataDir: string): ToolchainPersistedState | null {
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
  const quarantinePath = `${filePath}.corrupt.${Date.now()}.${randomUUID()}`
  try {
    renameSync(filePath, quarantinePath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}

export function saveToolchainState(userDataDir: string, state: ToolchainPersistedState): void {
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

export function parseToolchainState(value: unknown): ToolchainPersistedState {
  if (!value || typeof value !== 'object') {
    throw new Error('Toolchain state is not an object')
  }
  const record = value as Record<string, unknown>
  if (record.schemaVersion !== 1) {
    throw new Error('Unsupported toolchain state schema')
  }
  if (record.provisional === true) {
    return emptyPersistedToolchainState()
  }
  const persisted: ToolchainPersistedState = { schemaVersion: 1 }
  if (record.node !== undefined) persisted.node = parseSelection(record.node, 'node')
  if (record.uv !== undefined) persisted.uv = parseSelection(record.uv, 'uv')
  return persisted
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
  if (record.explicit === true) {
    selection.explicit = true
  }
  if (source === 'managed') {
    if (!selection.version) {
      throw new Error(`Toolchain ${label} managed source is missing a version`)
    }
    assertSafeToolchainVersion(selection.version)
  }
  if (source === 'custom' && !selection.customPath) {
    throw new Error(`Toolchain ${label} custom source is missing a path`)
  }
  return selection
}
