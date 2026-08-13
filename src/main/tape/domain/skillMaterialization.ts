import { createHash } from 'crypto'
import { canonicalJsonStringifyData, hashJsonData } from './canonicalJson'
import type { DeepChatTapeSkillMaterializationRef } from '@shared/types/tape-view-manifest'
import { isSkillSourceType, type SkillSourceType } from '@shared/types/skillManagement'
import {
  SKILL_EFFECTIVE_CONTENT_MAX_BATCH_BYTES,
  SKILL_EFFECTIVE_CONTENT_MAX_BYTES,
  SKILL_EXECUTION_PACKAGE_MAX_BATCH_BYTES,
  SKILL_EXECUTION_PACKAGE_MAX_BATCH_ENCODED_BYTES,
  SKILL_EXECUTION_PACKAGE_MAX_BYTES,
  SKILL_EXECUTION_PACKAGE_MAX_DEPTH,
  SKILL_EXECUTION_PACKAGE_MAX_DIRECTORIES,
  SKILL_EXECUTION_PACKAGE_MAX_ENCODED_BYTES,
  SKILL_EXECUTION_PACKAGE_MAX_FILES,
  SKILL_EXECUTION_PACKAGE_MAX_FILE_BYTES,
  SKILL_EXECUTION_PACKAGE_MAX_PATH_BYTES,
  type EffectiveSkillExecutionPackage
} from '@shared/types/skill'
import type { DeepChatTapeEntryRow } from './entry'
import { isBoundedSkillTapeIdentity, MAX_SKILL_TAPE_IDENTITY_BYTES } from './skillIdentity'

export const SKILL_MATERIALIZATION_NAME = 'skill/materialized' as const
export const SKILL_MATERIALIZATION_SCHEMA_VERSION = 3 as const
export const MAX_SKILL_MATERIALIZATION_BODY_BYTES = SKILL_EFFECTIVE_CONTENT_MAX_BYTES
export const MAX_SKILL_MATERIALIZATION_BATCH_COUNT = 64
export const MAX_SKILL_MATERIALIZATION_BATCH_BYTES = SKILL_EFFECTIVE_CONTENT_MAX_BATCH_BYTES
export const MAX_SKILL_MATERIALIZATION_PACKAGE_BATCH_BYTES = SKILL_EXECUTION_PACKAGE_MAX_BATCH_BYTES
export const MAX_SKILL_MATERIALIZATION_PACKAGE_ENCODED_BYTES =
  SKILL_EXECUTION_PACKAGE_MAX_ENCODED_BYTES
export const MAX_SKILL_MATERIALIZATION_PACKAGE_BATCH_ENCODED_BYTES =
  SKILL_EXECUTION_PACKAGE_MAX_BATCH_ENCODED_BYTES
const MAX_SKILL_MATERIALIZATION_STORED_PAYLOAD_BYTES =
  SKILL_EFFECTIVE_CONTENT_MAX_BYTES * 6 + SKILL_EXECUTION_PACKAGE_MAX_ENCODED_BYTES + 64 * 1024

const SHA256 = /^[a-f0-9]{64}$/

export interface TapeSkillIdentity {
  agentId: string
  sourceType: SkillSourceType
  sourceId: string
  skillName: string
}

export interface TapeSkillMaterializationPayload extends TapeSkillIdentity {
  schemaVersion: 2 | 3
  tapeIncarnationId: string
  effectiveContent: string
  effectiveContentHash: string
  builderVersion: string
  renderedManifestHash: string
  scriptInventoryHash: string
  byteCount: number
  executionPackage: EffectiveSkillExecutionPackage & { packageHash: string; byteCount: number }
}

export interface TapeSkillMaterializationInput extends TapeSkillIdentity {
  sessionId: string
  expectedTapeIncarnationId: string
  effectiveContent: string
  builderVersion: string
  renderedManifestHash: string
  scriptInventoryHash: string
  executionPackage: EffectiveSkillExecutionPackage
}

export interface TapeSkillMaterializationReceipt {
  sessionId: string
  entryId: number
  tapeIncarnationId: string
  provenanceKey: string
  payloadHash: string
  payload: TapeSkillMaterializationPayload
}

export type TapeSkillMaterializationRef = DeepChatTapeSkillMaterializationRef & {
  sessionId: string
}

function parseObject(json: string, field: string): Record<string, unknown> {
  let value: unknown
  try {
    value = JSON.parse(json) as unknown
  } catch {
    throw new TypeError(`${field} must contain valid JSON.`)
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${field} must contain a JSON object.`)
  }
  return value as Record<string, unknown>
}

function requireIdentity(value: unknown, field: string): string {
  if (!isBoundedSkillTapeIdentity(value)) {
    throw new TypeError(
      `${field} must be a non-empty UTF-8 string of at most ${MAX_SKILL_TAPE_IDENTITY_BYTES} bytes.`
    )
  }
  return value
}

function requireHash(value: unknown, field: string): string {
  if (typeof value !== 'string' || !SHA256.test(value)) {
    throw new TypeError(`${field} must be a lowercase SHA-256 hash.`)
  }
  return value
}

export function hashSkillEffectiveContent(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex')
}

function exactKeys(value: Record<string, unknown>, keys: string[], field: string): void {
  if (Object.keys(value).sort().join('\0') !== [...keys].sort().join('\0')) {
    throw new TypeError(`${field} has unknown or missing fields.`)
  }
}

export function canonicalSkillExecutionPackagePath(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !value ||
    value !== value.normalize('NFC') ||
    value.includes('\0') ||
    Buffer.byteLength(value, 'utf8') > SKILL_EXECUTION_PACKAGE_MAX_PATH_BYTES
  ) {
    throw new TypeError('Execution package path must be a non-empty NFC string.')
  }
  if (
    value.startsWith('/') ||
    /^[A-Za-z]:\//.test(value) ||
    value.includes('\\') ||
    value.split('/').some((part) => !part || part === '.' || part === '..')
  ) {
    throw new TypeError('Execution package path must be a canonical POSIX relative path.')
  }
  const segments = value.split('/')
  if (segments.length > SKILL_EXECUTION_PACKAGE_MAX_DEPTH + 2) {
    throw new RangeError('Execution package path exceeds the maximum depth.')
  }
  const windowsDevices = new Set([
    'CON',
    'PRN',
    'AUX',
    'NUL',
    ...Array.from({ length: 9 }, (_, index) => `COM${index + 1}`),
    ...Array.from({ length: 9 }, (_, index) => `LPT${index + 1}`)
  ])
  for (const segment of segments) {
    const deviceStem = segment
      .split('.')[0]
      .replace(/[ .]+$/g, '')
      .toUpperCase()
    if (
      /[<>:"|?*]/.test(segment) ||
      Array.from(segment).some((character) => character.charCodeAt(0) <= 0x1f) ||
      segment.includes(':') ||
      segment.startsWith('.') ||
      segment.endsWith('.') ||
      segment.endsWith(' ') ||
      windowsDevices.has(deviceStem)
    ) {
      throw new TypeError('Execution package path is not portable across supported platforms.')
    }
  }
  return value
}

function validateExecutionPackage(
  value: unknown,
  allowSupportPaths: boolean
): TapeSkillMaterializationPayload['executionPackage'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('executionPackage must be an object.')
  }
  const candidate = value as Record<string, unknown>
  exactKeys(
    candidate,
    ['files', 'executables', 'runtimePolicy', 'environmentBindingId', 'packageHash', 'byteCount'],
    'executionPackage'
  )
  if (
    !Array.isArray(candidate.files) ||
    candidate.files.length > SKILL_EXECUTION_PACKAGE_MAX_FILES
  ) {
    throw new RangeError('Execution package file count is invalid.')
  }
  let byteCount = 0
  let previous: string | null = null
  const paths = new Set<string>()
  const portableNodes = new Map<string, { path: string; kind: 'directory' | 'file' }>()
  const directories = new Set<string>()
  const files = candidate.files.map((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new TypeError('Execution package file must be an object.')
    const file = value as Record<string, unknown>
    exactKeys(file, ['relativePath', 'base64', 'byteCount', 'sha256'], 'Execution package file')
    const relativePath = canonicalSkillExecutionPackagePath(file.relativePath)
    if (!allowSupportPaths && !relativePath.startsWith('scripts/')) {
      throw new TypeError('Schema 2 execution package files must be under scripts/.')
    }
    if (
      previous !== null &&
      Buffer.compare(Buffer.from(previous), Buffer.from(relativePath)) >= 0
    ) {
      throw new TypeError('Execution package files must be in unique bytewise order.')
    }
    previous = relativePath
    const segments = relativePath.split('/')
    for (let length = 1; length < segments.length; length += 1) {
      const directory = segments.slice(0, length).join('/')
      const fold = directory.toLowerCase()
      const existing = portableNodes.get(fold)
      if (existing && (existing.path !== directory || existing.kind !== 'directory')) {
        throw new TypeError('Execution package paths collide on a supported platform.')
      }
      portableNodes.set(fold, { path: directory, kind: 'directory' })
      directories.add(directory)
    }
    if (directories.size > SKILL_EXECUTION_PACKAGE_MAX_DIRECTORIES) {
      throw new RangeError('Execution package directory count is invalid.')
    }
    const fold = relativePath.toLowerCase()
    const existing = portableNodes.get(fold)
    if (paths.has(relativePath) || existing)
      throw new TypeError('Execution package paths collide on a supported platform.')
    paths.add(relativePath)
    portableNodes.set(fold, { path: relativePath, kind: 'file' })
    if (
      !Number.isSafeInteger(file.byteCount) ||
      (file.byteCount as number) < 0 ||
      (file.byteCount as number) > SKILL_EXECUTION_PACKAGE_MAX_FILE_BYTES
    ) {
      throw new RangeError('Execution package file byte count is invalid.')
    }
    const declaredByteCount = file.byteCount as number
    if (
      typeof file.base64 !== 'string' ||
      file.base64.length !== 4 * Math.ceil(declaredByteCount / 3) ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(file.base64)
    ) {
      throw new TypeError('Execution package file has invalid base64.')
    }
    byteCount += declaredByteCount
    if (byteCount > SKILL_EXECUTION_PACKAGE_MAX_BYTES) {
      throw new RangeError('Execution package byte count is invalid.')
    }
    const bytes = Buffer.from(file.base64, 'base64')
    if (bytes.toString('base64') !== file.base64)
      throw new TypeError('Execution package file has non-canonical base64.')
    if (declaredByteCount !== bytes.byteLength) {
      throw new RangeError('Execution package file byte count is invalid.')
    }
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    if (file.sha256 !== sha256) throw new TypeError('Execution package file hash is invalid.')
    return { relativePath, base64: file.base64, byteCount: bytes.byteLength, sha256 }
  })
  if (byteCount > SKILL_EXECUTION_PACKAGE_MAX_BYTES || candidate.byteCount !== byteCount) {
    throw new RangeError('Execution package byte count is invalid.')
  }
  if (!Array.isArray(candidate.executables))
    throw new TypeError('Execution package executables must be an array.')
  let previousExecutable: string | null = null
  const executables = candidate.executables.map((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new TypeError('Execution package executable must be an object.')
    const executable = value as Record<string, unknown>
    exactKeys(executable, ['relativePath', 'runtime', 'enabled'], 'Execution package executable')
    const relativePath = canonicalSkillExecutionPackagePath(executable.relativePath)
    if (
      previousExecutable !== null &&
      Buffer.compare(Buffer.from(previousExecutable), Buffer.from(relativePath)) >= 0
    )
      throw new TypeError('Execution package executables must be in unique bytewise order.')
    previousExecutable = relativePath
    if (
      executable.runtime !== 'python' &&
      executable.runtime !== 'node' &&
      executable.runtime !== 'shell'
    )
      throw new TypeError('Execution package executable runtime is invalid.')
    if (typeof executable.enabled !== 'boolean')
      throw new TypeError('Execution package executable enabled state is invalid.')
    if (!paths.has(relativePath))
      throw new TypeError('Execution package executable file is missing.')
    if (!relativePath.startsWith('scripts/')) {
      throw new TypeError('Execution package executable must be under scripts/.')
    }
    const extension = relativePath.slice(relativePath.lastIndexOf('.')).toLowerCase()
    const expectedRuntime =
      extension === '.py'
        ? 'python'
        : extension === '.js' || extension === '.mjs' || extension === '.cjs'
          ? 'node'
          : extension === '.sh'
            ? 'shell'
            : null
    if (expectedRuntime !== executable.runtime) {
      throw new TypeError('Execution package executable runtime does not match its file type.')
    }
    return { relativePath, runtime: executable.runtime, enabled: executable.enabled }
  })
  const runtimePolicy = candidate.runtimePolicy as Record<string, unknown>
  if (!runtimePolicy || typeof runtimePolicy !== 'object' || Array.isArray(runtimePolicy))
    throw new TypeError('Execution package runtimePolicy is invalid.')
  exactKeys(runtimePolicy, ['python', 'node'], 'Execution package runtimePolicy')
  const preference = (value: unknown) =>
    value === 'auto' || value === 'system' || value === 'builtin'
  if (!preference(runtimePolicy.python) || !preference(runtimePolicy.node))
    throw new TypeError('Execution package runtimePolicy is invalid.')
  const environmentBindingId = candidate.environmentBindingId
  if (
    environmentBindingId !== null &&
    (typeof environmentBindingId !== 'string' ||
      !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(environmentBindingId))
  ) {
    throw new TypeError('Execution package environment binding is invalid.')
  }
  const source = {
    files,
    executables,
    runtimePolicy: { python: runtimePolicy.python, node: runtimePolicy.node },
    environmentBindingId
  }
  if (
    Buffer.byteLength(canonicalJsonStringifyData(source), 'utf8') >
    MAX_SKILL_MATERIALIZATION_PACKAGE_ENCODED_BYTES
  ) {
    throw new RangeError('Execution package encoded payload exceeds 7 MiB.')
  }
  const packageHash = hashJsonData(source)
  if (candidate.packageHash !== packageHash)
    throw new TypeError('Execution package hash is invalid.')
  return {
    ...source,
    packageHash,
    byteCount
  } as TapeSkillMaterializationPayload['executionPackage']
}

export function validateSkillExecutionPackage(
  value: unknown
): TapeSkillMaterializationPayload['executionPackage'] {
  return validateExecutionPackage(value, true)
}

function createExecutionPackage(
  source: EffectiveSkillExecutionPackage
): TapeSkillMaterializationPayload['executionPackage'] {
  const byteCount = source.files.reduce((sum, file) => sum + file.byteCount, 0)
  return validateExecutionPackage({ ...source, byteCount, packageHash: hashJsonData(source) }, true)
}

export function createTapeSkillMaterializationPayload(
  input: TapeSkillMaterializationInput
): TapeSkillMaterializationPayload {
  const effectiveContent = input.effectiveContent
  if (typeof effectiveContent !== 'string')
    throw new TypeError('effectiveContent must be a string.')
  const byteCount = Buffer.byteLength(effectiveContent, 'utf8')
  if (byteCount > MAX_SKILL_MATERIALIZATION_BODY_BYTES) {
    throw new RangeError('Skill materialization body exceeds 512 KiB.')
  }
  return validateTapeSkillMaterializationPayload({
    schemaVersion: SKILL_MATERIALIZATION_SCHEMA_VERSION,
    tapeIncarnationId: input.expectedTapeIncarnationId,
    agentId: input.agentId,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    skillName: input.skillName,
    effectiveContent,
    effectiveContentHash: hashSkillEffectiveContent(effectiveContent),
    builderVersion: input.builderVersion,
    renderedManifestHash: input.renderedManifestHash,
    scriptInventoryHash: input.scriptInventoryHash,
    byteCount,
    executionPackage: createExecutionPackage(input.executionPackage)
  })
}

export function validateTapeSkillMaterializationPayload(
  value: unknown
): TapeSkillMaterializationPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Skill materialization payload must be an object.')
  }
  const payload = value as Record<string, unknown>
  const expectedKeys = [
    'agentId',
    'builderVersion',
    'byteCount',
    'effectiveContent',
    'effectiveContentHash',
    'executionPackage',
    'renderedManifestHash',
    'schemaVersion',
    'scriptInventoryHash',
    'skillName',
    'sourceType',
    'sourceId',
    'tapeIncarnationId'
  ].sort()
  if (Object.keys(payload).sort().join('\0') !== expectedKeys.join('\0')) {
    throw new TypeError('Skill materialization payload has unknown or missing fields.')
  }
  if (payload.schemaVersion !== 2 && payload.schemaVersion !== 3) {
    throw new TypeError('Unsupported Skill materialization schema.')
  }
  const schemaVersion = payload.schemaVersion
  const effectiveContent =
    typeof payload.effectiveContent === 'string' ? payload.effectiveContent : null
  if (effectiveContent === null) throw new TypeError('effectiveContent must be a string.')
  const byteCount = Buffer.byteLength(effectiveContent, 'utf8')
  if (byteCount > MAX_SKILL_MATERIALIZATION_BODY_BYTES || payload.byteCount !== byteCount) {
    throw new RangeError('Skill materialization byte count is invalid.')
  }
  if (payload.effectiveContentHash !== hashSkillEffectiveContent(effectiveContent)) {
    throw new TypeError('Skill materialization content hash is invalid.')
  }
  const sourceType = requireIdentity(payload.sourceType, 'sourceType')
  if (!isSkillSourceType(sourceType)) {
    throw new TypeError('sourceType is not a supported Skill source type.')
  }
  return {
    schemaVersion,
    tapeIncarnationId: requireIdentity(payload.tapeIncarnationId, 'tapeIncarnationId'),
    agentId: requireIdentity(payload.agentId, 'agentId'),
    sourceType,
    sourceId: requireIdentity(payload.sourceId, 'sourceId'),
    skillName: requireIdentity(payload.skillName, 'skillName'),
    effectiveContent,
    effectiveContentHash: requireHash(payload.effectiveContentHash, 'effectiveContentHash'),
    builderVersion: requireIdentity(payload.builderVersion, 'builderVersion'),
    renderedManifestHash: requireHash(payload.renderedManifestHash, 'renderedManifestHash'),
    scriptInventoryHash: requireHash(payload.scriptInventoryHash, 'scriptInventoryHash'),
    byteCount,
    executionPackage: validateExecutionPackage(payload.executionPackage, schemaVersion === 3)
  }
}

export function buildTapeSkillMaterializationProvenanceKey(
  sessionId: string,
  payload: TapeSkillMaterializationPayload
): string {
  requireIdentity(sessionId, 'sessionId')
  return `skill-materialized:${hashJsonData({ sessionId, payload })}`
}

export function canonicalSkillMaterializationPayload(
  payload: TapeSkillMaterializationPayload
): string {
  return canonicalJsonStringifyData(payload)
}

export function buildTapeSkillMaterializationPayloadHash(
  payload: TapeSkillMaterializationPayload
): string {
  return hashJsonData(payload)
}

export function validateTapeSkillMaterializationBatch(
  inputs: readonly TapeSkillMaterializationInput[]
): TapeSkillMaterializationPayload[] {
  if (inputs.length > MAX_SKILL_MATERIALIZATION_BATCH_COUNT) {
    throw new RangeError('Skill materialization batch exceeds 64 bodies.')
  }
  let bytes = 0
  let packageBytes = 0
  let encodedPackageBytes = 0
  return inputs.map((input) => {
    requireIdentity(input.sessionId, 'sessionId')
    const payload = createTapeSkillMaterializationPayload(input)
    bytes += payload.byteCount
    if (bytes > MAX_SKILL_MATERIALIZATION_BATCH_BYTES) {
      throw new RangeError('Skill materialization batch exceeds 2 MiB.')
    }
    packageBytes += payload.executionPackage.byteCount
    if (packageBytes > MAX_SKILL_MATERIALIZATION_PACKAGE_BATCH_BYTES) {
      throw new RangeError('Skill materialization package batch exceeds 16 MiB.')
    }
    encodedPackageBytes += Buffer.byteLength(
      canonicalJsonStringifyData(payload.executionPackage),
      'utf8'
    )
    if (encodedPackageBytes > MAX_SKILL_MATERIALIZATION_PACKAGE_BATCH_ENCODED_BYTES) {
      throw new RangeError('Skill materialization encoded package batch exceeds 28 MiB.')
    }
    return payload
  })
}

export function readTapeSkillMaterializationRow(
  row: DeepChatTapeEntryRow
): TapeSkillMaterializationReceipt {
  if (
    row.kind !== 'context' ||
    row.name !== SKILL_MATERIALIZATION_NAME ||
    row.source_type !== 'runtime_event' ||
    row.source_seq !== 0 ||
    !row.provenance_key
  ) {
    throw new Error('Stored Skill materialization identity is corrupt.')
  }
  if (
    Buffer.byteLength(row.payload_json, 'utf8') > MAX_SKILL_MATERIALIZATION_STORED_PAYLOAD_BYTES
  ) {
    throw new Error('Stored Skill materialization payload exceeds the canonical size limit.')
  }

  const payload = validateTapeSkillMaterializationPayload(
    parseObject(row.payload_json, 'Skill materialization payload')
  )
  const provenanceKey = buildTapeSkillMaterializationProvenanceKey(row.session_id, payload)
  if (row.source_id !== payload.sourceId || row.provenance_key !== provenanceKey) {
    throw new Error('Stored Skill materialization provenance is corrupt.')
  }

  const payloadHash = hashJsonData(payload)
  const meta = parseObject(row.meta_json, 'Skill materialization metadata')
  if (
    Object.keys(meta).length !== 1 ||
    typeof meta.payloadHash !== 'string' ||
    meta.payloadHash !== payloadHash
  ) {
    throw new Error('Stored Skill materialization payload hash is corrupt.')
  }

  return {
    sessionId: row.session_id,
    entryId: row.entry_id,
    tapeIncarnationId: payload.tapeIncarnationId,
    provenanceKey,
    payloadHash,
    payload
  }
}

export function buildTapeSkillMaterializationRef(
  receipt: TapeSkillMaterializationReceipt
): TapeSkillMaterializationRef {
  return {
    sessionId: receipt.sessionId,
    kind: 'materialization',
    entryId: receipt.entryId,
    tapeIncarnationId: receipt.tapeIncarnationId,
    agentId: receipt.payload.agentId,
    sourceType: receipt.payload.sourceType,
    sourceId: receipt.payload.sourceId,
    skillName: receipt.payload.skillName,
    effectiveContentHash: receipt.payload.effectiveContentHash
  }
}

export function readTapeSkillMaterializationRef(
  row: DeepChatTapeEntryRow,
  ref: TapeSkillMaterializationRef
): TapeSkillMaterializationReceipt {
  if (
    ref.kind !== 'materialization' ||
    row.session_id !== ref.sessionId ||
    row.entry_id !== ref.entryId
  ) {
    throw new Error('Skill materialization reference does not match its Tape entry.')
  }
  const receipt = readTapeSkillMaterializationRow(row)
  const payload = receipt.payload
  if (
    payload.tapeIncarnationId !== ref.tapeIncarnationId ||
    payload.agentId !== ref.agentId ||
    payload.sourceType !== ref.sourceType ||
    payload.sourceId !== ref.sourceId ||
    payload.skillName !== ref.skillName ||
    payload.effectiveContentHash !== ref.effectiveContentHash
  ) {
    throw new Error('Skill materialization reference identity or content hash drifted.')
  }
  return receipt
}
