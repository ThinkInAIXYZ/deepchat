export type ElicitationField = {
  name: string
  title: string
  description?: string
  type: 'string' | 'number' | 'integer' | 'boolean' | 'single-select' | 'multi-select'
  required: boolean
  options?: Array<{ value: string; title: string }>
  defaultValue?: unknown
  format?: 'date' | 'date-time' | 'email' | 'uri'
  minLength?: number
  maxLength?: number
  minimum?: number
  maximum?: number
  minItems?: number
  maxItems?: number
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const finiteNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined

const readOptions = (
  rawOptions: unknown,
  legacyTitles?: unknown
): Array<{ value: string; title: string }> | undefined => {
  if (!Array.isArray(rawOptions)) {
    return undefined
  }
  const legacy = Array.isArray(legacyTitles) ? legacyTitles : []
  const options = rawOptions.flatMap((rawOption, index) => {
    if (typeof rawOption === 'string') {
      return [
        {
          value: rawOption,
          title: typeof legacy[index] === 'string' ? legacy[index] : rawOption
        }
      ]
    }
    if (
      isRecord(rawOption) &&
      typeof rawOption.const === 'string' &&
      typeof rawOption.title === 'string'
    ) {
      return [{ value: rawOption.const, title: rawOption.title }]
    }
    return []
  })
  return options.length > 0 ? options : undefined
}

export const isValidElicitationFormat = (
  value: string,
  format: ElicitationField['format']
): boolean => {
  if (!format) {
    return true
  }
  if (format === 'email') {
    return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)
  }
  if (format === 'date') {
    const timestamp = Date.parse(`${value}T00:00:00Z`)
    return (
      /^\d{4}-\d{2}-\d{2}$/.test(value) &&
      Number.isFinite(timestamp) &&
      new Date(timestamp).toISOString().slice(0, 10) === value
    )
  }
  if (format === 'date-time') {
    return Number.isFinite(Date.parse(value))
  }
  try {
    new URL(value)
    return true
  } catch {
    return false
  }
}

export function readElicitationFields(schema: unknown): ElicitationField[] {
  if (!isRecord(schema) || !isRecord(schema.properties)) {
    return []
  }
  const required = new Set(
    Array.isArray(schema.required)
      ? schema.required.filter((entry): entry is string => typeof entry === 'string')
      : []
  )
  return Object.entries(schema.properties).map(([name, rawField]) => {
    const field = isRecord(rawField) ? rawField : {}
    const rawType = typeof field.type === 'string' ? field.type : 'string'
    const itemSchema = isRecord(field.items) ? field.items : undefined
    const singleOptions = readOptions(field.oneOf) ?? readOptions(field.enum, field.enumNames)
    const multiOptions = itemSchema
      ? (readOptions(itemSchema.anyOf) ?? readOptions(itemSchema.enum))
      : undefined
    const type: ElicitationField['type'] =
      rawType === 'array' && multiOptions
        ? 'multi-select'
        : rawType === 'string' && singleOptions
          ? 'single-select'
          : rawType === 'number' || rawType === 'integer' || rawType === 'boolean'
            ? rawType
            : 'string'
    return {
      name,
      title: typeof field.title === 'string' ? field.title : name,
      description: typeof field.description === 'string' ? field.description : undefined,
      type,
      required: required.has(name),
      options: type === 'multi-select' ? multiOptions : singleOptions,
      defaultValue:
        field.default !== undefined
          ? field.default
          : type === 'boolean'
            ? false
            : type === 'multi-select'
              ? []
              : undefined,
      format:
        field.format === 'date' ||
        field.format === 'date-time' ||
        field.format === 'email' ||
        field.format === 'uri'
          ? field.format
          : undefined,
      minLength: finiteNumber(field.minLength),
      maxLength: finiteNumber(field.maxLength),
      minimum: finiteNumber(field.minimum),
      maximum: finiteNumber(field.maximum),
      minItems: finiteNumber(field.minItems),
      maxItems: finiteNumber(field.maxItems)
    }
  })
}
