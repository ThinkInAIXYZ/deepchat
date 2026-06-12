import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type { DeepchatEventPayload } from '@shared/contracts/events'
import { createStartupClient } from '@api/StartupClient'

type StartupWorkloadTarget = 'main' | 'settings'
type StartupWorkloadTask = DeepchatEventPayload<'startup.workload.changed'>['tasks'][number]
type StartupSectionId =
  | 'main.bootstrap'
  | 'main.sessions'
  | 'main.provider'
  | 'settings.providers'
  | 'settings.provider'
  | 'settings.ollama'
  | 'settings.skills'
  | 'settings.mcp'
  | 'settings.remote'

const SECTION_TASK_IDS: Record<StartupSectionId, StartupWorkloadTask['id'][]> = {
  'main.bootstrap': ['main.bootstrap'],
  'main.sessions': ['main.session.firstPage'],
  'main.provider': ['main.provider.warmup'],
  'settings.providers': ['settings.providers.summary'],
  'settings.provider': ['settings.provider.models'],
  'settings.ollama': ['settings.ollama'],
  'settings.skills': ['settings.skills.catalog', 'settings.skills.syncScan'],
  'settings.mcp': ['settings.mcp.runtime'],
  'settings.remote': ['settings.remote.runtime']
}

export const useStartupWorkloadStore = defineStore('startupWorkload', () => {
  const startupClient = createStartupClient()
  const runIds = ref<Record<StartupWorkloadTarget, string | null>>({
    main: null,
    settings: null
  })
  const taskMaps = ref<Record<StartupWorkloadTarget, Record<string, StartupWorkloadTask>>>({
    main: {},
    settings: {}
  })
  const connected = ref(false)
  let unsubscribe: (() => void) | null = null

  const connect = () => {
    if (connected.value) {
      return
    }

    unsubscribe = startupClient.onWorkloadChanged((payload) => {
      runIds.value = {
        ...runIds.value,
        [payload.target]: payload.startupRunId
      }
      taskMaps.value = {
        ...taskMaps.value,
        [payload.target]: Object.fromEntries(payload.tasks.map((task) => [task.id, task]))
      }
    })
    connected.value = true
  }

  const disconnect = () => {
    unsubscribe?.()
    unsubscribe = null
    connected.value = false
  }

  const mainTasks = computed(() => Object.values(taskMaps.value.main))
  const settingsTasks = computed(() => Object.values(taskMaps.value.settings))

  const getTask = (taskId: StartupWorkloadTask['id']): StartupWorkloadTask | null => {
    return taskMaps.value.main[taskId] ?? taskMaps.value.settings[taskId] ?? null
  }

  const isTaskRunning = (taskId: StartupWorkloadTask['id']): boolean => {
    return getTask(taskId)?.state === 'running'
  }

  const isSectionReady = (sectionId: StartupSectionId): boolean => {
    return SECTION_TASK_IDS[sectionId].every((taskId) => getTask(taskId)?.state === 'completed')
  }

  return {
    runIds,
    mainTasks,
    settingsTasks,
    connected,
    connect,
    disconnect,
    getTask,
    isTaskRunning,
    isSectionReady
  }
})
