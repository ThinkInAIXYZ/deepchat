import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { spawn } from 'node:child_process'
import { afterEach, expect, it, vi } from 'vitest'
import { terminateProcessTree } from '@/agent/shared/process/processTree'
import { UserPluginHooks } from '@/plugin/userPluginHooks'
import type { DeepChatTapeEntryRow, TapeAnchorAppendInput } from '@/tape/domain/entry'

vi.mock('node:child_process', () => ({ spawn: vi.fn() }))
vi.mock('@/agent/shared/process/processTree', () => ({ terminateProcessTree: vi.fn() }))

afterEach(() => vi.restoreAllMocks())

it.each([false, true])(
  'keeps Tape owned until actual child closure when termination rejects=%s',
  async (terminationFails) => {
    const child = Object.assign(new EventEmitter(), {
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr: new PassThrough()
    })
    vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>)
    if (terminationFails)
      vi.mocked(terminateProcessTree).mockRejectedValue(new Error('Kill failed'))
    else vi.mocked(terminateProcessTree).mockResolvedValue(true)
    const rows: DeepChatTapeEntryRow[] = []
    const host = new UserPluginHooks({
      getTapeIncarnationId: () => 'incarnation',
      getBySession: () => rows,
      appendAnchor: (input: TapeAnchorAppendInput) => {
        const row: DeepChatTapeEntryRow = {
          session_id: input.sessionId,
          entry_id: rows.length + 1,
          kind: 'anchor',
          name: input.name,
          source_type: 'runtime_event',
          source_id: input.source?.id ?? null,
          source_seq: input.source?.seq ?? null,
          provenance_key: input.provenanceKey ?? null,
          payload_json: JSON.stringify({ state: input.state }),
          meta_json: '{}',
          created_at: 1
        }
        rows.push(row)
        return row
      }
    })
    host.register({
      pluginId: 'user.closure',
      digest: 'a'.repeat(64),
      root: '/plugin',
      data: '/plugin/data',
      hooks: [{ id: 'input', event: 'UserPromptSubmit', command: 'fixture', timeout: 5 }]
    })
    const accepted = host.accept({
      sessionId: 's',
      messageId: 'm',
      prompt: 'test',
      model: 'test',
      cwd: null
    })
    await vi.waitFor(() => expect(spawn).toHaveBeenCalled())
    let released = false
    const stopping = host.stop().then(() => {
      released = true
    })
    try {
      await vi.waitFor(() => expect(terminateProcessTree).toHaveBeenCalled())
      await Promise.resolve()
      expect(released).toBe(false)
      expect(() => host.start()).toThrow('must drain')
      child.emit('close', null, 'SIGKILL')
      await Promise.all([accepted, stopping])
      expect(host.diagnostics('user.closure')).toMatchObject([{ status: 'failed' }])
      expect(() => host.beginRun('s')).toThrow('stopped')
      host.start()
      expect(() => host.beginRun('s')).not.toThrow()
      host.endRun('s')
    } finally {
      child.emit('close', null, 'SIGKILL')
      await host.stop()
    }
  }
)
