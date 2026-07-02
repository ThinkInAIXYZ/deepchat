import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3-multiple-ciphers'
import log from 'electron-log'
import type { IConfigPresenter, INotificationPresenter, IWindowPresenter } from '@shared/presenter'
import { DEEPLINK_EVENTS } from '@/events'
import {
  SCHEDULED_TASK_DEFAULT_AGENT_ID,
  SCHEDULED_TASK_DEFAULT_TIMEZONE,
  SCHEDULED_TASKS_VERSION,
  type ScheduledTask,
  type ScheduledTaskAction,
  type ScheduledTaskRun,
  type ScheduledTasksSettings,
  type SchedulerProcessStatus
} from '@shared/scheduledTasks'
import type { z } from 'zod'
import {
  scheduledTaskActionSchema,
  scheduledTaskTriggerSchema,
  type scheduledTasksUpsertInputSchema
} from '@shared/contracts/routes/scheduledTasks.routes'
import { computeNextRunAt } from './schedulerCore/computeNextRunAt'
import { SQLiteSchedulerStore } from './sqliteSchedulerStore'
import { SchedulerProcessManager } from './schedulerProcessManager'

export type ScheduledTasksUpsertInput = z.input<typeof scheduledTasksUpsertInputSchema>

interface SessionCreator {
  createSessionForTask(input: {
    agentId: string
    message: string
    providerId?: string
    modelId?: string
    systemPrompt?: string
  }): Promise<{ sessionId: string | null }>
}

interface SQLitePresenterPort {
  getDatabase(): Database.Database
  getDatabasePath(): string
  getDatabasePassword(): string | undefined
}

export interface ScheduledTasksServiceDeps {
  configPresenter: Pick<
    IConfigPresenter,
    'getScheduledTasksConfig' | 'setScheduledTasksConfig' | 'getNotificationsEnabled'
  >
  sqlitePresenter: SQLitePresenterPort
  notificationPresenter: Pick<INotificationPresenter, 'showNotification'>
  windowPresenter: Pick<IWindowPresenter, 'sendToWindow' | 'focusMainWindow'> & {
    mainWindow: IWindowPresenter['mainWindow']
  }
  sessionCreator?: SessionCreator
}

interface DispatchResult {
  sessionId?: string
  outputPreview?: string
}

export class ScheduledTasksService {
  private readonly configPresenter: ScheduledTasksServiceDeps['configPresenter']
  private readonly notificationPresenter: ScheduledTasksServiceDeps['notificationPresenter']
  private readonly windowPresenter: ScheduledTasksServiceDeps['windowPresenter']
  private readonly store: SQLiteSchedulerStore
  private readonly processManager: SchedulerProcessManager
  private sessionCreator: SessionCreator | null
  private started = false

  constructor(deps: ScheduledTasksServiceDeps) {
    this.configPresenter = deps.configPresenter
    this.notificationPresenter = deps.notificationPresenter
    this.windowPresenter = deps.windowPresenter
    this.sessionCreator = deps.sessionCreator ?? null
    this.store = new SQLiteSchedulerStore(deps.sqlitePresenter.getDatabase())
    this.migrateConfigTasks()
    this.processManager = new SchedulerProcessManager({
      store: this.store,
      getDatabasePath: () => deps.sqlitePresenter.getDatabasePath(),
      getDatabasePassword: () => deps.sqlitePresenter.getDatabasePassword(),
      executeQueuedRun: async (taskId, runId) => {
        await this.executeQueuedRun(taskId, runId)
      }
    })
  }

  setSessionCreator(creator: SessionCreator | null): void {
    this.sessionCreator = creator
  }

  start(): void {
    if (this.started) {
      return
    }
    this.started = true
    void this.processManager.ensureRunning('startup')
  }

  stop(): void {
    this.started = false
    this.processManager.stop('app_quit')
  }

  onPowerResume(): void {
    if (this.started) {
      void this.processManager.ensureRunning('resume')
    }
  }

  list(): ScheduledTasksSettings {
    return {
      version: SCHEDULED_TASKS_VERSION,
      tasks: this.store.listTasks()
    }
  }

  upsert(input: ScheduledTasksUpsertInput): {
    task: ScheduledTask
    settings: ScheduledTasksSettings
  } {
    const task = this.buildTask(input)
    this.store.upsertTask(task)
    this.processManager.onTaskChanged(task.id)
    return { task, settings: this.list() }
  }

  delete(id: string): ScheduledTasksSettings {
    this.store.deleteTask(id)
    this.processManager.onTaskChanged(id)
    return this.list()
  }

  toggle(id: string, enabled: boolean): { task: ScheduledTask; settings: ScheduledTasksSettings } {
    const existing = this.store.getTask(id)
    if (!existing) {
      throw new Error(`Unknown scheduled task: ${id}`)
    }

    const now = Date.now()
    const updated = this.withNextRunAt(
      {
        ...existing,
        enabled,
        updatedAt: now
      },
      now
    )
    this.store.upsertTask(updated)
    this.processManager.onTaskChanged(id)
    return { task: updated, settings: this.list() }
  }

  async fireNow(id: string): Promise<{ task: ScheduledTask; settings: ScheduledTasksSettings }> {
    const run = this.store.createManualRun(id, Date.now(), 'main-manual')
    await this.executeQueuedRun(id, run.id)
    const task = this.store.getTask(id)
    if (!task) {
      throw new Error(`Unknown scheduled task: ${id}`)
    }
    return { task, settings: this.list() }
  }

  getSchedulerStatus(): SchedulerProcessStatus {
    return this.processManager.getStatus()
  }

  listRuns(taskId: string, limit = 20): ScheduledTaskRun[] {
    return this.store.listRuns(taskId, limit)
  }

  async reconcileNow(): Promise<SchedulerProcessStatus> {
    return await this.processManager.reconcileNow()
  }

  async restartScheduler(): Promise<SchedulerProcessStatus> {
    return await this.processManager.restart()
  }

  async executeQueuedRun(taskId: string, runId: string): Promise<void> {
    const task = this.store.getTask(taskId)
    if (!task) {
      this.store.markRunFailed({
        runId,
        completedAt: Date.now(),
        error: `Scheduled task ${taskId} no longer exists`
      })
      return
    }

    if (!this.store.markRunRunning(runId, Date.now())) {
      return
    }

    try {
      const result = await this.dispatch(task)
      this.store.markRunSuccess({
        runId,
        completedAt: Date.now(),
        sessionId: result.sessionId,
        outputPreview: result.outputPreview
      })
    } catch (error) {
      this.store.markRunFailed({
        runId,
        completedAt: Date.now(),
        error: error instanceof Error ? error.message : String(error)
      })
      throw error
    }
  }

  private migrateConfigTasks(): void {
    if (this.store.hasMigrationApplied()) {
      return
    }
    const settings = this.configPresenter.getScheduledTasksConfig()
    this.store.migrateTasks(settings.tasks)
  }

  private buildTask(input: ScheduledTasksUpsertInput): ScheduledTask {
    const now = Date.now()
    const existing = input.id ? this.store.getTask(input.id) : null
    const trigger = scheduledTaskTriggerSchema.parse(input.trigger)
    const action = scheduledTaskActionSchema.parse(input.action)
    const triggerChanged = !existing || JSON.stringify(existing.trigger) !== JSON.stringify(trigger)

    return this.withNextRunAt(
      {
        id: existing?.id ?? input.id ?? randomUUID(),
        version: SCHEDULED_TASKS_VERSION,
        name: input.name,
        enabled: input.enabled,
        trigger,
        action,
        timezone: existing?.timezone ?? getSystemTimezone(),
        nextRunAt: null,
        lastRunId: existing?.lastRunId ?? null,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        lastFiredAt: triggerChanged ? null : (existing?.lastFiredAt ?? null)
      },
      now
    )
  }

  private withNextRunAt(task: ScheduledTask, referenceTime: number): ScheduledTask {
    return {
      ...task,
      nextRunAt: computeNextRunAt({
        task: { ...task, nextRunAt: null },
        referenceTime
      })
    }
  }

  private async dispatch(task: ScheduledTask): Promise<DispatchResult> {
    return await this.runAction(task.id, task.action)
  }

  private async runAction(taskId: string, action: ScheduledTaskAction): Promise<DispatchResult> {
    switch (action.kind) {
      case 'notify':
        await this.notificationPresenter.showNotification({
          id: `scheduled:${taskId}`,
          title: action.title,
          body: action.body
        })
        return { outputPreview: action.body.slice(0, 200) }
      case 'prompt':
        if (action.autoSend) {
          return await this.runPromptAutoSend(taskId, action)
        }
        return await this.runPromptDraft(taskId, action)
      default: {
        const _exhaustive: never = action
        throw new Error(`[ScheduledTasks] Unhandled action kind: ${String(_exhaustive)}`)
      }
    }
  }

  private async runPromptDraft(
    taskId: string,
    action: Extract<ScheduledTaskAction, { kind: 'prompt' }>
  ): Promise<DispatchResult> {
    const target = this.windowPresenter.mainWindow
    if (target && !target.isDestroyed()) {
      this.windowPresenter.sendToWindow(target.id, DEEPLINK_EVENTS.START, {
        msg: action.message,
        modelId: action.modelId ?? null,
        systemPrompt: action.systemPrompt ?? '',
        mentions: [],
        autoSend: false
      })
      this.windowPresenter.focusMainWindow()
    } else {
      log.warn('[ScheduledTasks] No main window available for prompt draft action')
    }

    await this.notificationPresenter.showNotification({
      id: `scheduled:${taskId}`,
      title: action.title,
      body: action.message.slice(0, 200)
    })
    return { outputPreview: action.message.slice(0, 200) }
  }

  private async runPromptAutoSend(
    taskId: string,
    action: Extract<ScheduledTaskAction, { kind: 'prompt' }>
  ): Promise<DispatchResult> {
    if (!this.sessionCreator) {
      log.warn('[ScheduledTasks] sessionCreator is not wired; falling back to draft mode')
      return await this.runPromptDraft(taskId, action)
    }

    try {
      const result = await this.sessionCreator.createSessionForTask({
        agentId: action.agentId ?? SCHEDULED_TASK_DEFAULT_AGENT_ID,
        message: action.message,
        providerId: action.providerId,
        modelId: action.modelId,
        systemPrompt: action.systemPrompt
      })

      await this.notificationPresenter.showNotification({
        id: `scheduled:${taskId}`,
        title: action.title,
        body: action.message.slice(0, 200)
      })
      return {
        sessionId: result.sessionId ?? undefined,
        outputPreview: action.message.slice(0, 200)
      }
    } catch (error) {
      log.error('[ScheduledTasks] Failed to create session for task:', error)
      return await this.runPromptDraft(taskId, action)
    }
  }
}

function getSystemTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || SCHEDULED_TASK_DEFAULT_TIMEZONE
  } catch {
    return SCHEDULED_TASK_DEFAULT_TIMEZONE
  }
}

export {
  computeNextFireAt,
  normalizeScheduledTasksConfig,
  shouldBackfillOneShot
} from './normalize'
