import { createHash, randomUUID } from 'node:crypto'
import type { JsonValue } from '@shared/contracts/json'
import type { DimModelId } from './modelBridge'
import type { DimRuntimeSupervisor } from './runtimeSupervisor'

export interface DimMediaFile {
  name: string
  media_type: string
  data_base64?: string
  node_path?: string
}
export interface DimMediaSubmission {
  category: string
  operation: string
  model?: DimModelId
  params?: { [key: string]: JsonValue }
  files?: DimMediaFile[]
  // Reuse an identity only for the same admission; dim retains its original task.
  client_task_id?: string
}
export interface DimMediaTask {
  task_id: string
  client_task_id: string | null
  remote_handle?: string | null
  state: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'interrupted'
  result: {
    files: Array<{ name: string; media_type: string; bytes: number; sha256: string }>
    data?: JsonValue
  } | null
  error: { code: string; message: string } | null
}

export class DimMediaSubmissionError extends Error {
  constructor(
    readonly clientTaskId: string,
    cause: unknown
  ) {
    super(cause instanceof Error ? cause.message : 'Native media submission failed', { cause })
  }
}

/** Commands and bounded result reads only. dim owns scheduling, persistence and provider I/O. */
export class DimModality {
  constructor(private readonly host: DimRuntimeSupervisor) {}

  async submit(input: DimMediaSubmission, signal?: AbortSignal): Promise<DimMediaTask> {
    signal?.throwIfAborted()
    const client = await this.host.start()
    signal?.throwIfAborted()
    const clientTaskId = input.client_task_id ?? randomUUID()
    const { task } = await client
      .call<{ task: DimMediaTask }>(
        'modality.task.submit',
        {
          ...input,
          client_task_id: clientTaskId
        } as unknown as JsonValue,
        120_000
      )
      .catch((error: unknown) => {
        throw new DimMediaSubmissionError(clientTaskId, error)
      })
    if (signal?.aborted) {
      await this.cancel(task.task_id)
      signal.throwIfAborted()
    }
    return task
  }

  async cancel(taskId: string): Promise<DimMediaTask> {
    return (
      await (
        await this.host.start()
      ).call<{ task: DimMediaTask }>('modality.task.cancel', { task_id: taskId })
    ).task
  }

  async wait(taskId: string, signal?: AbortSignal): Promise<DimMediaTask> {
    const client = await this.host.openConnection()
    let cancelling: Promise<unknown> | undefined
    const cancel = () => {
      cancelling ??= client
        .call('modality.task.cancel', { task_id: taskId })
        .finally(() => client.close())
      void cancelling.catch(() => {})
    }
    signal?.addEventListener('abort', cancel, { once: true })
    try {
      if (signal?.aborted) cancel()
      signal?.throwIfAborted()
      for (;;) {
        // A long wait observes the native task. It never advances or re-submits it.
        const { task } = await client.call<{ task: DimMediaTask }>(
          'modality.task.wait',
          { task_id: taskId, timeout_ms: 600_000 },
          610_000
        )
        signal?.throwIfAborted()
        if (task.state !== 'queued' && task.state !== 'running') return task
      }
    } catch (error) {
      // Cancellation acknowledgement can race the wait reply. Preserve an unknown outcome
      // instead of reporting a confirmed stop when the native cancel command failed.
      await cancelling
      signal?.throwIfAborted()
      throw error
    } finally {
      signal?.removeEventListener('abort', cancel)
      await cancelling?.catch(() => {})
      client.close()
    }
  }

  async readResult(
    task: DimMediaTask,
    name: string,
    maxBytes: number,
    signal?: AbortSignal
  ): Promise<Buffer> {
    if (task.state !== 'succeeded') throw new Error('Native media task has no successful result')
    const file = task.result?.files.find((file) => file.name === name)
    if (
      !Number.isSafeInteger(maxBytes) ||
      maxBytes < 0 ||
      !file ||
      !Number.isSafeInteger(file.bytes) ||
      file.bytes < 0 ||
      file.bytes > maxBytes
    )
      throw new Error('Native media result exceeds its product read limit')
    const client = await this.host.start()
    const chunks: Buffer[] = []
    const digest = createHash('sha256')
    let offset = 0
    while (offset < file.bytes) {
      signal?.throwIfAborted()
      const result = await client.call<{ data_base64: string; eof: boolean }>(
        'modality.task.result',
        { task_id: task.task_id, name, offset, length: Math.min(512 * 1024, file.bytes - offset) }
      )
      const bytes = Buffer.from(result.data_base64, 'base64')
      if (!bytes.length || offset + bytes.length > file.bytes)
        throw new Error('Invalid native media result page')
      chunks.push(bytes)
      digest.update(bytes)
      offset += bytes.length
      if (result.eof !== (offset === file.bytes))
        throw new Error('Native media result ended at an unexpected boundary')
    }
    signal?.throwIfAborted()
    if (digest.digest('hex') !== file.sha256)
      throw new Error('Native media result checksum mismatch')
    return Buffer.concat(chunks, file.bytes)
  }
}
