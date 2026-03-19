import type * as schema from '@agentclientprotocol/sdk/dist/schema/index.js'
import type { AcpConfigOption, AcpConfigOptionValue, AcpConfigState } from '@shared/presenter'

export const LEGACY_MODEL_CONFIG_ID = '__acp_legacy_model__'
export const LEGACY_MODE_CONFIG_ID = '__acp_legacy_mode__'

type NormalizableConfigStateInput = {
  configOptions?: schema.SessionConfigOption[] | null
  models?: schema.SessionModelState | null
  modes?: schema.SessionModeState | null
}

const normalizeSelectOptions = (
  options: schema.SessionConfigSelectOptions
): AcpConfigOptionValue[] => {
  return options.flatMap((entry) => {
    if ('group' in entry) {
      return entry.options.map((option) => ({
        value: option.value,
        label: option.name,
        description: option.description ?? null,
        groupId: entry.group,
        groupLabel: entry.name
      }))
    }

    return {
      value: entry.value,
      label: entry.name,
      description: entry.description ?? null,
      groupId: null,
      groupLabel: null
    }
  })
}

const normalizeConfigOption = (option: schema.SessionConfigOption): AcpConfigOption => {
  if (option.type === 'boolean') {
    return {
      id: option.id,
      label: option.name,
      description: option.description ?? null,
      type: 'boolean',
      category: option.category ?? null,
      currentValue: option.currentValue
    }
  }

  return {
    id: option.id,
    label: option.name,
    description: option.description ?? null,
    type: 'select',
    category: option.category ?? null,
    currentValue: option.currentValue,
    options: normalizeSelectOptions(option.options)
  }
}

const buildLegacyModelOption = (
  models?: schema.SessionModelState | null
): AcpConfigOption | undefined => {
  if (!models?.availableModels?.length) {
    return undefined
  }

  return {
    id: LEGACY_MODEL_CONFIG_ID,
    label: 'Model',
    description: null,
    type: 'select',
    category: 'model',
    currentValue: models.currentModelId,
    options: models.availableModels.map((model) => ({
      value: model.modelId,
      label: model.name,
      description: model.description ?? null,
      groupId: null,
      groupLabel: null
    }))
  }
}

const buildLegacyModeOption = (
  modes?: schema.SessionModeState | null
): AcpConfigOption | undefined => {
  if (!modes?.availableModes?.length) {
    return undefined
  }

  return {
    id: LEGACY_MODE_CONFIG_ID,
    label: 'Mode',
    description: null,
    type: 'select',
    category: 'mode',
    currentValue: modes.currentModeId,
    options: modes.availableModes.map((mode) => ({
      value: mode.id,
      label: mode.name,
      description: mode.description ?? null,
      groupId: null,
      groupLabel: null
    }))
  }
}

export const createEmptyAcpConfigState = (
  source: AcpConfigState['source'] = 'legacy'
): AcpConfigState => ({
  source,
  options: []
})

export const normalizeAcpConfigState = (input: NormalizableConfigStateInput): AcpConfigState => {
  if (input.configOptions !== undefined && input.configOptions !== null) {
    return {
      source: 'configOptions',
      options: input.configOptions.map(normalizeConfigOption)
    }
  }

  const options = [buildLegacyModelOption(input.models), buildLegacyModeOption(input.modes)].filter(
    (option): option is AcpConfigOption => Boolean(option)
  )

  return {
    source: 'legacy',
    options
  }
}

export const getAcpConfigOption = (
  state: AcpConfigState | null | undefined,
  configId: string
): AcpConfigOption | undefined => state?.options.find((option) => option.id === configId)

export const getAcpConfigOptionByCategory = (
  state: AcpConfigState | null | undefined,
  category: string
): AcpConfigOption | undefined => state?.options.find((option) => option.category === category)

export const getAcpConfigOptionLabel = (
  option: AcpConfigOption | null | undefined
): string | null => {
  if (!option) {
    return null
  }

  if (option.type !== 'select') {
    return option.currentValue ? 'On' : 'Off'
  }

  const currentValue = String(option.currentValue)
  return option.options?.find((entry) => entry.value === currentValue)?.label ?? currentValue
}

export const getLegacyModeState = (
  state: AcpConfigState | null | undefined
):
  | {
      availableModes: Array<{ id: string; name: string; description: string }>
      currentModeId?: string
    }
  | undefined => {
  const option = state?.options.find(
    (entry) => entry.id === LEGACY_MODE_CONFIG_ID || entry.category === 'mode'
  )
  if (!option || option.type !== 'select') {
    return undefined
  }

  return {
    availableModes:
      option.options?.map((entry) => ({
        id: entry.value,
        name: entry.label,
        description: entry.description ?? ''
      })) ?? [],
    currentModeId: typeof option.currentValue === 'string' ? option.currentValue : undefined
  }
}

export const updateAcpConfigStateValue = (
  state: AcpConfigState | null | undefined,
  configId: string,
  value: string | boolean
): AcpConfigState | null => {
  if (!state) {
    return null
  }

  return {
    ...state,
    options: state.options.map((option) =>
      option.id === configId
        ? {
            ...option,
            currentValue: value
          }
        : option
    )
  }
}
