import { randomUUID } from 'node:crypto'
import log from 'electron-log'
import type { IConfigPresenter, INotificationPresenter, IWindowPresenter } from '@shared/presenter'
import { DEEPLINK_EVENTS } from '@/events'
import {
  SCHEDULED_TASKS_VERSION,
  SCHEDULED_TASK_DEFAULT_AGENT_ID,
  type ScheduledTask,
  type ScheduledTaskAction,
  type ScheduledTasksSettings
} from '@shared/scheduledTasks'
import type { z } from 'zod'
import {
  scheduledTaskActionSchema,
  scheduledTaskTriggerSchema,
  type scheduledTasksUpsertInputSchema
} from '@shared/contracts/routes/scheduledTasks.routes'
import { computeNextFireAt, shouldBackfillOneShot } from './normalize'

const MAX_TIMEOUT_MS = 12 * 60 * 60 * 1000 // 12h chained-timeout cap
const RECENT_DRIFT_TOLERANCE_MS = 60 * 1000 // forgive up to 1m clock drift

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

export interface ScheduledTasksServiceDeps {
  configPresenter: Pick<
    IConfigPresenter,
    'getScheduledTasksConfig' | 'setScheduledTasksConfig' | 'getNotificationsEnabled'
  >
  notificationPresenter: Pick<INotificationPresenter, 'showNotification'>
  windowPresenter: Pick<IWindowPresenter, 'sendToWindow' | 'focusMainWindow'> & {
    mainWindow: IWindowPresenter['mainWindow']
  }
  sessionCreator?: SessionCreator
}

export class ScheduledTasksService {
  private readonly configPresenter: ScheduledTasksServiceDeps['configPresenter']
  private readonly notificationPresenter: ScheduledTasksServiceDeps['notificationPresenter']
  private readonly windowPresenter: ScheduledTasksServiceDeps['windowPresenter']
  private sessionCreator: SessionCreator | null
  private readonly timers = new Map<string, NodeJS.Timeout>()
  private started = false

  constructor(deps: ScheduledTasksServiceDeps) {
    this.configPresenter = deps.configPresenter
    this.notificationPresenter = deps.notificationPresenter
    this.windowPresenter = deps.windowPresenter
    this.sessionCreator = deps.sessionCreator ?? null
  }

  setSessionCreator(creator: SessionCreator | null): void {
    this.sessionCreator = creator
  }

  start(): void {
    if (this.started) {
      return
    }
    this.started = true
    this.runStartupPass()
  }

  stop(): void {
    this.started = false
    for (const timer of this.timers.values()) {
      clearTimeout(timer)
    }
    this.timers.clear()
  }

  list(): ScheduledTasksSettings {
    return this.configPresenter.getScheduledTasksConfig()
  }

  upsert(input: ScheduledTasksUpsertInput): {
    task: ScheduledTask
    settings: ScheduledTasksSettings
  } {
    const now = Date.now()
    const current = this.list()
    const existingIndex = input.id ? current.tasks.findIndex((task) => task.id === input.id) : -1
    const existing = existingIndex >= 0 ? current.tasks[existingIndex] : null

    const trigger = scheduledTaskTriggerSchema.parse(input.trigger)
    const action = scheduledTaskActionSchema.parse(input.action)

    const triggerChanged = !existing || JSON.stringify(existing.trigger) !== JSON.stringify(trigger)

    const task: ScheduledTask = {
      id: existing?.id ?? input.id ?? randomUUID(),
      name: input.name,
      enabled: input.enabled,
      trigger,
      action,
      createdAt: existing?.createdAt ?? now,
      // Reset lastFiredAt when the trigger changes so a rescheduled one-shot
      // doesn't get skipped on the assumption it has already run.
      lastFiredAt: triggerChanged ? null : (existing?.lastFiredAt ?? null)
    }

    const tasks =
      existingIndex >= 0
        ? current.tasks.map((value, index) => (index === existingIndex ? task : value))
        : [...current.tasks, task]

    const settings = this.persist({ version: SCHEDULED_TASKS_VERSION, tasks })

    this.cancel(task.id)
    if (task.enabled) {
      this.armTask(task, Date.now())
    }

    return { task, settings }
  }

  delete(id: string): ScheduledTasksSettings {
    const current = this.list()
    const next = current.tasks.filter((task) => task.id !== id)
    const settings = this.persist({ version: SCHEDULED_TASKS_VERSION, tasks: next })
    this.cancel(id)
    return settings
  }

  toggle(id: string, enabled: boolean): { task: ScheduledTask; settings: ScheduledTasksSettings } {
    const current = this.list()
    const existing = current.tasks.find((task) => task.id === id)
    if (!existing) {
      throw new Error(`Unknown scheduled task: ${id}`)
    }
    const updated: ScheduledTask = { ...existing, enabled }
    const tasks = current.tasks.map((task) => (task.id === id ? updated : task))
    const settings = this.persist({ version: SCHEDULED_TASKS_VERSION, tasks })

    this.cancel(id)
    if (enabled) {
      this.armTask(updated, Date.now())
    }

    return { task: updated, settings }
  }

  async fireNow(id: string): Promise<{ task: ScheduledTask; settings: ScheduledTasksSettings }> {
    const current = this.list()
    const existing = current.tasks.find((task) => task.id === id)
    if (!existing) {
      throw new Error(`Unknown scheduled task: ${id}`)
    }
    await this.dispatch(existing)
    const settings = this.markFired(existing)
    const refreshed = settings.tasks.find((task) => task.id === id) ?? existing
    return { task: refreshed, settings }
  }

  private runStartupPass(): void {
    const now = Date.now()
    const settings = this.list()
    for (const task of settings.tasks) {
      if (!task.enabled) {
        continue
      }
      if (shouldBackfillOneShot(task, now)) {
        void this.fireAndPersist(task)
        continue
      }
      this.armTask(task, now)
    }
  }

  private armTask(task: ScheduledTask, now: number): void {
    const nextFireAt = computeNextFireAt(task, now - RECENT_DRIFT_TOLERANCE_MS)
    if (!nextFireAt) {
      return
    }

    const delay = Math.max(0, nextFireAt - now)
    if (delay > MAX_TIMEOUT_MS) {
      const timer = setTimeout(() => {
        this.timers.delete(task.id)
        const refreshed = this.list().tasks.find((entry) => entry.id === task.id)
        if (refreshed?.enabled) {
          this.armTask(refreshed, Date.now())
        }
      }, MAX_TIMEOUT_MS)
      this.timers.set(task.id, timer)
      return
    }

    const timer = setTimeout(() => {
      this.timers.delete(task.id)
      const refreshed = this.list().tasks.find((entry) => entry.id === task.id)
      if (!refreshed || !refreshed.enabled) {
        return
      }
      void this.fireAndPersist(refreshed)
    }, delay)
    this.timers.set(task.id, timer)
  }

  private cancel(id: string): void {
    const timer = this.timers.get(id)
    if (timer) {
      clearTimeout(timer)
      this.timers.delete(id)
    }
  }

  private persist(settings: ScheduledTasksSettings): ScheduledTasksSettings {
    return this.configPresenter.setScheduledTasksConfig(settings)
  }

  private markFired(task: ScheduledTask): ScheduledTasksSettings {
    const current = this.list()
    const tasks = current.tasks.map((entry) => {
      if (entry.id !== task.id) {
        return entry
      }
      // One-shot tasks auto-disable on fire so the user notices and can
      // either delete or reschedule.
      const disable = entry.trigger.kind === 'once'
      return {
        ...entry,
        lastFiredAt: Date.now(),
        enabled: disable ? false : entry.enabled
      }
    })
    return this.persist({ version: SCHEDULED_TASKS_VERSION, tasks })
  }

  private async fireAndPersist(task: ScheduledTask): Promise<void> {
    try {
      await this.dispatch(task)
    } catch (error) {
      log.error('[ScheduledTasks] Dispatch failed:', error)
    } finally {
      this.markFired(task)
      if (task.trigger.kind !== 'once') {
        // Re-arm for the next recurring slot using the just-persisted state.
        const refreshed = this.list().tasks.find((entry) => entry.id === task.id)
        if (refreshed?.enabled) {
          this.armTask(refreshed, Date.now())
        }
      }
    }
  }

  private async dispatch(task: ScheduledTask): Promise<void> {
    await this.runAction(task.id, task.action)
  }

  private async runAction(taskId: string, action: ScheduledTaskAction): Promise<void> {
    switch (action.kind) {
      case 'notify':
        await this.notificationPresenter.showNotification({
          id: `scheduled:${taskId}`,
          title: action.title,
          body: action.body
        })
        return
      case 'prompt':
        if (action.autoSend) {
          await this.runPromptAutoSend(taskId, action)
          return
        }
        await this.runPromptDraft(taskId, action)
        return
      default: {
        const _exhaustive: never = action
        throw new Error(`[ScheduledTasks] Unhandled action kind: ${String(_exhaustive)}`)
      }
    }
  }

  private async runPromptDraft(
    taskId: string,
    action: Extract<ScheduledTaskAction, { kind: 'prompt' }>
  ): Promise<void> {
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
  }

  private async runPromptAutoSend(
    taskId: string,
    action: Extract<ScheduledTaskAction, { kind: 'prompt' }>
  ): Promise<void> {
    if (!this.sessionCreator) {
      log.warn('[ScheduledTasks] sessionCreator is not wired; falling back to draft mode')
      await this.runPromptDraft(taskId, action)
      return
    }

    try {
      await this.sessionCreator.createSessionForTask({
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
    } catch (error) {
      log.error('[ScheduledTasks] Failed to create session for task:', error)
      // Fall back so the user still sees something happened.
      await this.runPromptDraft(taskId, action)
    }
  }
}

export {
  computeNextFireAt,
  normalizeScheduledTasksConfig,
  shouldBackfillOneShot
} from './normalize'
