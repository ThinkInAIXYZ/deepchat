import type { IModelConfig } from '@shared/types/provider'

export const LEGACY_MODEL_CONFIG_META_KEY = '__meta__'
export const USER_MODEL_CONFIG_MIGRATION_ID = 'user-model-config-only-v1'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

export function normalizeUserModelConfigEntry(
  value: unknown,
  options: { legacyUserKey?: boolean } = {}
): IModelConfig | undefined {
  if (!isRecord(value) || !isRecord(value.config)) {
    return undefined
  }

  const source = value.source
  const isExplicitUser = source === 'user'
  const hasLegacySource = source === undefined || source === null
  const isLegacyUser =
    hasLegacySource && (value.config.isUserDefined === true || options.legacyUserKey === true)

  if (!isExplicitUser && !isLegacyUser) {
    return undefined
  }

  if (
    typeof value.id !== 'string' ||
    value.id.length === 0 ||
    typeof value.providerId !== 'string' ||
    value.providerId.length === 0
  ) {
    return undefined
  }

  return {
    ...(value as unknown as IModelConfig),
    source: 'user',
    config: {
      ...(value.config as unknown as IModelConfig['config']),
      isUserDefined: true
    }
  }
}
