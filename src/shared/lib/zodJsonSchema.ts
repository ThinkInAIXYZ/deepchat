import { z } from 'zod'

export interface DeepChatJsonSchemaObject {
  type: 'object'
  properties: Record<string, unknown>
  required?: string[]
  additionalProperties?: boolean | Record<string, unknown>
  description?: string
}

const INTERSECTION_SCHEMA_ERROR =
  'DeepChat tool schemas cannot safely represent intersection object schemas.'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isNullSchema = (value: unknown): boolean => isRecord(value) && value.type === 'null'

const objectVariants = (value: unknown): Record<string, unknown>[] | null => {
  if (!Array.isArray(value)) {
    return null
  }

  const nonNullVariants = value.filter((variant) => !isNullSchema(variant))
  const variants = nonNullVariants.filter(
    (variant): variant is Record<string, unknown> =>
      isRecord(variant) && variant.type === 'object' && isRecord(variant.properties)
  )

  return variants.length > 0 && variants.length === nonNullVariants.length ? variants : null
}

const collectEnumValues = (schema: Record<string, unknown>): unknown[] | null => {
  if (Array.isArray(schema.enum)) {
    return schema.enum
  }

  if ('const' in schema) {
    return [schema.const]
  }

  return null
}

const mergePropertySchema = (
  existing: unknown,
  next: unknown
): Record<string, unknown> | unknown => {
  if (JSON.stringify(existing) === JSON.stringify(next)) {
    return existing
  }

  if (!isRecord(existing) || !isRecord(next)) {
    return { anyOf: [existing, next] }
  }

  const existingEnumValues = collectEnumValues(existing)
  const nextEnumValues = collectEnumValues(next)

  if (existingEnumValues && nextEnumValues && existing.type === next.type) {
    const baseSchema = { ...existing }
    delete baseSchema.const

    return {
      ...baseSchema,
      ...(typeof existing.type === 'string' ? { type: existing.type } : {}),
      enum: Array.from(new Set([...existingEnumValues, ...nextEnumValues]))
    }
  }

  return {
    anyOf: [
      ...(Array.isArray(existing.anyOf) ? existing.anyOf : [existing]),
      ...(Array.isArray(next.anyOf) ? next.anyOf : [next])
    ]
  }
}

const mergeObjectVariantProperties = (
  variants: Record<string, unknown>[]
): Record<string, unknown> => {
  return variants.reduce<Record<string, unknown>>((properties, variant) => {
    const variantProperties = variant.properties as Record<string, unknown>

    for (const [key, value] of Object.entries(variantProperties)) {
      properties[key] = key in properties ? mergePropertySchema(properties[key], value) : value
    }

    return properties
  }, {})
}

const collectRequired = (jsonSchema: Record<string, unknown>): string[] | undefined => {
  if (!Array.isArray(jsonSchema.required)) {
    return undefined
  }

  return jsonSchema.required.filter((value): value is string => typeof value === 'string')
}

const collectCommonRequired = (variants: Record<string, unknown>[]): string[] | undefined => {
  const requiredByVariant = variants.map((variant) => collectRequired(variant) ?? [])
  const [firstRequired, ...remainingRequired] = requiredByVariant

  const required = firstRequired.filter((key) =>
    remainingRequired.every((variantRequired) => variantRequired.includes(key))
  )

  return required.length > 0 ? required : undefined
}

const collectAdditionalProperties = (
  jsonSchema: Record<string, unknown>
): boolean | Record<string, unknown> | undefined => {
  const additionalProperties = jsonSchema.additionalProperties

  return typeof additionalProperties === 'boolean' || isRecord(additionalProperties)
    ? additionalProperties
    : undefined
}

const collectCommonAdditionalProperties = (
  variants: Record<string, unknown>[]
): boolean | Record<string, unknown> | undefined => {
  const values = variants.map((variant) => collectAdditionalProperties(variant))
  const [firstValue, ...remainingValues] = values

  if (firstValue === undefined) {
    return undefined
  }

  const firstValueJson = JSON.stringify(firstValue)
  return remainingValues.every((value) => JSON.stringify(value) === firstValueJson)
    ? firstValue
    : undefined
}

const buildObjectSchema = (
  properties: Record<string, unknown>,
  required?: string[],
  additionalProperties?: boolean | Record<string, unknown>,
  description?: string
): DeepChatJsonSchemaObject => ({
  type: 'object',
  properties,
  ...(required?.length ? { required } : {}),
  ...(additionalProperties !== undefined ? { additionalProperties } : {}),
  ...(description ? { description } : {})
})

const getObjectVariants = (
  jsonSchema: Record<string, unknown>
): { branchKey: 'oneOf' | 'anyOf'; variants: Record<string, unknown>[] } | null => {
  for (const branchKey of ['oneOf', 'anyOf'] as const) {
    const variants = objectVariants(jsonSchema[branchKey])
    if (variants) {
      return { branchKey, variants }
    }
  }

  return null
}

export function toDeepChatJsonSchema(schema: z.ZodType): DeepChatJsonSchemaObject {
  const jsonSchema = z.toJSONSchema(schema, {
    io: 'input',
    unrepresentable: 'throw'
  }) as Record<string, unknown>

  if (Array.isArray(jsonSchema.allOf)) {
    throw new Error(INTERSECTION_SCHEMA_ERROR)
  }

  if (jsonSchema.type === 'object' && isRecord(jsonSchema.properties)) {
    const required = collectRequired(jsonSchema)

    return buildObjectSchema(
      jsonSchema.properties,
      required,
      collectAdditionalProperties(jsonSchema),
      typeof jsonSchema.description === 'string' ? jsonSchema.description : undefined
    )
  }

  const objectVariantResult = getObjectVariants(jsonSchema)

  if (objectVariantResult) {
    const { variants } = objectVariantResult
    const required = collectCommonRequired(variants)

    return buildObjectSchema(
      mergeObjectVariantProperties(variants),
      required,
      collectCommonAdditionalProperties(variants),
      typeof jsonSchema.description === 'string' ? jsonSchema.description : undefined
    )
  }

  throw new Error('DeepChat tool schemas must convert to JSON object schemas.')
}
