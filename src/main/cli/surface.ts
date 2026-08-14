import type { RouteContract } from '@shared/contracts/contract'
import { JsonValueSchema, type JsonValue } from '@shared/contracts/json'
import {
  AUDIO_TRANSCRIPTION_MAX_INPUT_BYTES,
  OCR_EXTRACTION_MAX_INPUT_BYTES,
  PUBLIC_MCP_CONFIG_MAX_BYTES,
  PUBLIC_MCP_DESCRIPTION_MAX_CHARACTERS,
  PUBLIC_MCP_ICON_MAX_CHARACTERS,
  artifactsDeleteRoute,
  artifactsDescribeRoute,
  artifactsReadRoute,
  audioTranscribeArtifactRoute,
  audioTranscribeUploadRoute,
  cliCapabilitiesRoute,
  cliDoctorRoute,
  cliStatusRoute,
  cliVersionRoute,
  imagesGenerateRoute,
  modelsGetPublicConfigRoute,
  modelsInvokeRoute,
  modelsListRuntimeRoute,
  modelsResetConfigRoute,
  modelsSetPublicConfigRoute,
  modelsSetStatusRoute,
  mcpAddPublicRoute,
  mcpListPublicRoute,
  mcpRemovePublicRoute,
  mcpSetPublicStatusRoute,
  mcpStartPublicRoute,
  mcpStopPublicRoute,
  mcpUpdatePublicRoute,
  ocrClearCacheRoute,
  ocrExtractArtifactRoute,
  ocrExtractUploadRoute,
  ocrGetRuntimeStatusRoute,
  providersAddPublicRoute,
  providersListPublicRoute,
  providersRemoveRoute,
  providersSetCredentialRoute,
  providersTestPublicConnectionRoute,
  providersUpdatePublicRoute,
  speechGenerateRoute,
  sessionsRunDetachedRoute,
  settingsGetPublicRoute,
  settingsUpdatePublicRoute,
  skillsInstallPublicUrlRoute,
  skillsInstallUploadRoute,
  skillsListPublicRoute,
  skillsSetPublicStatusRoute,
  skillsUninstallPublicRoute,
  toolBatchRoute,
  toolCallRoute,
  toolDescribeRoute,
  toolSearchRoute,
  PROGRAMMATIC_TOOL_RPC_MAX_BODY_BYTES,
  PROGRAMMATIC_TOOL_RPC_TIMEOUT_MS,
  videosGenerateRoute,
  eventsSubscribeRoute,
  runsCancelRoute,
  runsGetRoute,
  type CliCapability
} from '@shared/contracts/routes'
import { SKILL_ARCHIVE_MAX_INPUT_BYTES } from '@shared/types/skill'
import {
  LOCAL_CONTROL_MAX_REQUEST_TIMEOUT_MS,
  LOCAL_CONTROL_PROGRAMMATIC_ROUTE_SURFACE_VERSION,
  LOCAL_CONTROL_PUBLIC_ROUTE_SURFACE_VERSION,
  type LocalControlEffect,
  type LocalControlPrincipal,
  type LocalControlRouteSurfaceVersion,
  type LocalControlScope
} from '@shared/contracts/localControl'
import { sanitizePublicText, stripC0AndC1Controls } from './publicText'

export type LocalControlTransport = 'rpc' | 'stream' | 'upload' | 'download'
export type LocalControlApprovalMode = 'never' | 'policy'
export type CliSurfaceEffect =
  | LocalControlEffect
  | Readonly<{
      possible: readonly LocalControlEffect[]
      resolve(input: unknown): LocalControlEffect
    }>

export type CliRouteLimits = Readonly<{
  maxBodyBytes: number
  timeoutMs: number
}>

export type CliSurfaceEntry = Readonly<{
  contract: RouteContract
  effect: CliSurfaceEffect
  callers: readonly LocalControlPrincipal[]
  scopes: readonly LocalControlScope[]
  transport: LocalControlTransport
  approval: LocalControlApprovalMode
  // Agent mutations fail closed unless the operation explicitly opts into a narrow policy path.
  agentPolicy?: 'allow' | 'approval'
  auditProjection?: (input: unknown) => JsonValue
  approvalDisplay?: (
    input: unknown,
    caller: Readonly<{ principal: LocalControlPrincipal }>
  ) => JsonValue
  agentInputAllowed?: (input: unknown) => boolean
  /** Exact V3 operation grants are the sole authority for these Agent-only entries. */
  programmaticOnly?: true
  limits: CliRouteLimits
}>

const AGENT_MCP_APPROVAL_MAX_REVIEW_BYTES = 16 * 1024

const PREFERENCE_SETTING_KEYS = new Set([
  'fontSizeLevel',
  'fontFamily',
  'codeFontFamily',
  'artifactsEffectEnabled',
  'autoScrollEnabled',
  'notificationsEnabled',
  'copyWithCotEnabled'
])

const EXECUTION_SETTING_KEYS = new Set([
  'autoCompactionEnabled',
  'autoCompactionTriggerThreshold',
  'autoCompactionRetainRecentPairs',
  'ocrAutoExtractForNonVisionModels',
  'ocrBackend'
])

function settingChangeKeys(input: unknown): string[] {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return []
  const changes = (input as Record<string, unknown>).changes
  if (!Array.isArray(changes)) return []
  return changes.flatMap((change) => {
    if (!change || typeof change !== 'object' || Array.isArray(change)) return []
    const key = (change as Record<string, unknown>).key
    return typeof key === 'string' ? [key] : []
  })
}

function settingChangesForDisplay(input: unknown): JsonValue {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return []
  const changes = (input as Record<string, unknown>).changes
  if (!Array.isArray(changes)) return []
  return changes.flatMap((change) => {
    if (!change || typeof change !== 'object' || Array.isArray(change)) return []
    const { key, value } = change as Record<string, unknown>
    if (
      typeof key !== 'string' ||
      !(
        value === null ||
        typeof value === 'string' ||
        (typeof value === 'number' && Number.isFinite(value)) ||
        typeof value === 'boolean'
      )
    ) {
      return []
    }
    return [{ key, value }]
  })
}

function stringArrayField(input: unknown, field: string): string[] {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return []
  const value = (input as Record<string, unknown>)[field]
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : []
}

function objectFieldKeys(input: unknown, field: string): string[] {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return []
  const value = (input as Record<string, unknown>)[field]
  return value && typeof value === 'object' && !Array.isArray(value)
    ? Object.keys(value).sort()
    : []
}

function jsonObjectField(input: unknown, field: string): Record<string, JsonValue> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {}
  const parsed = JsonValueSchema.safeParse((input as Record<string, unknown>)[field])
  return parsed.success &&
    parsed.data &&
    typeof parsed.data === 'object' &&
    !Array.isArray(parsed.data)
    ? parsed.data
    : {}
}

export function listCliSurfaceEffects(entry: CliSurfaceEntry): readonly LocalControlEffect[] {
  return typeof entry.effect === 'string' ? [entry.effect] : entry.effect.possible
}

export function resolveCliSurfaceEffect(
  entry: CliSurfaceEntry,
  input: unknown
): LocalControlEffect {
  if (typeof entry.effect === 'string') return entry.effect
  const resolved = entry.effect.resolve(input)
  if (!entry.effect.possible.includes(resolved)) {
    throw new Error(`CLI surface effect resolver returned an undeclared effect: ${resolved}`)
  }
  return resolved
}

function selectAuditFields(input: unknown, fields: readonly string[]): Record<string, JsonValue> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {}
  const source = input as Record<string, unknown>
  const selected: Record<string, JsonValue> = {}
  for (const field of fields) {
    const value = source[field]
    if (
      value === null ||
      typeof value === 'string' ||
      (typeof value === 'number' && Number.isFinite(value)) ||
      typeof value === 'boolean'
    ) {
      selected[field] = value
    }
  }
  return selected
}

function skillUrlDisplay(input: unknown): JsonValue {
  const selected = selectAuditFields(input, ['agentId', 'overwrite'])
  if (!input || typeof input !== 'object' || Array.isArray(input)) return selected
  const rawUrl = (input as Record<string, unknown>).url
  if (typeof rawUrl !== 'string') return selected
  try {
    const url = new URL(rawUrl)
    return {
      ...selected,
      origin: url.origin,
      path: url.pathname,
      queryPresent: url.search.length > 0
    }
  } catch {
    return selected
  }
}

function agentSkillUrlInputAllowed(input: unknown): boolean {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return false
  const rawUrl = (input as Record<string, unknown>).url
  if (typeof rawUrl !== 'string') return false
  try {
    const url = new URL(rawUrl)
    return (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      !containsDirectionalControl(rawUrl)
    )
  } catch {
    return false
  }
}

function mcpConfigProjection(
  input: unknown,
  field: 'config' | 'updates',
  includeReviewableValues = false
): JsonValue {
  const config = jsonObjectField(input, field)
  const projection: Record<string, JsonValue> = {
    fields: Object.keys(config).sort()
  }
  if (typeof config.type === 'string') projection.type = config.type
  if (typeof config.description === 'string') {
    if (includeReviewableValues) {
      projection.description = stripC0AndC1Controls(
        config.description,
        PUBLIC_MCP_DESCRIPTION_MAX_CHARACTERS
      )
      projection.descriptionTruncated = false
    } else {
      const description = sanitizePublicText(config.description, 512)
      projection.description = description.value
      projection.descriptionTruncated = description.truncated
    }
  }
  if (includeReviewableValues && typeof config.icon === 'string') {
    projection.icon = stripC0AndC1Controls(config.icon, PUBLIC_MCP_ICON_MAX_CHARACTERS)
  }
  if (typeof config.command === 'string') {
    const commandName = config.command.split(/[\\/]/).at(-1) ?? ''
    projection.commandName = sanitizePublicText(commandName, 256).value
  }
  if (Array.isArray(config.args)) projection.argumentCount = config.args.length
  if (typeof config.inheritEnv === 'string') projection.inheritEnv = config.inheritEnv
  if (config.environment && typeof config.environment === 'object') {
    projection.environment = mcpKeySummary(config.environment)
  }
  if (config.headers && typeof config.headers === 'object') {
    projection.headers = mcpKeySummary(config.headers)
  }
  if (typeof config.baseUrl === 'string') {
    projection.endpoint = mcpUrlSummary(config.baseUrl)
    if (includeReviewableValues) projection.endpointUrl = config.baseUrl
  }
  if (typeof config.customNpmRegistry === 'string') {
    projection.npmRegistry = mcpUrlSummary(config.customNpmRegistry)
  } else if (config.customNpmRegistry === null) {
    projection.npmRegistry = null
  }
  if (config.authorization && typeof config.authorization === 'object') {
    projection.authorization = selectAuditFields(config.authorization, ['mode'])
  } else if (config.authorization === null) {
    projection.authorization = null
  }
  return {
    ...selectAuditFields(input, ['serverName']),
    [field]: projection
  }
}

function containsDirectionalControl(value: string): boolean {
  return /[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u.test(value)
}

function agentMcpAddInputAllowed(input: unknown): boolean {
  const config = jsonObjectField(input, 'config')
  const headers = jsonObjectField(config, 'headers')
  if (
    (config.type !== 'sse' && config.type !== 'http') ||
    Object.keys(headers).length > 0 ||
    config.authorization !== undefined ||
    typeof config.baseUrl !== 'string'
  ) {
    return false
  }

  let endpoint: URL
  try {
    endpoint = new URL(config.baseUrl)
  } catch {
    return false
  }
  if (
    endpoint.protocol !== 'https:' ||
    [config.baseUrl, config.description, config.icon].some(
      (value) => typeof value === 'string' && containsDirectionalControl(value)
    )
  ) {
    return false
  }

  const reviewableValues: JsonValue = {
    type: config.type,
    description: config.description ?? '',
    icon: config.icon ?? '',
    endpointUrl: config.baseUrl
  }
  return (
    Buffer.byteLength(JSON.stringify(reviewableValues), 'utf8') <=
    AGENT_MCP_APPROVAL_MAX_REVIEW_BYTES
  )
}

function mcpConfigAudit(input: unknown, field: 'config' | 'updates'): JsonValue {
  const config = jsonObjectField(input, field)
  return {
    ...selectAuditFields(input, ['serverName']),
    fields: Object.keys(config).sort(),
    environment:
      config.environment && typeof config.environment === 'object'
        ? mcpKeySummary(config.environment)
        : { count: 0, names: [], truncated: false },
    headers:
      config.headers && typeof config.headers === 'object'
        ? mcpKeySummary(config.headers)
        : { count: 0, names: [], truncated: false }
  }
}

function mcpKeySummary(value: object): JsonValue {
  const keys = Object.keys(value).sort()
  const names = keys.slice(0, 16).map((key) => sanitizePublicText(key, 128).value)
  return {
    count: keys.length,
    names,
    truncated: keys.length > names.length
  }
}

function mcpUrlSummary(value: string): JsonValue {
  try {
    const url = new URL(value)
    const origin = sanitizePublicText(url.origin, 1024)
    return {
      origin: origin.value,
      pathPresent: url.pathname !== '/',
      truncated: origin.truncated
    }
  } catch {
    return { valid: false }
  }
}

const DIAGNOSTIC_LIMITS = {
  maxBodyBytes: 16 * 1024,
  timeoutMs: 5_000
} as const satisfies CliRouteLimits

const APPROVED_MUTATION_LIMITS = {
  maxBodyBytes: 16 * 1024,
  timeoutMs: 5 * 60_000
} as const satisfies CliRouteLimits

const RUN_CONTROL_LIMITS = {
  maxBodyBytes: 16 * 1024,
  timeoutMs: 30_000
} as const satisfies CliRouteLimits

const diagnosticEntry = (contract: RouteContract): CliSurfaceEntry => ({
  contract,
  effect: 'read',
  callers: ['human', 'agent'],
  scopes: ['system:read'],
  transport: 'rpc',
  approval: 'never',
  limits: DIAGNOSTIC_LIMITS
})

const mediaEntry = (contract: RouteContract): CliSurfaceEntry => ({
  contract,
  effect: 'compute',
  callers: ['human', 'agent'],
  scopes: ['media:generate'],
  transport: 'stream',
  approval: 'never',
  auditProjection: (input) => selectAuditFields(input, ['providerId', 'modelId']),
  limits: {
    maxBodyBytes: 512 * 1024,
    timeoutMs: LOCAL_CONTROL_MAX_REQUEST_TIMEOUT_MS
  }
})

const CLI_SURFACE_V2_ENTRIES = [
  {
    contract: modelsInvokeRoute,
    effect: 'compute',
    callers: ['human', 'agent'],
    scopes: ['models:invoke'],
    transport: 'stream',
    approval: 'never',
    auditProjection: (input) => {
      const selected = selectAuditFields(input, [
        'providerId',
        'modelId',
        'temperature',
        'maxTokens'
      ])
      const messages =
        input && typeof input === 'object' && !Array.isArray(input)
          ? (input as Record<string, unknown>).messages
          : undefined
      return { ...selected, messageCount: Array.isArray(messages) ? messages.length : 0 }
    },
    limits: { maxBodyBytes: 5 * 1024 * 1024, timeoutMs: LOCAL_CONTROL_MAX_REQUEST_TIMEOUT_MS }
  },
  mediaEntry(imagesGenerateRoute),
  mediaEntry(videosGenerateRoute),
  mediaEntry(speechGenerateRoute),
  {
    contract: audioTranscribeUploadRoute,
    effect: 'compute',
    callers: ['human'],
    scopes: ['audio:transcribe'],
    transport: 'upload',
    approval: 'never',
    auditProjection: (input) => selectAuditFields(input, ['providerId', 'modelId', 'mimeType']),
    limits: {
      maxBodyBytes: AUDIO_TRANSCRIPTION_MAX_INPUT_BYTES,
      timeoutMs: LOCAL_CONTROL_MAX_REQUEST_TIMEOUT_MS
    }
  },
  {
    contract: audioTranscribeArtifactRoute,
    effect: 'compute',
    callers: ['human', 'agent'],
    scopes: ['audio:transcribe', 'artifacts:read'],
    transport: 'rpc',
    approval: 'never',
    auditProjection: (input) => selectAuditFields(input, ['providerId', 'modelId', 'artifactId']),
    limits: {
      maxBodyBytes: 16 * 1024,
      timeoutMs: LOCAL_CONTROL_MAX_REQUEST_TIMEOUT_MS
    }
  },
  {
    contract: ocrGetRuntimeStatusRoute,
    effect: 'read',
    callers: ['human', 'agent'],
    scopes: ['ocr:read'],
    transport: 'rpc',
    approval: 'never',
    limits: DIAGNOSTIC_LIMITS
  },
  {
    contract: ocrExtractUploadRoute,
    effect: 'compute',
    callers: ['human'],
    scopes: ['ocr:extract'],
    transport: 'upload',
    approval: 'never',
    auditProjection: (input) =>
      selectAuditFields(input, [
        'mimeType',
        'backend',
        'sourcePageCountHint',
        'generationTokenLimit'
      ]),
    limits: {
      maxBodyBytes: OCR_EXTRACTION_MAX_INPUT_BYTES,
      timeoutMs: LOCAL_CONTROL_MAX_REQUEST_TIMEOUT_MS
    }
  },
  {
    contract: ocrExtractArtifactRoute,
    effect: 'compute',
    callers: ['human', 'agent'],
    scopes: ['ocr:extract', 'artifacts:read'],
    transport: 'rpc',
    approval: 'never',
    auditProjection: (input) =>
      selectAuditFields(input, [
        'artifactId',
        'backend',
        'sourcePageCountHint',
        'generationTokenLimit'
      ]),
    limits: {
      maxBodyBytes: 16 * 1024,
      timeoutMs: LOCAL_CONTROL_MAX_REQUEST_TIMEOUT_MS
    }
  },
  {
    contract: ocrClearCacheRoute,
    effect: 'local-maintenance',
    callers: ['human'],
    scopes: ['ocr:manage'],
    transport: 'rpc',
    approval: 'never',
    limits: {
      maxBodyBytes: 16 * 1024,
      timeoutMs: LOCAL_CONTROL_MAX_REQUEST_TIMEOUT_MS
    }
  },
  {
    contract: sessionsRunDetachedRoute,
    effect: 'compute',
    callers: ['human'],
    scopes: ['sessions:run'],
    transport: 'rpc',
    approval: 'never',
    auditProjection: (input) => {
      const source =
        input && typeof input === 'object' && !Array.isArray(input)
          ? (input as Record<string, unknown>)
          : {}
      const selected = selectAuditFields(input, ['agentId', 'providerId', 'modelId', 'maxTurns'])
      return {
        ...selected,
        promptCharacters: typeof source.prompt === 'string' ? source.prompt.length : 0,
        systemPromptPresent: typeof source.systemPrompt === 'string'
      }
    },
    // Covers worst-case JSON escaping for both bounded prompt fields and all option lists.
    limits: { maxBodyBytes: 5 * 1024 * 1024, timeoutMs: 5 * 60_000 }
  },
  {
    contract: runsGetRoute,
    effect: 'read',
    callers: ['human', 'agent'],
    scopes: ['runs:read'],
    transport: 'rpc',
    approval: 'never',
    auditProjection: (input) => selectAuditFields(input, ['runId', 'limit']),
    limits: RUN_CONTROL_LIMITS
  },
  {
    contract: runsCancelRoute,
    effect: 'local-maintenance',
    callers: ['human', 'agent'],
    scopes: ['runs:cancel'],
    transport: 'rpc',
    approval: 'never',
    agentPolicy: 'allow',
    auditProjection: (input) => selectAuditFields(input, ['runId']),
    limits: RUN_CONTROL_LIMITS
  },
  {
    contract: eventsSubscribeRoute,
    effect: 'read',
    callers: ['human'],
    scopes: ['runs:read'],
    transport: 'stream',
    approval: 'never',
    auditProjection: (input) => ({
      ...selectAuditFields(input, ['runId', 'messageLimit']),
      cursorPresent:
        Boolean(input) &&
        typeof input === 'object' &&
        !Array.isArray(input) &&
        typeof (input as Record<string, unknown>).cursor === 'string'
    }),
    limits: {
      maxBodyBytes: 16 * 1024,
      timeoutMs: LOCAL_CONTROL_MAX_REQUEST_TIMEOUT_MS
    }
  },
  {
    contract: providersListPublicRoute,
    effect: 'read',
    callers: ['human', 'agent'],
    scopes: ['providers:read'],
    transport: 'rpc',
    approval: 'never',
    limits: DIAGNOSTIC_LIMITS
  },
  {
    contract: providersTestPublicConnectionRoute,
    effect: 'compute',
    callers: ['human'],
    scopes: ['providers:read'],
    transport: 'rpc',
    approval: 'never',
    auditProjection: (input) => selectAuditFields(input, ['providerId', 'modelId']),
    limits: { maxBodyBytes: 16 * 1024, timeoutMs: LOCAL_CONTROL_MAX_REQUEST_TIMEOUT_MS }
  },
  {
    contract: providersAddPublicRoute,
    effect: 'execution-config',
    callers: ['human'],
    scopes: ['providers:write'],
    transport: 'rpc',
    approval: 'policy',
    auditProjection: (input) => selectAuditFields(input, ['name', 'apiType', 'enabled']),
    approvalDisplay: (input) => selectAuditFields(input, ['name', 'apiType', 'baseUrl', 'enabled']),
    limits: APPROVED_MUTATION_LIMITS
  },
  {
    contract: providersUpdatePublicRoute,
    effect: 'execution-config',
    callers: ['human'],
    scopes: ['providers:write'],
    transport: 'rpc',
    approval: 'policy',
    auditProjection: (input) => ({
      ...selectAuditFields(input, ['providerId']),
      fields: objectFieldKeys(input, 'updates')
    }),
    approvalDisplay: (input) => ({
      ...selectAuditFields(input, ['providerId']),
      updates: jsonObjectField(input, 'updates')
    }),
    limits: APPROVED_MUTATION_LIMITS
  },
  {
    contract: providersSetCredentialRoute,
    effect: 'credential',
    callers: ['human'],
    scopes: ['providers:credential'],
    transport: 'rpc',
    approval: 'policy',
    auditProjection: (input) => selectAuditFields(input, ['providerId', 'action', 'kind']),
    approvalDisplay: (input) => selectAuditFields(input, ['providerId', 'action', 'kind']),
    limits: { maxBodyBytes: 128 * 1024, timeoutMs: APPROVED_MUTATION_LIMITS.timeoutMs }
  },
  {
    contract: providersRemoveRoute,
    effect: 'destructive',
    callers: ['human'],
    scopes: ['providers:write'],
    transport: 'rpc',
    approval: 'policy',
    auditProjection: (input) => selectAuditFields(input, ['providerId']),
    approvalDisplay: (input) => selectAuditFields(input, ['providerId']),
    limits: APPROVED_MUTATION_LIMITS
  },
  {
    contract: modelsListRuntimeRoute,
    effect: 'read',
    callers: ['human', 'agent'],
    scopes: ['models:read'],
    transport: 'rpc',
    approval: 'never',
    auditProjection: (input) => selectAuditFields(input, ['providerId']),
    limits: { maxBodyBytes: 16 * 1024, timeoutMs: LOCAL_CONTROL_MAX_REQUEST_TIMEOUT_MS }
  },
  {
    contract: modelsGetPublicConfigRoute,
    effect: 'read',
    callers: ['human', 'agent'],
    scopes: ['models:read'],
    transport: 'rpc',
    approval: 'never',
    auditProjection: (input) => selectAuditFields(input, ['providerId', 'modelId']),
    limits: DIAGNOSTIC_LIMITS
  },
  {
    contract: modelsSetStatusRoute,
    effect: 'execution-config',
    callers: ['human'],
    scopes: ['providers:write'],
    transport: 'rpc',
    approval: 'policy',
    auditProjection: (input) => selectAuditFields(input, ['providerId', 'modelId', 'enabled']),
    approvalDisplay: (input) => selectAuditFields(input, ['providerId', 'modelId', 'enabled']),
    limits: APPROVED_MUTATION_LIMITS
  },
  {
    contract: modelsSetPublicConfigRoute,
    effect: 'execution-config',
    callers: ['human'],
    scopes: ['providers:write'],
    transport: 'rpc',
    approval: 'policy',
    auditProjection: (input) => ({
      ...selectAuditFields(input, ['providerId', 'modelId']),
      fields: objectFieldKeys(input, 'config')
    }),
    approvalDisplay: (input) => ({
      ...selectAuditFields(input, ['providerId', 'modelId']),
      config: jsonObjectField(input, 'config')
    }),
    limits: { maxBodyBytes: 64 * 1024, timeoutMs: APPROVED_MUTATION_LIMITS.timeoutMs }
  },
  {
    contract: modelsResetConfigRoute,
    effect: 'execution-config',
    callers: ['human'],
    scopes: ['providers:write'],
    transport: 'rpc',
    approval: 'policy',
    auditProjection: (input) => selectAuditFields(input, ['providerId', 'modelId']),
    approvalDisplay: (input) => selectAuditFields(input, ['providerId', 'modelId']),
    limits: APPROVED_MUTATION_LIMITS
  },
  {
    contract: settingsGetPublicRoute,
    effect: 'read',
    callers: ['human', 'agent'],
    scopes: ['settings:read'],
    transport: 'rpc',
    approval: 'never',
    auditProjection: (input) => ({ keys: stringArrayField(input, 'keys') }),
    limits: DIAGNOSTIC_LIMITS
  },
  {
    contract: settingsUpdatePublicRoute,
    effect: {
      possible: ['preference-write', 'execution-config', 'security-config'],
      resolve: (input) => {
        const keys = settingChangeKeys(input)
        if (keys.every((key) => PREFERENCE_SETTING_KEYS.has(key))) return 'preference-write'
        if (keys.every((key) => EXECUTION_SETTING_KEYS.has(key))) return 'execution-config'
        return 'security-config'
      }
    },
    callers: ['human', 'agent'],
    scopes: ['settings:write'],
    transport: 'rpc',
    approval: 'policy',
    agentPolicy: 'approval',
    auditProjection: (input) => ({ keys: settingChangeKeys(input) }),
    approvalDisplay: (input) => ({ changes: settingChangesForDisplay(input) }),
    agentInputAllowed: (input) =>
      settingChangeKeys(input).every((key) => PREFERENCE_SETTING_KEYS.has(key)),
    limits: APPROVED_MUTATION_LIMITS
  },
  {
    contract: skillsListPublicRoute,
    effect: 'read',
    callers: ['human', 'agent'],
    scopes: ['skills:read'],
    transport: 'rpc',
    approval: 'never',
    auditProjection: (input) => selectAuditFields(input, ['agentId']),
    limits: DIAGNOSTIC_LIMITS
  },
  {
    contract: skillsInstallPublicUrlRoute,
    effect: 'supply-chain',
    callers: ['human', 'agent'],
    scopes: ['skills:write'],
    transport: 'rpc',
    approval: 'policy',
    agentPolicy: 'approval',
    auditProjection: skillUrlDisplay,
    approvalDisplay: skillUrlDisplay,
    agentInputAllowed: agentSkillUrlInputAllowed,
    limits: { maxBodyBytes: 16 * 1024, timeoutMs: LOCAL_CONTROL_MAX_REQUEST_TIMEOUT_MS }
  },
  {
    contract: skillsInstallUploadRoute,
    effect: 'supply-chain',
    callers: ['human'],
    scopes: ['skills:write'],
    transport: 'upload',
    approval: 'policy',
    auditProjection: (input) => selectAuditFields(input, ['agentId', 'filename', 'overwrite']),
    approvalDisplay: (input) => selectAuditFields(input, ['agentId', 'filename', 'overwrite']),
    limits: {
      maxBodyBytes: SKILL_ARCHIVE_MAX_INPUT_BYTES,
      timeoutMs: LOCAL_CONTROL_MAX_REQUEST_TIMEOUT_MS
    }
  },
  {
    contract: skillsSetPublicStatusRoute,
    effect: 'execution-config',
    callers: ['human'],
    scopes: ['skills:write'],
    transport: 'rpc',
    approval: 'policy',
    auditProjection: (input) => selectAuditFields(input, ['agentId', 'name', 'enabled']),
    approvalDisplay: (input) => selectAuditFields(input, ['agentId', 'name', 'enabled']),
    limits: APPROVED_MUTATION_LIMITS
  },
  {
    contract: skillsUninstallPublicRoute,
    effect: 'destructive',
    callers: ['human'],
    scopes: ['skills:write'],
    transport: 'rpc',
    approval: 'policy',
    auditProjection: (input) => selectAuditFields(input, ['agentId', 'name']),
    approvalDisplay: (input) => selectAuditFields(input, ['agentId', 'name']),
    limits: APPROVED_MUTATION_LIMITS
  },
  {
    contract: mcpListPublicRoute,
    effect: 'read',
    callers: ['human', 'agent'],
    scopes: ['mcp:read'],
    transport: 'rpc',
    approval: 'never',
    auditProjection: () => ({}),
    limits: DIAGNOSTIC_LIMITS
  },
  {
    contract: mcpAddPublicRoute,
    effect: {
      possible: ['security-config', 'supply-chain', 'credential'],
      resolve: (input) => {
        const config = jsonObjectField(input, 'config')
        const environment = config.environment
        const headers = config.headers
        if (
          (environment && typeof environment === 'object' && Object.keys(environment).length > 0) ||
          (headers && typeof headers === 'object' && Object.keys(headers).length > 0)
        ) {
          return 'credential'
        }
        return config.authorization !== undefined ? 'security-config' : 'supply-chain'
      }
    },
    callers: ['human', 'agent'],
    scopes: ['mcp:write'],
    transport: 'rpc',
    approval: 'policy',
    agentPolicy: 'approval',
    auditProjection: (input) => mcpConfigAudit(input, 'config'),
    approvalDisplay: (input, caller) =>
      mcpConfigProjection(input, 'config', caller.principal === 'agent'),
    agentInputAllowed: agentMcpAddInputAllowed,
    limits: {
      maxBodyBytes: PUBLIC_MCP_CONFIG_MAX_BYTES + 64 * 1024,
      timeoutMs: 5 * 60_000
    }
  },
  {
    contract: mcpUpdatePublicRoute,
    effect: {
      possible: ['execution-config', 'security-config', 'supply-chain', 'credential'],
      resolve: (input) => {
        const fields = new Set(objectFieldKeys(input, 'updates'))
        if (fields.has('environment') || fields.has('headers')) return 'credential'
        if (
          ['command', 'args', 'type', 'baseUrl', 'customNpmRegistry'].some((field) =>
            fields.has(field)
          )
        ) {
          return 'supply-chain'
        }
        if (fields.has('authorization') || fields.has('inheritEnv')) return 'security-config'
        return 'execution-config'
      }
    },
    callers: ['human'],
    scopes: ['mcp:write'],
    transport: 'rpc',
    approval: 'policy',
    auditProjection: (input) => mcpConfigAudit(input, 'updates'),
    approvalDisplay: (input) => mcpConfigProjection(input, 'updates'),
    limits: {
      maxBodyBytes: PUBLIC_MCP_CONFIG_MAX_BYTES + 64 * 1024,
      timeoutMs: 5 * 60_000
    }
  },
  {
    contract: mcpRemovePublicRoute,
    effect: 'destructive',
    callers: ['human'],
    scopes: ['mcp:write'],
    transport: 'rpc',
    approval: 'policy',
    auditProjection: (input) => selectAuditFields(input, ['serverName']),
    approvalDisplay: (input) => selectAuditFields(input, ['serverName']),
    limits: APPROVED_MUTATION_LIMITS
  },
  {
    contract: mcpSetPublicStatusRoute,
    effect: 'execution-config',
    callers: ['human'],
    scopes: ['mcp:write'],
    transport: 'rpc',
    approval: 'policy',
    auditProjection: (input) => selectAuditFields(input, ['serverName', 'enabled']),
    approvalDisplay: (input) => selectAuditFields(input, ['serverName', 'enabled']),
    limits: APPROVED_MUTATION_LIMITS
  },
  {
    contract: mcpStartPublicRoute,
    effect: 'execution-config',
    callers: ['human'],
    scopes: ['mcp:write'],
    transport: 'rpc',
    approval: 'policy',
    auditProjection: (input) => selectAuditFields(input, ['serverName']),
    approvalDisplay: (input) => selectAuditFields(input, ['serverName']),
    limits: APPROVED_MUTATION_LIMITS
  },
  {
    contract: mcpStopPublicRoute,
    effect: 'execution-config',
    callers: ['human'],
    scopes: ['mcp:write'],
    transport: 'rpc',
    approval: 'policy',
    auditProjection: (input) => selectAuditFields(input, ['serverName']),
    approvalDisplay: (input) => selectAuditFields(input, ['serverName']),
    limits: APPROVED_MUTATION_LIMITS
  },
  {
    contract: artifactsDescribeRoute,
    effect: 'read',
    callers: ['human', 'agent'],
    scopes: ['artifacts:read'],
    transport: 'rpc',
    approval: 'never',
    auditProjection: (input) => selectAuditFields(input, ['id']),
    limits: DIAGNOSTIC_LIMITS
  },
  {
    contract: artifactsReadRoute,
    effect: 'read',
    callers: ['human'],
    scopes: ['artifacts:read'],
    transport: 'download',
    approval: 'never',
    auditProjection: (input) => selectAuditFields(input, ['id']),
    limits: { maxBodyBytes: 1, timeoutMs: 5 * 60_000 }
  },
  {
    contract: artifactsDeleteRoute,
    effect: 'local-maintenance',
    callers: ['human'],
    scopes: ['artifacts:manage'],
    transport: 'rpc',
    approval: 'never',
    auditProjection: (input) => selectAuditFields(input, ['id']),
    limits: DIAGNOSTIC_LIMITS
  },
  diagnosticEntry(cliStatusRoute),
  diagnosticEntry(cliVersionRoute),
  diagnosticEntry(cliCapabilitiesRoute),
  diagnosticEntry(cliDoctorRoute)
] as const

const PROGRAMMATIC_TOOL_LIMITS = Object.freeze({
  maxBodyBytes: PROGRAMMATIC_TOOL_RPC_MAX_BODY_BYTES,
  timeoutMs: PROGRAMMATIC_TOOL_RPC_TIMEOUT_MS
})

const CLI_SURFACE_V3_PROGRAMMATIC_ENTRIES = [
  {
    contract: toolSearchRoute,
    effect: 'read',
    callers: ['agent'],
    scopes: [],
    transport: 'rpc',
    approval: 'never',
    programmaticOnly: true,
    limits: PROGRAMMATIC_TOOL_LIMITS
  },
  {
    contract: toolDescribeRoute,
    effect: 'read',
    callers: ['agent'],
    scopes: [],
    transport: 'rpc',
    approval: 'never',
    programmaticOnly: true,
    limits: PROGRAMMATIC_TOOL_LIMITS
  },
  {
    contract: toolCallRoute,
    effect: 'compute',
    callers: ['agent'],
    scopes: [],
    transport: 'rpc',
    approval: 'never',
    programmaticOnly: true,
    limits: PROGRAMMATIC_TOOL_LIMITS
  },
  {
    contract: toolBatchRoute,
    effect: 'compute',
    callers: ['agent'],
    scopes: [],
    transport: 'rpc',
    approval: 'never',
    programmaticOnly: true,
    limits: PROGRAMMATIC_TOOL_LIMITS
  }
] as const satisfies readonly CliSurfaceEntry[]

function createSurfaceRegistry(
  entries: readonly CliSurfaceEntry[]
): ReadonlyMap<string, CliSurfaceEntry> {
  const registry = new Map<string, CliSurfaceEntry>()
  for (const entry of entries) {
    if (registry.has(entry.contract.name)) {
      throw new Error(`Duplicate CLI surface method: ${entry.contract.name}`)
    }
    if (entry.agentPolicy && !entry.callers.includes('agent')) {
      throw new Error(`Invalid Agent policy surface: ${entry.contract.name}`)
    }
    if (
      entry.programmaticOnly &&
      (entry.callers.length !== 1 ||
        entry.callers[0] !== 'agent' ||
        entry.scopes.length !== 0 ||
        entry.transport !== 'rpc' ||
        entry.approval !== 'never' ||
        entry.agentPolicy !== undefined)
    ) {
      throw new Error(`Invalid Programmatic Tool surface: ${entry.contract.name}`)
    }
    const effects = listCliSurfaceEffects(entry)
    if (entry.agentPolicy === 'allow' && effects.some((effect) => effect !== 'local-maintenance')) {
      throw new Error(`Invalid Agent allow surface: ${entry.contract.name}`)
    }
    if (
      entry.agentPolicy === 'approval' &&
      (entry.approval !== 'policy' ||
        entry.approvalDisplay === undefined ||
        !effects.some(
          (effect) =>
            effect === 'preference-write' ||
            effect === 'security-config' ||
            effect === 'supply-chain'
        ))
    ) {
      throw new Error(`Invalid Agent approval surface: ${entry.contract.name}`)
    }
    registry.set(entry.contract.name, entry)
  }
  return registry
}

export const CLI_SURFACE_V2 = createSurfaceRegistry(CLI_SURFACE_V2_ENTRIES)
export const CLI_SURFACE_V3 = createSurfaceRegistry([
  ...CLI_SURFACE_V2_ENTRIES,
  ...CLI_SURFACE_V3_PROGRAMMATIC_ENTRIES
])

export function getCliSurfaceRegistry(
  surfaceVersion: LocalControlRouteSurfaceVersion
): ReadonlyMap<string, CliSurfaceEntry> {
  if (surfaceVersion === LOCAL_CONTROL_PUBLIC_ROUTE_SURFACE_VERSION) return CLI_SURFACE_V2
  if (surfaceVersion === LOCAL_CONTROL_PROGRAMMATIC_ROUTE_SURFACE_VERSION) return CLI_SURFACE_V3
  throw new Error(`Unsupported CLI route surface version: ${String(surfaceVersion)}`)
}

export function getCliSurfaceEntry(
  method: string,
  surfaceVersion: LocalControlRouteSurfaceVersion = LOCAL_CONTROL_PUBLIC_ROUTE_SURFACE_VERSION
): CliSurfaceEntry | undefined {
  return getCliSurfaceRegistry(surfaceVersion).get(method)
}

export function listCliSurfaceCapabilities(
  surfaceVersion: LocalControlRouteSurfaceVersion = LOCAL_CONTROL_PUBLIC_ROUTE_SURFACE_VERSION
): CliCapability[] {
  return Array.from(getCliSurfaceRegistry(surfaceVersion).values(), (entry) => ({
    method: entry.contract.name,
    possibleEffects: [...listCliSurfaceEffects(entry)],
    callers: [...entry.callers],
    scopes: [...entry.scopes],
    transport: entry.transport,
    approval: entry.approval,
    maxBodyBytes: entry.limits.maxBodyBytes,
    timeoutMs: entry.limits.timeoutMs
  })).sort((left, right) => left.method.localeCompare(right.method))
}
