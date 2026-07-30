import { computed, onBeforeUnmount, onMounted, readonly, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useMcpStore } from '@/stores/mcp'
import {
  type KnowledgeConfigOperationSource,
  useKnowledgeConfigOperation
} from './useKnowledgeConfigOperation'

type ExternalKnowledgeConfig = Readonly<{
  enabled?: boolean
}>

type ExternalKnowledgeConfigOptions<T extends ExternalKnowledgeConfig> = Readonly<{
  serverName: string
  codePrefix: string
  diagnosticName: string
  isConfig: (value: unknown) => value is T
  clone: (config: T) => T
}>

type ConfigCommit = () => void

export function parseKnowledgeConfigs<T>(
  environment: unknown,
  isConfig: (value: unknown) => value is T
): T[] {
  const parsed = typeof environment === 'string' ? JSON.parse(environment) : environment
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('configs' in parsed) ||
    !Array.isArray(parsed.configs) ||
    !parsed.configs.every(isConfig)
  ) {
    throw new TypeError('Knowledge configuration payload is invalid')
  }
  return parsed.configs
}

export function useExternalKnowledgeConfigs<T extends ExternalKnowledgeConfig>(
  options: ExternalKnowledgeConfigOptions<T>
) {
  const { t } = useI18n()
  const mcpStore = useMcpStore()
  const operation = useKnowledgeConfigOperation()
  const configs = shallowRef<T[]>([])
  const loadError = shallowRef<string | null>(null)

  const cloneAll = (source: readonly T[]) => source.map(options.clone)
  const serverEnabled = computed(() =>
    Boolean(mcpStore.config.mcpServers[options.serverName]?.enabled)
  )
  const globalEnabled = computed(() => mcpStore.mcpEnabled)

  const persist = (nextConfigs: readonly T[]) =>
    mcpStore.updateServer(options.serverName, {
      env: {
        configs: cloneAll(nextConfigs)
      }
    })

  const runMutation = (
    action: string,
    source: KnowledgeConfigOperationSource,
    nextConfigs: readonly T[],
    afterCommit?: ConfigCommit
  ) =>
    operation.run({
      code: `${options.codePrefix}.${action}`,
      source,
      label: t('common.saving'),
      perform: () => persist(nextConfigs),
      commit: () => {
        configs.value = cloneAll(nextConfigs)
        loadError.value = null
        afterCommit?.()
      }
    })

  const save = (index: number | null, config: T, afterCommit?: ConfigCommit) => {
    const nextConfigs = cloneAll(configs.value)
    if (index === null) {
      nextConfigs.push(options.clone(config))
    } else if (index >= 0 && index < nextConfigs.length) {
      nextConfigs[index] = options.clone(config)
    } else {
      return Promise.resolve(false)
    }
    return runMutation('save', 'dialog', nextConfigs, afterCommit)
  }

  const remove = (index: number) => {
    if (index < 0 || index >= configs.value.length) return Promise.resolve(false)
    const nextConfigs = configs.value
      .filter((_, configIndex) => configIndex !== index)
      .map(options.clone)
    return runMutation('remove', 'panel', nextConfigs)
  }

  const setEnabled = (index: number, enabled: boolean) => {
    if (index < 0 || index >= configs.value.length) return Promise.resolve(false)
    const nextConfigs = configs.value.map((config, configIndex) =>
      options.clone(configIndex === index ? ({ ...config, enabled } as T) : config)
    )
    return runMutation('toggleConfig', 'panel', nextConfigs)
  }

  const toggleServer = () => {
    if (!globalEnabled.value || operation.pending.value) return Promise.resolve(false)
    return operation.run({
      code: `${options.codePrefix}.toggleServer`,
      source: 'panel',
      label: t('common.saving'),
      perform: () => mcpStore.toggleServer(options.serverName),
      commit: () => undefined
    })
  }

  const load = () => {
    const environment = mcpStore.config.mcpServers[options.serverName]?.env
    if (environment === undefined) return
    try {
      configs.value = parseKnowledgeConfigs(environment, options.isConfig).map(options.clone)
      loadError.value = null
    } catch (error) {
      console.error(`[${options.diagnosticName}] Failed to load configuration`, error)
      loadError.value = t('common.error.requestFailed')
    }
  }

  let stopReadyWatch: (() => void) | undefined
  onMounted(() => {
    if (mcpStore.config.ready) {
      load()
      return
    }
    stopReadyWatch = watch(
      () => mcpStore.config.ready,
      (ready) => {
        if (!ready) return
        stopReadyWatch?.()
        stopReadyWatch = undefined
        load()
      }
    )
  })

  onBeforeUnmount(() => {
    stopReadyWatch?.()
  })

  return Object.freeze({
    configs: readonly(configs),
    loadError: readonly(loadError),
    serverEnabled,
    globalEnabled,
    operation,
    pending: operation.pending,
    save,
    remove,
    setEnabled,
    toggleServer
  })
}
