import { expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { DimModality, DimMediaSubmissionError, type DimMediaTask } from '@/agent/dim/modality'
import { DimConnectionError } from '@/agent/dim/pluginClient'
import type { DimRuntimeSupervisor } from '@/agent/dim/runtimeSupervisor'

it('preserves a failed media submission identity without replaying provider work', async () => {
  const unknown = new DimConnectionError('lost native acknowledgement', 'unknown')
  const call = vi.fn().mockRejectedValue(unknown)
  const media = new DimModality({
    start: async () => ({ call })
  } as unknown as DimRuntimeSupervisor)
  const failed = await media
    .submit({ category: 'image', operation: 'generate', client_task_id: 'admission-id' })
    .catch((error: unknown) => error)
  expect(failed).toBeInstanceOf(DimMediaSubmissionError)
  expect(failed).toMatchObject({ clientTaskId: 'admission-id', cause: unknown })
  expect(call).toHaveBeenCalledTimes(1)
})

it('bounds result reads and rejects content that no longer matches the native digest', async () => {
  const bytes = Buffer.from('native result')
  const call = vi.fn().mockResolvedValue({ data_base64: bytes.toString('base64'), eof: true })
  const start = vi.fn(async () => ({ call }))
  const media = new DimModality({ start } as unknown as DimRuntimeSupervisor)
  const task: DimMediaTask = {
    task_id: 'task',
    client_task_id: null,
    state: 'succeeded',
    error: null,
    result: {
      files: [
        {
          name: 'image.png',
          media_type: 'image/png',
          bytes: bytes.length,
          sha256: createHash('sha256').update(bytes).digest('hex')
        }
      ]
    }
  }
  await expect(media.readResult(task, 'image.png', Number.NaN)).rejects.toThrow('read limit')
  expect(start).not.toHaveBeenCalled()
  expect(await media.readResult(task, 'image.png', 1024)).toEqual(bytes)
  task.result!.files[0].sha256 = '0'.repeat(64)
  await expect(media.readResult(task, 'image.png', 1024)).rejects.toThrow('checksum mismatch')
})

it('reports an unknown cancellation instead of replacing it with a confirmed abort', async () => {
  const unknown = new DimConnectionError('cancel acknowledgement was lost', 'unknown')
  const call = vi.fn().mockRejectedValue(unknown)
  const close = vi.fn()
  const media = new DimModality({
    openConnection: async () => ({ call, close })
  } as unknown as DimRuntimeSupervisor)
  const abort = new AbortController()
  abort.abort(new Error('user cancelled'))
  await expect(media.wait('task', abort.signal)).rejects.toBe(unknown)
  expect(call).toHaveBeenCalledWith('modality.task.cancel', { task_id: 'task' })
  expect(close).toHaveBeenCalled()
})
