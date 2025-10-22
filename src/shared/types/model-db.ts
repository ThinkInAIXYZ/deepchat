import { z } from 'zod'

// ---------- Zod Schemas ----------

// Capability sub-schemas
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
    effort: z.enum(['minimal', 'low', 'medium', 'high']).optional(),
    verbosity: z.enum(['low', 'medium', 'high']).optional()
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
  search: SearchSchema,
  attachment: z.boolean().optional(),
  open_weights: z.boolean().optional(),
  knowledge: z.string().optional(),
  release_date: z.string().optional(),
  last_updated: z.string().optional(),
  cost: z.record(z.union([z.string(), z.number()])).optional()
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

// ---------- Helpers ----------

export function isImageInputSupported(model: ProviderModel | undefined): boolean {
  if (!model || !model.modalities || !model.modalities.input) return false
  return model.modalities.input.includes('image')
}

// strengthened id check: lowercase and allowed chars
const PROVIDER_ID_REGEX = /^[a-z0-9][a-z0-9-_]*$/
const MODEL_ID_REGEX = /^[a-z0-9][a-z0-9\-_.:/]*$/
export function isValidLowercaseProviderId(id: unknown): id is string {
  return (
    typeof id === 'string' && id.length > 0 && id === id.toLowerCase() && PROVIDER_ID_REGEX.test(id)
  )
}
export function isValidLowercaseModelId(id: unknown): id is string {
  return (
    typeof id === 'string' && id.length > 0 && id === id.toLowerCase() && MODEL_ID_REGEX.test(id)
  )
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

type ReasoningEffort = 'minimal' | 'low' | 'medium' | 'high'
type Verbosity = 'low' | 'medium' | 'high'

function getEffortValue(v: unknown): ReasoningEffort | undefined {
  if (typeof v !== 'string') return undefined
  switch (v) {
    case 'minimal':
    case 'low':
    case 'medium':
    case 'high':
      return v
    default:
      return undefined
  }
}

function getVerbosityValue(v: unknown): Verbosity | undefined {
  if (typeof v !== 'string') return undefined
  switch (v) {
    case 'low':
    case 'medium':
    case 'high':
      return v
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
  const budgetVal = (obj as Record<string, unknown>)['budget']
  let budget: { default?: number; min?: number; max?: number } | undefined
  if (isRecord(budgetVal)) {
    const def = getNumber(budgetVal, 'default')
    const min = getNumber(budgetVal, 'min')
    const max = getNumber(budgetVal, 'max')
    const out: { default?: number; min?: number; max?: number } = {}
    if (typeof def === 'number') out.default = def
    if (typeof min === 'number') out.min = min
    if (typeof max === 'number') out.max = max
    if (out.default !== undefined || out.min !== undefined || out.max !== undefined) budget = out
  }
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
      if (!isValidLowercaseModelId(mid)) continue

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
        search: getSearch(rm['search']),
        attachment: getBoolean(rm, 'attachment'),
        open_weights: getBoolean(rm, 'open_weights'),
        knowledge: getString(rm, 'knowledge'),
        release_date: getString(rm, 'release_date'),
        last_updated: getString(rm, 'last_updated'),
        cost: getStringNumberRecord(rm['cost'])
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
