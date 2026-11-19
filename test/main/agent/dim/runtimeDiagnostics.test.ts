import { expect, it, vi } from 'vitest'
import { createDimRuntimeDiagnostic, redactDimStderr } from '@/agent/dim/runtimeDiagnostics'

it('masks provider credentials in a native crash tail', () => {
  const tail = redactDimStderr(
    [
      'ERROR request failed: Authorization: Bearer sk-live-1234567890abcdef',
      'WARN config {"api_key":"sk-proj-abcdefghijklmnop","model":"gpt"}',
      'token=ghp_secretvalue other=keep',
      'panicked at src/main.rs:12'
    ].join('\n')
  )
  expect(tail).not.toMatch(/1234567890abcdef|abcdefghijklmnop|ghp_secretvalue/)
  expect(tail).toContain('panicked at src/main.rs:12')
  expect(tail).toContain('other=keep')
})

it('logs only failure phases', () => {
  const warn = vi.fn()
  const diagnostic = createDimRuntimeDiagnostic({ warn })
  const base = { elapsedMs: 1, pid: 7, exitCode: null, scopes: 0 }
  diagnostic({ ...base, phase: 'spawned' })
  expect(warn).not.toHaveBeenCalled()
  diagnostic({
    ...base,
    phase: 'exited',
    exitCode: 101,
    detail: 'dim host exited with 101',
    stderr: 'Bearer sk-crash-1234567890abcd\nthread main panicked'
  })
  expect(warn).toHaveBeenCalledWith('[dim] native host failure', {
    phase: 'exited',
    detail: 'dim host exited with 101',
    pid: 7,
    exitCode: 101,
    elapsedMs: 1,
    stderr: 'Bearer ***\nthread main panicked'
  })
})
