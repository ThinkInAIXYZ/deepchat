/**
 * KnowledgeTaskPresenter - Focused on global task scheduling and sequential execution
 * This class manages a queue of knowledge-related tasks, allowing for efficient processing and management of these tasks.
 */
import {
  IKnowledgeTaskPresenter,
  KnowledgeChunkTask,
  TaskQueueStatus,
  TaskStatusSummary
} from '@shared/presenter'

export class KnowledgeTaskPresenter implements IKnowledgeTaskPresenter {
  private queue: KnowledgeChunkTask[] = []
  private controllers: Map<string, AbortController> = new Map()
  private isProcessing = false
  private currentTask: KnowledgeChunkTask | null = null

  addTask(task: KnowledgeChunkTask): void {
    console.log(`[RAG TASK] Adding task: ${task.id}`)
    this.queue.push(task)
    this.controllers.set(task.id, new AbortController())
    this.processQueue()
  }

  removeTasks(filter: (task: KnowledgeChunkTask) => boolean): void {
    // Remove tasks from the queue
    this.queue = this.queue.filter((task) => {
      if (filter(task)) {
        console.log(`[RAG TASK] Removing queued task: ${task.id}`)
        this.terminateTask(task.id)
        return false
      }
      return true
    })

    // Terminate the currently running task if it matches
    if (this.currentTask && filter(this.currentTask)) {
      console.log(`[RAG TASK] Terminating running task: ${this.currentTask.id}`)
      this.terminateTask(this.currentTask.id)
    }
  }

  // Convenience method: cancel tasks by knowledge base ID (implemented via filter)
  cancelTasksByKnowledgeBase(knowledgeBaseId: string): void {
    this.removeTasks((task) => task.payload.knowledgeBaseId === knowledgeBaseId)
  }

  // Convenience method: cancel tasks by file ID (implemented via filter)
  cancelTasksByFile(fileId: string): void {
    this.removeTasks((task) => task.payload.fileId === fileId)
  }

  // Get task execution status (implemented by traversal, no need to maintain index)
  getTaskStatus(): TaskStatusSummary {
    const status = {
      pending: this.queue.length,
      processing: this.currentTask ? 1 : 0,
      byKnowledgeBase: new Map<string, { pending: number; processing: number }>()
    }

    // Count tasks in the queue (grouped by knowledge base)
    for (const task of this.queue) {
      const kbId = task.payload.knowledgeBaseId
      if (!status.byKnowledgeBase.has(kbId)) {
        status.byKnowledgeBase.set(kbId, { pending: 0, processing: 0 })
      }
      status.byKnowledgeBase.get(kbId)!.pending++
    }

    // Count the currently processing task
    if (this.currentTask) {
      const kbId = this.currentTask.payload.knowledgeBaseId
      if (!status.byKnowledgeBase.has(kbId)) {
        status.byKnowledgeBase.set(kbId, { pending: 0, processing: 0 })
      }
      status.byKnowledgeBase.get(kbId)!.processing++
    }

    return status
  }

  // Check if there are any active tasks
  hasActiveTasks(): boolean {
    return this.queue.length > 0 || this.currentTask !== null
  }

  // Check if there are active tasks for the specified knowledge base
  hasActiveTasksForKnowledgeBase(knowledgeBaseId: string): boolean {
    return (
      this.queue.some((task) => task.payload.knowledgeBaseId === knowledgeBaseId) ||
      this.currentTask?.payload.knowledgeBaseId === knowledgeBaseId
    )
  }

  // Check if there are active tasks for the specified file
  hasActiveTasksForFile(fileId: string): boolean {
    return (
      this.queue.some((task) => task.payload.fileId === fileId) ||
      this.currentTask?.payload.fileId === fileId
    )
  }

  getStatus(): TaskQueueStatus {
    const runningCount = this.currentTask ? 1 : 0
    return {
      totalTasks: this.queue.length + runningCount,
      runningTasks: runningCount,
      queuedTasks: this.queue.length
    }
  }

  destroy(): void {
    console.log('[RAG TASK] Destroying TaskManager, all tasks will be terminated.')
    // Remove all tasks (including current task)
    this.removeTasks(() => true)
    // Clear queue and reset state
    this.queue = []

    // Stop processing loop
    this.isProcessing = false
    // Clear all controllers
    this.controllers.forEach((controller) => controller.abort())
    this.controllers.clear()
  }

  private terminateTask(taskId: string): void {
    const controller = this.controllers.get(taskId)
    if (controller) {
      controller.abort()
      this.controllers.delete(taskId)
    }
  }

  private async processQueue(): Promise<void> {
    if (this.isProcessing) {
      return
    }
    this.isProcessing = true

    while (this.queue.length > 0) {
      const task = this.queue.shift()
      if (!task) {
        continue
      }

      this.currentTask = task
      const controller = this.controllers.get(task.id)

      if (!controller || controller.signal.aborted) {
        console.log(`[RAG TASK] Task ${task.id} was aborted before execution.`)
        task.onTerminate?.()
        this.controllers.delete(task.id)
        this.currentTask = null
        continue
      }

      console.log(`[RAG TASK] Executing task: ${task.id}. Queue size: ${this.queue.length}`)

      try {
        await task.run({ signal: controller.signal })
        if (controller.signal.aborted) {
          task.onTerminate?.()
        } else {
          task.onSuccess?.()
        }
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          console.log(`[RAG TASK] Task ${task.id} aborted during execution.`)
          task.onTerminate?.()
        } else {
          console.error(`[RAG TASK] Task ${task.id} failed with error:`, error)
          task.onError?.(error as Error)
        }
      } finally {
        this.controllers.delete(task.id)
        this.currentTask = null
        console.log(`[RAG TASK] Task ${task.id} finished.`)
      }
    }

    this.isProcessing = false
  }
}
