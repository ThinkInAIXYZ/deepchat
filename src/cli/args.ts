import { ArtifactIdSchema } from '@shared/contracts/routes/artifacts.routes'
import {
  AUDIO_TRANSCRIPTION_MAX_INPUT_BYTES,
  audioTranscribeArtifactRoute,
  audioTranscribeUploadRoute
} from '@shared/contracts/routes/audio.routes'
import {
  OCR_EXTRACTION_MAX_INPUT_BYTES,
  ocrExtractArtifactRoute,
  ocrExtractUploadRoute
} from '@shared/contracts/routes/ocr.routes'
import {
  skillsInstallPublicUrlRoute,
  skillsInstallUploadRoute
} from '@shared/contracts/routes/skills.routes'
import {
  RUN_MAX_MESSAGE_PAGE_SIZE,
  RunEventCursorSchema,
  RunIdSchema
} from '@shared/contracts/routes/runs.routes'
import { MessagePageCursorSchema } from '@shared/contracts/common'
import {
  cliCommandKey,
  getCliCommandDefinition,
  type CliRpcContract
} from '@shared/contracts/cliCommands'
import { JsonValueSchema, type JsonValue } from '@shared/contracts/json'
import { LOCAL_CONTROL_MAX_REQUEST_TIMEOUT_MS } from '@shared/contracts/localControl'
import {
  ATTACHMENT_PDF_OCR_MAX_TOKENS,
  PDF_PAGE_COUNT_SANITY_LIMIT
} from '@shared/types/attachment'
import { SKILL_ARCHIVE_MAX_INPUT_BYTES } from '@shared/types/skill'
import path from 'node:path'
import { CliUsageError } from './errors'

export const CLI_OUTPUT_ENV = 'DEEPCHAT_CLI_OUTPUT'
export const CLI_TIMEOUT_ENV = 'DEEPCHAT_CLI_TIMEOUT_MS'
export const DEFAULT_CLI_TIMEOUT_MS = 30_000
export const MAX_CLI_TIMEOUT_MS = LOCAL_CONTROL_MAX_REQUEST_TIMEOUT_MS
export const DEFAULT_COMPUTE_TIMEOUT_MS = MAX_CLI_TIMEOUT_MS
export const DEFAULT_MUTATION_TIMEOUT_MS = 10 * 60_000

export type CliOutputMode = 'text' | 'json' | 'jsonl'
export type { CliRpcContract } from '@shared/contracts/cliCommands'

export type CliCommandOperation = 'rpc' | 'stream' | 'upload' | 'download'

export type ParsedCliArguments = Readonly<{
  domain: string
  verb: string
  contract: CliRpcContract | null
  outputMode: CliOutputMode
  timeoutMs: number
  helpRequested: boolean
  operation: CliCommandOperation
  params: JsonValue
  inputPath?: string
  uploadMaxBytes?: number
  outputPath?: string
  overwrite: boolean
  readStdin: boolean
}>

function parseBoolean(value: string, source: string): boolean {
  if (value === 'true') return true
  if (value === 'false') return false
  throw new CliUsageError(`${source} must be true or false`)
}

function parseNumberInRange(
  value: string,
  source: string,
  minimum: number,
  maximum: number,
  integer = false
): number {
  const parsed = Number(value)
  if (
    !Number.isFinite(parsed) ||
    (integer && !Number.isSafeInteger(parsed)) ||
    parsed < minimum ||
    parsed > maximum
  ) {
    const qualifier = integer ? 'an integer' : 'a number'
    throw new CliUsageError(`${source} must be ${qualifier} between ${minimum} and ${maximum}`)
  }
  return parsed
}

type DomainOptionValue = JsonValue
type DomainValueParser = (value: string) => DomainOptionValue

const stringOption: DomainValueParser = (value) => value
const settingValueOption: DomainValueParser = (value) => {
  const candidate =
    value === 'true' ||
    value === 'false' ||
    value === 'null' ||
    /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/.test(value) ||
    value.startsWith('"')
      ? (() => {
          try {
            return JSON.parse(value) as unknown
          } catch {
            throw new CliUsageError('--value contains invalid JSON')
          }
        })()
      : value
  const parsed = JsonValueSchema.safeParse(candidate)
  if (!parsed.success) throw new CliUsageError('--value must be a JSON scalar')
  if (parsed.data !== null && typeof parsed.data === 'object') {
    throw new CliUsageError('--value must be a JSON scalar')
  }
  return parsed.data
}
const VALUE_DOMAIN_OPTIONS: Readonly<Record<string, DomainValueParser>> = {
  id: (value) => {
    const parsed = ArtifactIdSchema.safeParse(value)
    if (!parsed.success) throw new CliUsageError('--id is not a valid artifact identifier')
    return parsed.data
  },
  out: stringOption,
  file: stringOption,
  artifact: (value) => {
    const parsed = ArtifactIdSchema.safeParse(value)
    if (!parsed.success) throw new CliUsageError('--artifact is not a valid artifact identifier')
    return parsed.data
  },
  run: (value) => {
    const parsed = RunIdSchema.safeParse(value)
    if (!parsed.success) throw new CliUsageError('--run is not a valid run identifier')
    return parsed.data
  },
  cursor: (value) => {
    if (value.length > 4_096) throw new CliUsageError('--cursor exceeds its character limit')
    return value
  },
  mime: (value) => {
    const normalized = value.trim().toLowerCase()
    if (!normalized) throw new CliUsageError('--mime must not be empty')
    return normalized
  },
  provider: stringOption,
  model: stringOption,
  prompt: stringOption,
  text: stringOption,
  system: stringOption,
  title: stringOption,
  'project-dir': stringOption,
  skills: stringOption,
  'disable-tools': stringOption,
  'max-turns': (value) => parseNumberInRange(value, '--max-turns', 1, 100, true),
  limit: (value) => parseNumberInRange(value, '--limit', 1, RUN_MAX_MESSAGE_PAGE_SIZE, true),
  temperature: (value) => parseNumberInRange(value, '--temperature', 0, 2),
  'max-tokens': (value) => parseNumberInRange(value, '--max-tokens', 1, 1_000_000, true),
  size: stringOption,
  quality: stringOption,
  format: stringOption,
  compression: (value) => parseNumberInRange(value, '--compression', 0, 100, true),
  background: stringOption,
  moderation: stringOption,
  seconds: stringOption,
  ratio: stringOption,
  duration: (value) => parseNumberInRange(value, '--duration', -1, 3_600, true),
  resolution: stringOption,
  watermark: (value) => parseBoolean(value, '--watermark'),
  audio: (value) => parseBoolean(value, '--audio'),
  voice: stringOption,
  speed: (value) => parseNumberInRange(value, '--speed', 0.25, 4),
  instructions: stringOption,
  agent: stringOption,
  url: stringOption,
  name: stringOption,
  'api-type': stringOption,
  'base-url': stringOption,
  enabled: (value) => parseBoolean(value, '--enabled'),
  key: stringOption,
  keys: stringOption,
  value: settingValueOption,
  backend: stringOption,
  'page-count': (value) =>
    parseNumberInRange(value, '--page-count', 1, PDF_PAGE_COUNT_SANITY_LIMIT, true)
}

const FLAG_DOMAIN_OPTIONS = new Set(['overwrite', 'stdin', 'enabled-only'])
const COMMAND_DOMAIN_OPTIONS = new Map<string, ReadonlySet<string>>([
  ['artifact describe', new Set(['id'])],
  ['artifact get', new Set(['id', 'out', 'overwrite'])],
  ['artifact delete', new Set(['id'])],
  [
    'model invoke',
    new Set(['provider', 'model', 'prompt', 'system', 'temperature', 'max-tokens', 'stdin'])
  ],
  [
    'image generate',
    new Set([
      'provider',
      'model',
      'prompt',
      'stdin',
      'size',
      'quality',
      'format',
      'compression',
      'background',
      'moderation'
    ])
  ],
  [
    'video generate',
    new Set([
      'provider',
      'model',
      'prompt',
      'stdin',
      'seconds',
      'size',
      'ratio',
      'duration',
      'resolution',
      'watermark',
      'audio'
    ])
  ],
  [
    'audio speak',
    new Set(['provider', 'model', 'text', 'stdin', 'voice', 'format', 'speed', 'instructions'])
  ],
  ['audio transcribe', new Set(['provider', 'model', 'file', 'artifact', 'mime'])],
  ['ocr extract', new Set(['file', 'artifact', 'mime', 'backend', 'page-count', 'max-tokens'])],
  ['ocr status', new Set()],
  ['ocr clear-cache', new Set()],
  ['provider list', new Set(['enabled-only'])],
  ['provider test', new Set(['provider', 'model'])],
  ['provider add', new Set(['name', 'api-type', 'base-url', 'enabled'])],
  ['provider update', new Set(['provider', 'name', 'api-type', 'base-url', 'enabled'])],
  ['provider set-credential', new Set(['provider', 'stdin'])],
  ['provider clear-credential', new Set(['provider'])],
  ['provider remove', new Set(['provider'])],
  ['model list', new Set(['provider'])],
  ['model config-get', new Set(['provider', 'model'])],
  ['model enable', new Set(['provider', 'model'])],
  ['model disable', new Set(['provider', 'model'])],
  ['model config-set', new Set(['provider', 'model', 'stdin'])],
  ['model config-reset', new Set(['provider', 'model'])],
  ['settings get', new Set(['keys'])],
  ['settings set', new Set(['key', 'value'])],
  ['skill list', new Set(['agent'])],
  ['skill install', new Set(['agent', 'file', 'url', 'overwrite'])],
  ['skill enable', new Set(['agent', 'name'])],
  ['skill disable', new Set(['agent', 'name'])],
  ['skill remove', new Set(['agent', 'name'])],
  ['mcp list', new Set()],
  ['mcp add', new Set(['name', 'stdin'])],
  ['mcp update', new Set(['name', 'stdin'])],
  ['mcp enable', new Set(['name'])],
  ['mcp disable', new Set(['name'])],
  ['mcp start', new Set(['name'])],
  ['mcp stop', new Set(['name'])],
  ['mcp remove', new Set(['name'])],
  [
    'agent run',
    new Set([
      'prompt',
      'stdin',
      'agent',
      'provider',
      'model',
      'system',
      'title',
      'project-dir',
      'skills',
      'disable-tools',
      'max-turns'
    ])
  ],
  ['run get', new Set(['run', 'cursor', 'limit'])],
  ['run watch', new Set(['run', 'cursor', 'limit'])],
  ['run cancel', new Set(['run'])]
])

const AUDIO_MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  '.aac': 'audio/aac',
  '.amr': 'audio/amr',
  '.flac': 'audio/flac',
  '.m4a': 'audio/mp4',
  '.mp3': 'audio/mpeg',
  '.mp4': 'audio/mp4',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.wav': 'audio/wav',
  '.webm': 'audio/webm'
}

const OCR_MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  '.bmp': 'image/bmp',
  '.gif': 'image/gif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.webp': 'image/webp'
}

function resolveInputMimeType(
  filePath: string,
  explicitMimeType: string | undefined,
  mimeTypesByExtension: Readonly<Record<string, string>>
): string {
  if (explicitMimeType) return explicitMimeType
  const inferred = mimeTypesByExtension[path.extname(filePath).toLowerCase()]
  if (!inferred) {
    throw new CliUsageError('Cannot infer input MIME type; provide --mime <type>')
  }
  return inferred
}

function parseOutputMode(value: string | undefined): CliOutputMode {
  if (value === undefined || value.trim() === '') return 'text'
  const normalized = value.trim().toLowerCase()
  if (normalized === 'text' || normalized === 'json' || normalized === 'jsonl') return normalized
  throw new CliUsageError(`${CLI_OUTPUT_ENV} must be text, json, or jsonl`)
}

export function inferCliOutputMode(
  argv: readonly string[],
  env: NodeJS.ProcessEnv = process.env
): CliOutputMode {
  if (!argv[0] || !argv[1] || argv[0].startsWith('-') || argv[1].startsWith('-')) return 'text'
  const explicit = argv.slice(2).find((argument) => argument === '--json' || argument === '--jsonl')
  if (explicit) return explicit.slice(2) as CliOutputMode
  try {
    return parseOutputMode(env[CLI_OUTPUT_ENV])
  } catch {
    return 'text'
  }
}

function parseTimeout(value: string, source: string): number {
  if (!/^[1-9][0-9]*$/.test(value)) {
    throw new CliUsageError(`${source} must be a positive integer in milliseconds`)
  }
  const timeoutMs = Number(value)
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs > MAX_CLI_TIMEOUT_MS) {
    throw new CliUsageError(`${source} must not exceed ${MAX_CLI_TIMEOUT_MS}`)
  }
  return timeoutMs
}

function parseIdentifierList(value: string, source: string): string[] {
  const items = value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
  if (items.length === 0) throw new CliUsageError(`${source} must contain at least one identifier`)
  if (items.length > 128) throw new CliUsageError(`${source} accepts at most 128 identifiers`)
  if (new Set(items).size !== items.length) {
    throw new CliUsageError(`${source} must not contain duplicate identifiers`)
  }
  return items
}

function parseMessagePageCursor(value: string): JsonValue {
  let candidate: unknown
  try {
    candidate = JSON.parse(value) as unknown
  } catch {
    throw new CliUsageError('--cursor must be a JSON message cursor')
  }
  const parsed = MessagePageCursorSchema.safeParse(candidate)
  if (!parsed.success) throw new CliUsageError('--cursor must be a JSON message cursor')
  return parsed.data
}

export function parseCliArguments(
  argv: readonly string[],
  env: NodeJS.ProcessEnv = process.env
): ParsedCliArguments {
  if (argv[0] === 'help') {
    if (argv.length !== 1) throw new CliUsageError('Expected: deepchat help')
    return {
      domain: 'help',
      verb: '',
      contract: null,
      outputMode: parseOutputMode(env[CLI_OUTPUT_ENV]),
      timeoutMs: DEFAULT_CLI_TIMEOUT_MS,
      helpRequested: true,
      operation: 'rpc',
      params: {},
      overwrite: false,
      readStdin: false
    }
  }

  const domain = argv[0]
  const verb = argv[1]
  if (!domain || !verb || domain.startsWith('-') || verb.startsWith('-')) {
    throw new CliUsageError('Expected: deepchat <domain> <verb> [options]')
  }

  const commandKey = cliCommandKey(domain, verb)
  const commandDefinition = getCliCommandDefinition(domain, verb)
  let contract = commandDefinition?.contract ?? null
  if (!contract) {
    throw new CliUsageError(`Unknown command: deepchat ${domain} ${verb}`)
  }

  let outputMode = parseOutputMode(env[CLI_OUTPUT_ENV])
  let explicitOutputMode: CliOutputMode | undefined
  let timeoutMs = env[CLI_TIMEOUT_ENV]
    ? parseTimeout(env[CLI_TIMEOUT_ENV], CLI_TIMEOUT_ENV)
    : commandDefinition?.timeoutClass === 'long-running'
      ? DEFAULT_COMPUTE_TIMEOUT_MS
      : commandDefinition?.timeoutClass === 'approved-mutation'
        ? DEFAULT_MUTATION_TIMEOUT_MS
        : DEFAULT_CLI_TIMEOUT_MS
  let timeoutSeen = false
  let helpRequested = false
  const domainOptions = new Set<string>()
  const domainValues = new Map<string, DomainOptionValue>()

  const readOptionValue = (
    argument: string,
    index: number
  ): { value: string; nextIndex: number } => {
    const equalsIndex = argument.indexOf('=')
    if (equalsIndex >= 0) {
      const value = argument.slice(equalsIndex + 1)
      if (!value) throw new CliUsageError(`Missing value for ${argument.slice(0, equalsIndex)}`)
      return { value, nextIndex: index }
    }
    const value = argv[index + 1]
    if (!value || value.startsWith('--')) {
      throw new CliUsageError(`Missing value for ${argument}`)
    }
    return { value, nextIndex: index + 1 }
  }

  for (let index = 2; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--json' || argument === '--jsonl') {
      const nextMode = argument.slice(2) as CliOutputMode
      if (explicitOutputMode && explicitOutputMode !== nextMode) {
        throw new CliUsageError('--json and --jsonl are mutually exclusive')
      }
      explicitOutputMode = nextMode
      outputMode = nextMode
      continue
    }
    if (argument === '--help') {
      if (helpRequested) throw new CliUsageError('--help may be specified only once')
      helpRequested = true
      continue
    }
    if (argument === '--timeout') {
      if (timeoutSeen) throw new CliUsageError('--timeout may be specified only once')
      const value = argv[index + 1]
      if (!value || value.startsWith('--')) {
        throw new CliUsageError('Missing value for --timeout')
      }
      timeoutMs = parseTimeout(value, '--timeout')
      timeoutSeen = true
      index += 1
      continue
    }
    if (argument.startsWith('--timeout=')) {
      if (timeoutSeen) throw new CliUsageError('--timeout may be specified only once')
      timeoutMs = parseTimeout(argument.slice('--timeout='.length), '--timeout')
      timeoutSeen = true
      continue
    }
    if (argument.startsWith('--')) {
      const equalsIndex = argument.indexOf('=')
      const optionName = argument.slice(2, equalsIndex >= 0 ? equalsIndex : undefined)
      if (FLAG_DOMAIN_OPTIONS.has(optionName) && equalsIndex < 0) {
        if (domainOptions.has(optionName)) {
          throw new CliUsageError(`--${optionName} may be specified only once`)
        }
        domainOptions.add(optionName)
        domainValues.set(optionName, true)
        continue
      }
      const parseValue = VALUE_DOMAIN_OPTIONS[optionName]
      if (parseValue) {
        if (domainOptions.has(optionName)) {
          throw new CliUsageError(`--${optionName} may be specified only once`)
        }
        const parsedOption = readOptionValue(argument, index)
        domainOptions.add(optionName)
        domainValues.set(optionName, parseValue(parsedOption.value))
        index = parsedOption.nextIndex
        continue
      }
    }
    throw new CliUsageError(`Unknown option after ${domain} ${verb}: ${argument}`)
  }

  const getString = (name: string): string | undefined => {
    const value = domainValues.get(name)
    return typeof value === 'string' ? value : undefined
  }
  const getNumber = (name: string): number | undefined => {
    const value = domainValues.get(name)
    return typeof value === 'number' ? value : undefined
  }
  const getBoolean = (name: string): boolean | undefined => {
    const value = domainValues.get(name)
    return typeof value === 'boolean' ? value : undefined
  }
  const artifactId = getString('id')
  const inputArtifactId = getString('artifact')
  const inputPath = getString('file')
  const mimeType = getString('mime')
  const outputPath = getString('out')
  const overwrite = getBoolean('overwrite') ?? false
  const providerId = getString('provider')
  const modelId = getString('model')
  const prompt = getString('prompt')
  const textInput = getString('text')
  const systemPrompt = getString('system')
  const runId = getString('run')
  const cursorValue = getString('cursor')
  const title = getString('title')
  const projectDir = getString('project-dir')
  const skillsValue = getString('skills')
  const disabledToolsValue = getString('disable-tools')
  const maxTurns = getNumber('max-turns')
  const messageLimit = getNumber('limit')
  const temperature = getNumber('temperature')
  const maxTokens = getNumber('max-tokens')
  const readStdin = getBoolean('stdin') ?? false
  const enabledOnly = getBoolean('enabled-only') ?? false
  const size = getString('size')
  const quality = getString('quality')
  const format = getString('format')
  const compression = getNumber('compression')
  const background = getString('background')
  const moderation = getString('moderation')
  const seconds = getString('seconds')
  const ratio = getString('ratio')
  const duration = getNumber('duration')
  const resolution = getString('resolution')
  const watermark = getBoolean('watermark')
  const generateAudio = getBoolean('audio')
  const voice = getString('voice')
  const speed = getNumber('speed')
  const instructions = getString('instructions')
  const backend = getString('backend')
  const sourcePageCountHint = getNumber('page-count')
  const settingKey = getString('key')
  const settingKeys = getString('keys')
  const settingValue = domainValues.get('value')
  const providerName = getString('name')
  const providerApiType = getString('api-type')
  const providerBaseUrl = getString('base-url')
  const providerEnabled = getBoolean('enabled')
  const agentId = getString('agent')
  const skillUrl = getString('url')
  const skillName = getString('name')
  const mcpServerName = getString('name')
  const parsedSettingKeys = settingKeys
    ?.split(',')
    .map((key) => key.trim())
    .filter(Boolean)

  const isArtifactCommand = domain === 'artifact'
  const isSkillInstall = commandKey === 'skill install'
  if (!helpRequested && isArtifactCommand && !artifactId) {
    throw new CliUsageError(`deepchat ${domain} ${verb} requires --id <artifact-id>`)
  }
  if (!helpRequested && commandKey === 'artifact get' && !outputPath) {
    throw new CliUsageError('deepchat artifact get requires --out <path>')
  }
  if (!isArtifactCommand && (artifactId !== undefined || outputPath !== undefined)) {
    throw new CliUsageError(`Artifact options are not valid for deepchat ${domain} ${verb}`)
  }
  if (overwrite && commandKey !== 'artifact get' && !isSkillInstall) {
    throw new CliUsageError(`--overwrite is not valid for deepchat ${domain} ${verb}`)
  }
  if (
    isArtifactCommand &&
    commandKey !== 'artifact get' &&
    (outputPath !== undefined || overwrite)
  ) {
    throw new CliUsageError(`--out and --overwrite are only valid for deepchat artifact get`)
  }

  const isModelInvoke = commandKey === 'model invoke'
  const isImageGenerate = commandKey === 'image generate'
  const isVideoGenerate = commandKey === 'video generate'
  const isSpeechGenerate = commandKey === 'audio speak'
  const isAudioTranscribe = commandKey === 'audio transcribe'
  const isOcrExtract = commandKey === 'ocr extract'
  const isMediaGenerate = isImageGenerate || isVideoGenerate || isSpeechGenerate
  const isProviderList = commandKey === 'provider list'
  const isProviderTest = commandKey === 'provider test'
  const isProviderAdd = commandKey === 'provider add'
  const isProviderUpdate = commandKey === 'provider update'
  const isProviderSetCredential = commandKey === 'provider set-credential'
  const isProviderClearCredential = commandKey === 'provider clear-credential'
  const isProviderRemove = commandKey === 'provider remove'
  const isModelList = commandKey === 'model list'
  const isModelConfigGet = commandKey === 'model config-get'
  const isModelStatus = commandKey === 'model enable' || commandKey === 'model disable'
  const isModelConfigSet = commandKey === 'model config-set'
  const isModelConfigReset = commandKey === 'model config-reset'
  const isSettingsGet = commandKey === 'settings get'
  const isSettingsSet = commandKey === 'settings set'
  const isSkillList = commandKey === 'skill list'
  const isSkillStatus = commandKey === 'skill enable' || commandKey === 'skill disable'
  const isSkillRemove = commandKey === 'skill remove'
  const isMcpList = commandKey === 'mcp list'
  const isMcpAdd = commandKey === 'mcp add'
  const isMcpUpdate = commandKey === 'mcp update'
  const isMcpStatus = commandKey === 'mcp enable' || commandKey === 'mcp disable'
  const isMcpRuntime = commandKey === 'mcp start' || commandKey === 'mcp stop'
  const isMcpRemove = commandKey === 'mcp remove'
  const isAgentRun = commandKey === 'agent run'
  const isRunGet = commandKey === 'run get'
  const isRunWatch = commandKey === 'run watch'
  const isRunCancel = commandKey === 'run cancel'
  const allowedDomainOptions = COMMAND_DOMAIN_OPTIONS.get(commandKey) ?? new Set<string>()
  const invalidDomainOption = Array.from(domainOptions).find(
    (option) => !allowedDomainOptions.has(option)
  )
  if (invalidDomainOption) {
    throw new CliUsageError(`--${invalidDomainOption} is not valid for deepchat ${domain} ${verb}`)
  }
  if (!helpRequested && isModelInvoke && (!providerId || !modelId)) {
    throw new CliUsageError('deepchat model invoke requires --provider and --model')
  }
  if (!helpRequested && isModelInvoke && (prompt !== undefined) === readStdin) {
    throw new CliUsageError('deepchat model invoke requires exactly one of --prompt or --stdin')
  }
  if (!helpRequested && isAgentRun && (prompt !== undefined) === readStdin) {
    throw new CliUsageError('deepchat agent run requires exactly one of --prompt or --stdin')
  }
  if (!helpRequested && (isRunGet || isRunWatch || isRunCancel) && !runId) {
    throw new CliUsageError(`deepchat run ${verb} requires --run <run-id>`)
  }
  if (!helpRequested && isMediaGenerate && (!providerId || !modelId)) {
    throw new CliUsageError(`deepchat ${domain} ${verb} requires --provider and --model`)
  }
  if (
    !helpRequested &&
    (isImageGenerate || isVideoGenerate) &&
    (prompt !== undefined) === readStdin
  ) {
    throw new CliUsageError(
      `deepchat ${domain} ${verb} requires exactly one of --prompt or --stdin`
    )
  }
  if (!helpRequested && isSpeechGenerate && (textInput !== undefined) === readStdin) {
    throw new CliUsageError('deepchat audio speak requires exactly one of --text or --stdin')
  }
  if (!helpRequested && isAudioTranscribe && (!providerId || !modelId)) {
    throw new CliUsageError('deepchat audio transcribe requires --provider and --model')
  }
  if (
    !helpRequested &&
    (isAudioTranscribe || isOcrExtract) &&
    (inputPath !== undefined) === (inputArtifactId !== undefined)
  ) {
    throw new CliUsageError(
      `deepchat ${domain} ${verb} requires exactly one of --file or --artifact`
    )
  }
  if (!helpRequested && inputArtifactId && mimeType) {
    throw new CliUsageError('--mime is only valid together with --file')
  }
  if (backend !== undefined && backend !== 'auto' && backend !== 'cpu') {
    throw new CliUsageError('--backend must be auto or cpu')
  }
  if (isOcrExtract && maxTokens !== undefined && maxTokens > ATTACHMENT_PDF_OCR_MAX_TOKENS) {
    throw new CliUsageError(`--max-tokens must not exceed ${ATTACHMENT_PDF_OCR_MAX_TOKENS}`)
  }
  if (!helpRequested && isSettingsSet && (!settingKey || !domainOptions.has('value'))) {
    throw new CliUsageError('deepchat settings set requires --key and --value')
  }
  if (!helpRequested && isSettingsGet && settingKeys !== undefined && !parsedSettingKeys?.length) {
    throw new CliUsageError('--keys must contain at least one setting key')
  }
  if (!helpRequested && isProviderAdd && (!providerName || !providerApiType || !providerBaseUrl)) {
    throw new CliUsageError('deepchat provider add requires --name, --api-type, and --base-url')
  }
  if (
    !helpRequested &&
    isProviderUpdate &&
    (!providerId ||
      (providerName === undefined &&
        providerApiType === undefined &&
        providerBaseUrl === undefined &&
        providerEnabled === undefined))
  ) {
    throw new CliUsageError('deepchat provider update requires --provider and at least one update')
  }
  if (
    !helpRequested &&
    (isProviderTest ||
      isProviderSetCredential ||
      isProviderClearCredential ||
      isProviderRemove ||
      isModelList) &&
    !providerId
  ) {
    throw new CliUsageError(`deepchat ${domain} ${verb} requires --provider`)
  }
  if (!helpRequested && isProviderSetCredential && !readStdin) {
    throw new CliUsageError('deepchat provider set-credential requires --stdin')
  }
  if (
    !helpRequested &&
    (isModelConfigGet || isModelStatus || isModelConfigSet || isModelConfigReset) &&
    (!providerId || !modelId)
  ) {
    throw new CliUsageError(`deepchat model ${verb} requires --provider and --model`)
  }
  if (!helpRequested && isModelConfigSet && !readStdin) {
    throw new CliUsageError('deepchat model config-set requires --stdin')
  }
  if (!helpRequested && isSkillInstall && (inputPath !== undefined) === (skillUrl !== undefined)) {
    throw new CliUsageError('deepchat skill install requires exactly one of --file or --url')
  }
  if (!helpRequested && (isSkillStatus || isSkillRemove) && !skillName) {
    throw new CliUsageError(`deepchat skill ${verb} requires --name`)
  }
  if (
    !helpRequested &&
    (isMcpAdd || isMcpUpdate || isMcpStatus || isMcpRuntime || isMcpRemove) &&
    !mcpServerName
  ) {
    throw new CliUsageError(`deepchat mcp ${verb} requires --name`)
  }
  if (!helpRequested && (isMcpAdd || isMcpUpdate) && !readStdin) {
    throw new CliUsageError(`deepchat mcp ${verb} requires --stdin`)
  }

  const activeSkills = skillsValue ? parseIdentifierList(skillsValue, '--skills') : undefined
  const disabledAgentTools = disabledToolsValue
    ? parseIdentifierList(disabledToolsValue, '--disable-tools')
    : undefined
  const runCursor =
    cursorValue && isRunGet
      ? parseMessagePageCursor(cursorValue)
      : cursorValue && isRunWatch
        ? (() => {
            const parsed = RunEventCursorSchema.safeParse(cursorValue)
            if (!parsed.success) throw new CliUsageError('--cursor is not a valid event cursor')
            return parsed.data
          })()
        : undefined

  let params: JsonValue = artifactId ? { id: artifactId } : {}
  if (isProviderList) params = { enabledOnly }
  if (isProviderTest && providerId) {
    params = { providerId, ...(modelId ? { modelId } : {}) }
  }
  if (isProviderAdd && providerName && providerApiType && providerBaseUrl) {
    params = {
      name: providerName,
      apiType: providerApiType,
      baseUrl: providerBaseUrl,
      ...(providerEnabled !== undefined ? { enabled: providerEnabled } : {})
    }
  }
  if (isProviderUpdate && providerId) {
    params = {
      providerId,
      updates: {
        ...(providerName !== undefined ? { name: providerName } : {}),
        ...(providerApiType !== undefined ? { apiType: providerApiType } : {}),
        ...(providerBaseUrl !== undefined ? { baseUrl: providerBaseUrl } : {}),
        ...(providerEnabled !== undefined ? { enabled: providerEnabled } : {})
      }
    }
  }
  if (isProviderSetCredential && providerId) {
    params = { providerId, action: 'set', kind: 'api-key' }
  }
  if (isProviderClearCredential && providerId) {
    params = { providerId, action: 'clear', kind: 'api-key' }
  }
  if (isProviderRemove && providerId) params = { providerId }
  if (isModelList && providerId) params = { providerId }
  if (isModelConfigGet && providerId && modelId) params = { providerId, modelId }
  if (isModelStatus && providerId && modelId) {
    params = { providerId, modelId, enabled: commandKey === 'model enable' }
  }
  if (isModelConfigSet && providerId && modelId) params = { providerId, modelId }
  if (isModelConfigReset && providerId && modelId) params = { providerId, modelId }
  if (isSettingsGet) {
    params = parsedSettingKeys ? { keys: parsedSettingKeys } : {}
  }
  if (isSettingsSet && settingKey && domainOptions.has('value')) {
    params = { changes: [{ key: settingKey, value: settingValue ?? null }] }
  }
  if (isSkillList) params = agentId ? { agentId } : {}
  if (isSkillInstall) {
    if (inputPath) {
      contract = skillsInstallUploadRoute
      params = {
        ...(agentId ? { agentId } : {}),
        filename: path.basename(inputPath),
        overwrite
      }
    } else if (skillUrl) {
      contract = skillsInstallPublicUrlRoute
      params = {
        ...(agentId ? { agentId } : {}),
        url: skillUrl,
        overwrite
      }
    }
  }
  if (isSkillStatus && skillName) {
    params = {
      ...(agentId ? { agentId } : {}),
      name: skillName,
      enabled: commandKey === 'skill enable'
    }
  }
  if (isSkillRemove && skillName) {
    params = { ...(agentId ? { agentId } : {}), name: skillName }
  }
  if (isMcpList) params = {}
  if ((isMcpAdd || isMcpUpdate) && mcpServerName) params = { serverName: mcpServerName }
  if (isMcpStatus && mcpServerName) {
    params = { serverName: mcpServerName, enabled: commandKey === 'mcp enable' }
  }
  if ((isMcpRuntime || isMcpRemove) && mcpServerName) params = { serverName: mcpServerName }
  if (isAgentRun) {
    params = {
      ...(prompt !== undefined ? { prompt } : {}),
      ...(agentId ? { agentId } : {}),
      ...(title ? { title } : {}),
      ...(projectDir ? { projectDir } : {}),
      ...(providerId ? { providerId } : {}),
      ...(modelId ? { modelId } : {}),
      ...(systemPrompt !== undefined ? { systemPrompt } : {}),
      ...(activeSkills ? { activeSkills } : {}),
      ...(disabledAgentTools ? { disabledAgentTools } : {}),
      ...(maxTurns !== undefined ? { maxTurns } : {})
    }
  }
  if (isRunGet && runId) {
    params = {
      runId,
      ...(runCursor ? { cursor: runCursor } : {}),
      ...(messageLimit !== undefined ? { limit: messageLimit } : {})
    }
  }
  if (isRunWatch && runId) {
    params = {
      runId,
      ...(runCursor ? { cursor: runCursor } : {}),
      ...(messageLimit !== undefined ? { messageLimit } : {})
    }
  }
  if (isRunCancel && runId) params = { runId }
  if (isModelInvoke && providerId && modelId) {
    params = {
      providerId,
      modelId,
      messages: [
        ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
        ...(prompt !== undefined ? [{ role: 'user', content: prompt }] : [])
      ],
      ...(temperature !== undefined ? { temperature } : {}),
      ...(maxTokens !== undefined ? { maxTokens } : {})
    }
  }
  if (isImageGenerate && providerId && modelId) {
    const options = {
      ...(size !== undefined ? { size } : {}),
      ...(quality !== undefined ? { quality } : {}),
      ...(format !== undefined ? { outputFormat: format } : {}),
      ...(compression !== undefined ? { outputCompression: compression } : {}),
      ...(background !== undefined ? { background } : {}),
      ...(moderation !== undefined ? { moderation } : {})
    }
    params = {
      providerId,
      modelId,
      ...(prompt !== undefined ? { prompt } : {}),
      ...(Object.keys(options).length > 0 ? { options } : {})
    }
  }
  if (isVideoGenerate && providerId && modelId) {
    const options = {
      ...(seconds !== undefined ? { seconds } : {}),
      ...(size !== undefined ? { size } : {}),
      ...(ratio !== undefined ? { ratio } : {}),
      ...(duration !== undefined ? { duration } : {}),
      ...(resolution !== undefined ? { resolution } : {}),
      ...(watermark !== undefined ? { watermark } : {}),
      ...(generateAudio !== undefined ? { generateAudio } : {})
    }
    params = {
      providerId,
      modelId,
      ...(prompt !== undefined ? { prompt } : {}),
      ...(Object.keys(options).length > 0 ? { options } : {})
    }
  }
  if (isSpeechGenerate && providerId && modelId) {
    const options = {
      ...(voice !== undefined ? { voice } : {}),
      ...(format !== undefined ? { responseFormat: format } : {}),
      ...(speed !== undefined ? { speed } : {}),
      ...(instructions !== undefined ? { instructions } : {})
    }
    params = {
      providerId,
      modelId,
      ...(textInput !== undefined ? { text: textInput } : {}),
      ...(Object.keys(options).length > 0 ? { options } : {})
    }
  }
  if (isAudioTranscribe && providerId && modelId && (inputPath || inputArtifactId)) {
    if (inputPath) {
      contract = audioTranscribeUploadRoute
      params = {
        providerId,
        modelId,
        mimeType: resolveInputMimeType(inputPath, mimeType, AUDIO_MIME_BY_EXTENSION),
        filename: path.basename(inputPath)
      }
    } else if (inputArtifactId) {
      contract = audioTranscribeArtifactRoute
      params = { providerId, modelId, artifactId: inputArtifactId }
    }
  }
  if (isOcrExtract && (inputPath || inputArtifactId)) {
    const options = {
      ...(backend !== undefined ? { backend } : {}),
      ...(sourcePageCountHint !== undefined ? { sourcePageCountHint } : {}),
      ...(maxTokens !== undefined ? { generationTokenLimit: maxTokens } : {})
    }
    if (inputPath) {
      const resolvedMimeType = resolveInputMimeType(inputPath, mimeType, OCR_MIME_BY_EXTENSION)
      if (
        resolvedMimeType !== 'application/pdf' &&
        (sourcePageCountHint !== undefined || maxTokens !== undefined)
      ) {
        throw new CliUsageError('--page-count and --max-tokens are only valid for PDF input')
      }
      contract = ocrExtractUploadRoute
      params = {
        ...options,
        mimeType: resolvedMimeType
      }
    } else if (inputArtifactId) {
      contract = ocrExtractArtifactRoute
      params = { ...options, artifactId: inputArtifactId }
    }
  }

  return {
    domain,
    verb,
    contract,
    outputMode,
    timeoutMs,
    helpRequested,
    operation:
      commandKey === 'artifact get'
        ? 'download'
        : inputPath && (isAudioTranscribe || isOcrExtract || isSkillInstall)
          ? 'upload'
          : isModelInvoke || isMediaGenerate || isRunWatch
            ? 'stream'
            : 'rpc',
    params,
    ...(inputPath ? { inputPath } : {}),
    ...(isAudioTranscribe && inputPath
      ? { uploadMaxBytes: AUDIO_TRANSCRIPTION_MAX_INPUT_BYTES }
      : {}),
    ...(isOcrExtract && inputPath ? { uploadMaxBytes: OCR_EXTRACTION_MAX_INPUT_BYTES } : {}),
    ...(isSkillInstall && inputPath ? { uploadMaxBytes: SKILL_ARCHIVE_MAX_INPUT_BYTES } : {}),
    ...(outputPath ? { outputPath } : {}),
    overwrite,
    readStdin
  }
}

export function formatCliHelp(command?: Pick<ParsedCliArguments, 'domain' | 'verb'>): string {
  if (command && command.domain !== 'help') {
    const commandOptions =
      command.domain === 'artifact'
        ? command.verb === 'get'
          ? ' --id <artifact-id> --out <path> [--overwrite]'
          : ' --id <artifact-id>'
        : command.domain === 'agent'
          ? ' (--prompt <text>|--stdin) [--agent <id>] [--provider <id>] [--model <id>]'
          : command.domain === 'run'
            ? command.verb === 'get'
              ? ' --run <run-id> [--cursor <json>] [--limit <n>]'
              : command.verb === 'watch'
                ? ' --run <run-id> [--cursor <event-cursor>] [--limit <n>]'
                : ' --run <run-id>'
            : command.domain === 'model'
              ? command.verb === 'invoke'
                ? ' --provider <id> --model <id> (--prompt <text>|--stdin)'
                : command.verb === 'list'
                  ? ' --provider <id>'
                  : ` --provider <id> --model <id>${command.verb === 'config-set' ? ' --stdin' : ''}`
              : command.domain === 'image' || command.domain === 'video'
                ? ' --provider <id> --model <id> (--prompt <text>|--stdin)'
                : command.domain === 'audio' && command.verb === 'speak'
                  ? ' --provider <id> --model <id> (--text <text>|--stdin)'
                  : command.domain === 'audio'
                    ? ' --provider <id> --model <id> (--file <path>|--artifact <id>)'
                    : command.domain === 'ocr' && command.verb === 'extract'
                      ? ' (--file <path>|--artifact <id>)'
                      : command.domain === 'provider'
                        ? command.verb === 'list'
                          ? ' [--enabled-only]'
                          : command.verb === 'add'
                            ? ' --name <name> --api-type <type> --base-url <url> [--enabled <bool>]'
                            : command.verb === 'update'
                              ? ' --provider <id> [--name <name>] [--api-type <type>] [--base-url <url>] [--enabled <bool>]'
                              : command.verb === 'set-credential'
                                ? ' --provider <id> --stdin'
                                : ` --provider <id>${command.verb === 'test' ? ' [--model <id>]' : ''}`
                        : command.domain === 'settings' && command.verb === 'get'
                          ? ' [--keys <key,key>]'
                          : command.domain === 'settings'
                            ? ' --key <key> --value <json-scalar>'
                            : command.domain === 'skill'
                              ? command.verb === 'list'
                                ? ' [--agent <id>]'
                                : command.verb === 'install'
                                  ? ' (--file <archive>|--url <https-url>) [--agent <id>] [--overwrite]'
                                  : ' --name <name> [--agent <id>]'
                              : command.domain === 'mcp'
                                ? command.verb === 'list'
                                  ? ''
                                  : command.verb === 'add' || command.verb === 'update'
                                    ? ' --name <name> --stdin'
                                    : ' --name <name>'
                                : ''
    const commandKey = `${command.domain} ${command.verb}`
    const optionLines =
      commandKey === 'model invoke'
        ? [
            '  --system <text>       Add a system message',
            '  --temperature <n>     Set sampling temperature (0..2)',
            '  --max-tokens <n>      Set the output-token limit'
          ]
        : commandKey === 'agent run'
          ? [
              '  --system <text>         Override the Agent system prompt',
              '  --title <text>          Set the durable session title',
              '  --project-dir <path>    Set the Agent working directory',
              '  --skills <id,id>        Activate selected Skills',
              '  --disable-tools <id,id> Disable selected Agent tools',
              '  --max-turns <n>         Limit provider rounds (1..100)'
            ]
          : commandKey === 'run get'
            ? ['  --cursor <json>        Read the next older message page']
            : commandKey === 'run watch'
              ? ['  --cursor <value>       Resume after an event cursor']
              : commandKey === 'image generate'
                ? [
                    '  --size <value>       Set output dimensions',
                    '  --quality <value>    Set low, medium, high, or auto quality',
                    '  --format <value>     Set png, jpeg, or webp output',
                    '  --compression <n>    Set jpeg/webp compression (0..100)',
                    '  --background <value> Set auto or opaque background',
                    '  --moderation <value> Set auto or low moderation'
                  ]
                : commandKey === 'video generate'
                  ? [
                      '  --seconds <value>    Set provider-specific clip seconds',
                      '  --size <value>       Set provider-specific dimensions',
                      '  --ratio <value>      Set aspect ratio',
                      '  --duration <n>       Set duration (-1..3600)',
                      '  --resolution <value> Set output resolution',
                      '  --watermark <bool>   Enable or disable watermarking',
                      '  --audio <bool>       Enable or disable generated audio'
                    ]
                  : commandKey === 'audio speak'
                    ? [
                        '  --voice <value>      Select a voice',
                        '  --format <value>     Set mp3, opus, aac, flac, wav, or pcm',
                        '  --speed <n>          Set playback speed (0.25..4)',
                        '  --instructions <text> Add provider-supported speech guidance'
                      ]
                    : commandKey === 'audio transcribe'
                      ? ['  --mime <type>        Override the MIME type inferred from --file']
                      : commandKey === 'ocr extract'
                        ? [
                            '  --mime <type>        Override the MIME type inferred from --file',
                            '  --backend <value>    Select auto or cpu',
                            '  --page-count <n>     Provide a PDF page-count hint',
                            '  --max-tokens <n>     Limit PDF OCR output tokens'
                          ]
                        : []
    return [
      `Usage: deepchat ${command.domain} ${command.verb}${commandOptions} [--json|--jsonl] [--timeout <ms>]`,
      '',
      'Global flags must follow the domain and verb.',
      ...(optionLines.length > 0 ? ['', 'Command options:', ...optionLines] : [])
    ].join('\n')
  }

  return [
    'Usage: deepchat <domain> <verb> [options]',
    '',
    'Commands:',
    '  system status        Show local control-plane status',
    '  system version       Show app and protocol versions',
    '  system capabilities  List the exposed CLI surface',
    '  system doctor        Run local transport diagnostics',
    '  artifact describe    Show owned artifact metadata',
    '  artifact get         Download an owned artifact',
    '  artifact delete      Delete an owned artifact',
    '  model invoke         Stream a raw text-model invocation',
    '  image generate       Generate image artifacts',
    '  video generate       Generate video artifacts',
    '  audio speak          Generate a speech artifact',
    '  audio transcribe     Transcribe an audio file or owned artifact',
    '  ocr status           Show offline OCR runtime and cache status',
    '  ocr extract          Extract text from an image or PDF',
    '  ocr clear-cache      Clear derived OCR cache entries',
    '  provider list        List redacted providers and models',
    '  provider test        Test a provider connection',
    '  provider add         Add a credential-free custom provider',
    '  provider update      Update allowlisted provider fields',
    '  provider set-credential  Read and store an API key from stdin',
    '  provider clear-credential  Clear a stored API key',
    '  provider remove      Remove a custom provider',
    '  model list           List runtime models for a provider',
    '  model enable         Enable one model',
    '  model disable        Disable one model',
    '  model config-get     Read effective model configuration',
    '  model config-set     Read full model configuration JSON from stdin',
    '  model config-reset   Reset user model configuration',
    '  settings get         Read allowlisted public settings',
    '  settings set         Update one allowlisted public setting',
    '  skill list           List redacted Skills for one Agent',
    '  skill install        Install a Skill from a ZIP file or HTTPS URL',
    '  skill enable         Enable one Skill',
    '  skill disable        Disable one Skill',
    '  skill remove         Remove one mutable Skill',
    '  mcp list             List redacted MCP server summaries',
    '  mcp add              Read a new MCP server configuration from stdin',
    '  mcp update           Read an MCP server update from stdin',
    '  mcp enable           Enable and start one MCP server',
    '  mcp disable          Disable and stop one MCP server',
    '  mcp start            Start one configured MCP server',
    '  mcp stop             Stop one configured MCP server',
    '  mcp remove           Remove one MCP server',
    '  agent run           Start a durable detached Agent run',
    '  run get             Read an owned run snapshot and messages',
    '  run watch           Stream targeted run events with a resume cursor',
    '  run cancel          Idempotently cancel an owned active run',
    '  help                 Show this help',
    '',
    'Options (after domain and verb):',
    '  --json               Emit one JSON result envelope',
    '  --jsonl              Emit JSONL records',
    '  --timeout <ms>       Set request timeout',
    '  --help               Show command usage and options',
    '',
    'Run deepchat <domain> <verb> --help for command-specific options.'
  ].join('\n')
}
