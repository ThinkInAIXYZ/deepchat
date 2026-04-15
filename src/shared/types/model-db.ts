import { z } from 'zod'

// ---------- Zod Schemas ----------

// Capability sub-schemas
export const REASONING_EFFORT_VALUES = [
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh'
] as const
export const ReasoningEffortSchema = z.enum(REASONING_EFFORT_VALUES)
export type ReasoningEffort = z.infer<typeof ReasoningEffortSchema>
export const DEFAULT_REASONING_EFFORT_OPTIONS: ReasoningEffort[] = [
  'minimal',
  'low',
  'medium',
  'high'
]

export const VerbositySchema = z.enum(['low', 'medium', 'high'])
export type Verbosity = z.infer<typeof VerbositySchema>

export const ReasoningModeSchema = z.enum(['budget', 'effort', 'level', 'fixed', 'mixed'])
export type ReasoningMode = z.infer<typeof ReasoningModeSchema>

export const ReasoningVisibilitySchema = z.enum(['hidden', 'summary', 'full', 'mixed'])
export type ReasoningVisibility = z.infer<typeof ReasoningVisibilitySchema>

export const ReasoningSchema = z
  .object({
    supported: z.boolean().optional(),
    default: z.boolean().optional(),
    budget: z
      .object({
        default: z.number().int().optional(),
        min: z.number().int().optional(),
        max: z.number().int().optional()
      })
      .optional(),
    effort: ReasoningEffortSchema.optional(),
    verbosity: VerbositySchema.optional()
  })
  .optional()

export const ReasoningBudgetSchema = z
  .object({
    default: z.number().int().optional(),
    min: z.number().int().optional(),
    max: z.number().int().optional(),
    auto: z.number().int().optional(),
    off: z.number().int().optional(),
    unit: z.string().optional()
  })
  .optional()

export const ExtraReasoningSchema = z
  .object({
    supported: z.boolean().optional(),
    default_enabled: z.boolean().optional(),
    mode: ReasoningModeSchema.optional(),
    budget: ReasoningBudgetSchema,
    effort: ReasoningEffortSchema.optional(),
    effort_options: z.array(ReasoningEffortSchema).optional(),
    verbosity: VerbositySchema.optional(),
    verbosity_options: z.array(VerbositySchema).optional(),
    level: z.string().optional(),
    level_options: z.array(z.string()).optional(),
    interleaved: z.boolean().optional(),
    summaries: z.boolean().optional(),
    visibility: ReasoningVisibilitySchema.optional(),
    continuation: z.array(z.string()).optional(),
    notes: z.array(z.string()).optional()
  })
  .optional()

export const ExtraCapabilitiesSchema = z
  .object({
    reasoning: ExtraReasoningSchema
  })
  .optional()

export const SearchSchema = z
  .object({
    supported: z.boolean().optional(),
    default: z.boolean().optional(),
    forced_search: z.boolean().optional(),
    search_strategy: z.string().optional()
  })
  .optional()

export const ModelSchema = z.object({
  id: z.string().min(1),
  name: z.string().optional(),
  display_name: z.string().optional(),
  modalities: z
    .object({
      input: z.array(z.string()).optional(),
      output: z.array(z.string()).optional()
    })
    .optional(),
  limit: z
    .object({
      context: z.number().int().nonnegative().optional(),
      output: z.number().int().nonnegative().optional()
    })
    .optional(),
  temperature: z.boolean().optional(),
  tool_call: z.boolean().optional(),
  reasoning: ReasoningSchema,
  extra_capabilities: ExtraCapabilitiesSchema,
  search: SearchSchema,
  attachment: z.boolean().optional(),
  open_weights: z.boolean().optional(),
  knowledge: z.string().optional(),
  release_date: z.string().optional(),
  last_updated: z.string().optional(),
  cost: z.record(z.union([z.string(), z.number()])).optional(),
  type: z.enum(['chat', 'embedding', 'rerank', 'imageGeneration']).optional()
})

export type ProviderModel = z.infer<typeof ModelSchema>

export const ProviderSchema = z.object({
  id: z.string().min(1),
  name: z.string().optional(),
  display_name: z.string().optional(),
  api: z.string().optional(),
  doc: z.string().optional(),
  env: z.array(z.string()).optional(),
  models: z.array(ModelSchema)
})

export type ProviderEntry = z.infer<typeof ProviderSchema>

export const ProviderAggregateSchema = z.object({
  providers: z.record(ProviderSchema)
})

export type ProviderAggregate = z.infer<typeof ProviderAggregateSchema>

export type ReasoningPortrait = {
  supported?: boolean
  defaultEnabled?: boolean
  mode?: ReasoningMode
  budget?: {
    default?: number
    min?: number
    max?: number
    auto?: number
    off?: number
    unit?: string
  }
  effort?: ReasoningEffort
  effortOptions?: ReasoningEffort[]
  verbosity?: Verbosity
  verbosityOptions?: Verbosity[]
  level?: string
  levelOptions?: string[]
  interleaved?: boolean
  summaries?: boolean
  visibility?: ReasoningVisibility
  continuation?: string[]
  notes?: string[]
}

export type ReasoningControlMode = 'unsupported' | 'toggle' | 'indicator'

export const isReasoningEffort = (value: unknown): value is ReasoningEffort =>
  ReasoningEffortSchema.safeParse(value).success

export const isVerbosity = (value: unknown): value is Verbosity =>
  VerbositySchema.safeParse(value).success

export const supportsReasoningCapability = (
  portrait: ReasoningPortrait | null | undefined
): boolean => portrait?.supported === true

export const getReasoningControlMode = (
  portrait: ReasoningPortrait | null | undefined
): ReasoningControlMode => {
  if (!supportsReasoningCapability(portrait)) {
    return 'unsupported'
  }

  return portrait?.mode === undefined || portrait.mode === 'budget' ? 'toggle' : 'indicator'
}

export const hasIndependentReasoningToggle = (
  portrait: ReasoningPortrait | null | undefined
): boolean => getReasoningControlMode(portrait) === 'toggle'

export const getReasoningEffectiveEnabled = (
  portrait: ReasoningPortrait | null | undefined,
  state: {
    reasoning?: boolean | null
    reasoningEffort?: unknown
  } = {}
): boolean => {
  if (!portrait) {
    return state.reasoning === true
  }

  if (!supportsReasoningCapability(portrait)) {
    return false
  }

  if (hasIndependentReasoningToggle(portrait)) {
    return state.reasoning ?? portrait.defaultEnabled ?? true
  }

  if (portrait.mode === 'effort') {
    const resolvedEffort = isReasoningEffort(state.reasoningEffort)
      ? state.reasoningEffort
      : isReasoningEffort(portrait.effort)
        ? portrait.effort
        : undefined

    if (resolvedEffort === 'none') {
      return false
    }

    if (resolvedEffort !== undefined) {
      return true
    }
  }

  return portrait.defaultEnabled ?? true
}

// ---------- Helpers ----------

export function isImageInputSupported(model: ProviderModel | undefined): boolean {
  if (!model || !model.modalities || !model.modalities.input) return false
  return model.modalities.input.includes('image')
}

// strengthened id check: lowercase and allowed chars
const PROVIDER_ID_REGEX = /^[a-z0-9][a-z0-9-_]*$/
const MODEL_ID_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9\-_.:/]*$/
export function isValidLowercaseProviderId(id: unknown): id is string {
  return (
    typeof id === 'string' && id.length > 0 && id === id.toLowerCase() && PROVIDER_ID_REGEX.test(id)
  )
}
export function isValidModelId(id: unknown): id is string {
  return typeof id === 'string' && id.length > 0 && MODEL_ID_REGEX.test(id)
}

// Sanitize an unknown aggregate object: filter out invalid providers/models
function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}
function getString(obj: Record<string, unknown>, key: string): string | undefined {
  const v = obj[key]
  return typeof v === 'string' ? v : undefined
}
function getBoolean(obj: Record<string, unknown>, key: string): boolean | undefined {
  const v = obj[key]
  return typeof v === 'boolean' ? v : undefined
}
function getNumber(obj: Record<string, unknown>, key: string): number | undefined {
  const v = obj[key]
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}
function getStringArray(obj: Record<string, unknown>, key: string): string[] | undefined {
  const v = obj[key]
  if (!Array.isArray(v)) return undefined
  const arr = v.filter((x) => typeof x === 'string') as string[]
  return arr.length ? arr : []
}
function getStringNumberRecord(obj: unknown): Record<string, string | number> | undefined {
  if (!isRecord(obj)) return undefined
  const out: Record<string, string | number> = {}
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'string' || typeof v === 'number') out[k] = v
  }
  return Object.keys(out).length ? out : undefined
}

type ModelTypeValue = 'chat' | 'embedding' | 'rerank' | 'imageGeneration'

function getEffortValue(v: unknown): ReasoningEffort | undefined {
  return isReasoningEffort(v) ? v : undefined
}

function getVerbosityValue(v: unknown): Verbosity | undefined {
  return isVerbosity(v) ? v : undefined
}

function getReasoningModeValue(v: unknown): ReasoningMode | undefined {
  const parsed = ReasoningModeSchema.safeParse(v)
  return parsed.success ? parsed.data : undefined
}

function getReasoningVisibilityValue(v: unknown): ReasoningVisibility | undefined {
  const parsed = ReasoningVisibilitySchema.safeParse(v)
  return parsed.success ? parsed.data : undefined
}

function getNonEmptyStringArray(obj: Record<string, unknown>, key: string): string[] | undefined {
  const values = getStringArray(obj, key)
  return values && values.length > 0 ? values : undefined
}

function getOptionalStringArray(value: unknown): string[] | undefined {
  if (typeof value === 'string') {
    const normalized = value.trim()
    return normalized ? [normalized] : undefined
  }
  if (!Array.isArray(value)) return undefined
  const values = value.filter((item) => typeof item === 'string' && item.trim()) as string[]
  return values.length > 0 ? values : undefined
}

function getReasoningBudget(obj: unknown):
  | {
      default?: number
      min?: number
      max?: number
      auto?: number
      off?: number
      unit?: string
    }
  | undefined {
  if (!isRecord(obj)) return undefined

  const budget: {
    default?: number
    min?: number
    max?: number
    auto?: number
    off?: number
    unit?: string
  } = {}

  const def = getNumber(obj, 'default')
  const min = getNumber(obj, 'min')
  const max = getNumber(obj, 'max')
  const auto = getNumber(obj, 'auto')
  const off = getNumber(obj, 'off')
  const unit = getString(obj, 'unit')

  if (typeof def === 'number') budget.default = def
  if (typeof min === 'number') budget.min = min
  if (typeof max === 'number') budget.max = max
  if (typeof auto === 'number') budget.auto = auto
  if (typeof off === 'number') budget.off = off
  if (unit) budget.unit = unit

  return Object.keys(budget).length > 0 ? budget : undefined
}

function getModelTypeValue(v: unknown): ModelTypeValue | undefined {
  if (typeof v !== 'string') return undefined

  // First try exact match (for standard format)
  switch (v) {
    case 'chat':
    case 'embedding':
    case 'rerank':
    case 'imageGeneration':
      return v
  }

  // Normalize and handle variants (like image_generation, image-generation, etc.)
  const normalized = v.toLowerCase().replace(/[_-]/g, '')
  switch (normalized) {
    case 'chat':
      return 'chat'
    case 'embedding':
      return 'embedding'
    case 'rerank':
      return 'rerank'
    case 'imagegeneration':
    case 'imagegen':
      return 'imageGeneration'
    default:
      return undefined
  }
}

function getReasoning(obj: unknown): ProviderModel['reasoning'] {
  if (typeof obj === 'boolean') {
    return { supported: obj }
  }
  if (!isRecord(obj)) return undefined
  const supported = getBoolean(obj, 'supported')
  const defEnabled = getBoolean(obj, 'default')
  const rawBudget = getReasoningBudget((obj as Record<string, unknown>)['budget'])
  const budget =
    rawBudget &&
    (rawBudget.default !== undefined || rawBudget.min !== undefined || rawBudget.max !== undefined)
      ? {
          ...(rawBudget.default !== undefined ? { default: rawBudget.default } : {}),
          ...(rawBudget.min !== undefined ? { min: rawBudget.min } : {}),
          ...(rawBudget.max !== undefined ? { max: rawBudget.max } : {})
        }
      : undefined
  const effort = getEffortValue((obj as any)['effort'])
  const verbosity = getVerbosityValue((obj as any)['verbosity'])

  if (
    supported !== undefined ||
    defEnabled !== undefined ||
    budget !== undefined ||
    effort !== undefined ||
    verbosity !== undefined
  )
    return { supported, default: defEnabled, budget, effort, verbosity }
  return undefined
}

function getExtraReasoning(
  obj: unknown
): NonNullable<ProviderModel['extra_capabilities']>['reasoning'] {
  if (!isRecord(obj)) return undefined

  const supported = getBoolean(obj, 'supported')
  const default_enabled = getBoolean(obj, 'default_enabled')
  const mode = getReasoningModeValue(obj['mode'])
  const budget = getReasoningBudget(obj['budget'])
  const effort = getEffortValue(obj['effort'])
  const effort_options = getNonEmptyStringArray(obj, 'effort_options')?.filter(
    (value) => ReasoningEffortSchema.safeParse(value).success
  ) as ReasoningEffort[] | undefined
  const verbosity = getVerbosityValue(obj['verbosity'])
  const verbosity_options = getNonEmptyStringArray(obj, 'verbosity_options')?.filter(
    (value) => VerbositySchema.safeParse(value).success
  ) as Verbosity[] | undefined
  const level = getString(obj, 'level')
  const level_options = getNonEmptyStringArray(obj, 'level_options')
  const interleaved = getBoolean(obj, 'interleaved')
  const summaries = getBoolean(obj, 'summaries')
  const visibility = getReasoningVisibilityValue(obj['visibility'])
  const continuation = getOptionalStringArray(obj['continuation'])
  const notes = getOptionalStringArray(obj['notes'])

  if (
    supported !== undefined ||
    default_enabled !== undefined ||
    mode !== undefined ||
    budget !== undefined ||
    effort !== undefined ||
    effort_options !== undefined ||
    verbosity !== undefined ||
    verbosity_options !== undefined ||
    level !== undefined ||
    level_options !== undefined ||
    interleaved !== undefined ||
    summaries !== undefined ||
    visibility !== undefined ||
    continuation !== undefined ||
    notes !== undefined
  ) {
    return {
      supported,
      default_enabled,
      mode,
      budget,
      effort,
      effort_options,
      verbosity,
      verbosity_options,
      level,
      level_options,
      interleaved,
      summaries,
      visibility,
      continuation,
      notes
    }
  }

  return undefined
}

function getExtraCapabilities(obj: unknown): ProviderModel['extra_capabilities'] {
  if (!isRecord(obj)) return undefined
  const reasoning = getExtraReasoning(obj['reasoning'])
  if (reasoning) {
    return { reasoning }
  }
  return undefined
}

function getSearch(obj: unknown): ProviderModel['search'] {
  if (!isRecord(obj)) return undefined
  const supported = getBoolean(obj, 'supported')
  const defEnabled = getBoolean(obj, 'default')
  const forced_search = getBoolean(obj, 'forced_search')
  const search_strategy = getString(obj, 'search_strategy')
  if (
    supported !== undefined ||
    defEnabled !== undefined ||
    forced_search !== undefined ||
    search_strategy !== undefined
  ) {
    return { supported, default: defEnabled, forced_search, search_strategy }
  }
  return undefined
}

export function sanitizeAggregate(input: unknown): ProviderAggregate | null {
  if (!isRecord(input)) return null
  const providersRaw = (input as Record<string, unknown>)['providers']
  if (!isRecord(providersRaw)) return null

  const sanitizedProviders: Record<string, ProviderEntry> = {}

  for (const [key, rawProviderVal] of Object.entries(providersRaw)) {
    if (!isRecord(rawProviderVal)) continue
    const rawProvider = rawProviderVal as Record<string, unknown>

    const pid = getString(rawProvider, 'id') ?? key
    if (!isValidLowercaseProviderId(pid)) continue
    if (pid !== key) continue

    const modelsVal = rawProvider['models']
    if (!Array.isArray(modelsVal)) continue

    const sanitizedModels: ProviderModel[] = []
    for (const rmVal of modelsVal) {
      if (!isRecord(rmVal)) continue
      const rm = rmVal as Record<string, unknown>
      const mid = getString(rm, 'id')
      if (!isValidModelId(mid)) continue

      // limit
      let limit: ProviderModel['limit'] | undefined
      const rlimit = rm['limit']
      if (isRecord(rlimit)) {
        const ctx = getNumber(rlimit, 'context')
        const out = getNumber(rlimit, 'output')
        const lim: { context?: number; output?: number } = {}
        if (typeof ctx === 'number' && ctx >= 0) lim.context = ctx
        if (typeof out === 'number' && out >= 0) lim.output = out
        if (lim.context !== undefined || lim.output !== undefined) limit = lim
      }

      // modalities
      let modalities: ProviderModel['modalities'] | undefined
      const rmods = rm['modalities']
      if (isRecord(rmods)) {
        const inp = getStringArray(rmods, 'input')
        const out = getStringArray(rmods, 'output')
        if (inp || out) modalities = { input: inp, output: out }
      }

      const model: ProviderModel = {
        id: mid!,
        name: getString(rm, 'name'),
        display_name: getString(rm, 'display_name'),
        modalities,
        limit,
        temperature: getBoolean(rm, 'temperature'),
        tool_call: getBoolean(rm, 'tool_call'),
        reasoning: getReasoning(rm['reasoning']),
        extra_capabilities: getExtraCapabilities(rm['extra_capabilities']),
        search: getSearch(rm['search']),
        attachment: getBoolean(rm, 'attachment'),
        open_weights: getBoolean(rm, 'open_weights'),
        knowledge: getString(rm, 'knowledge'),
        release_date: getString(rm, 'release_date'),
        last_updated: getString(rm, 'last_updated'),
        cost: getStringNumberRecord(rm['cost']),
        type: getModelTypeValue(rm['type'])
      }

      sanitizedModels.push(model)
    }

    if (sanitizedModels.length === 0) continue

    const envArr = getStringArray(rawProvider, 'env')

    const provider: ProviderEntry = {
      id: pid,
      name: getString(rawProvider, 'name'),
      display_name: getString(rawProvider, 'display_name'),
      api: getString(rawProvider, 'api'),
      doc: getString(rawProvider, 'doc'),
      env: envArr,
      models: sanitizedModels
    }

    sanitizedProviders[pid] = provider
  }

  const keys = Object.keys(sanitizedProviders)
  if (keys.length === 0) return null
  return { providers: sanitizedProviders }
}
