export const RUN_CODE_PROTOCOL_VERSION = 1 as const
export const CODE_MODE_TOOL_SERVER_NAME = 'agent-code-mode'
export const RUN_CODE_SOURCE_MAX_BYTES = 256 * 1024
export const RUN_CODE_OUTPUT_MAX_BYTES = 1024 * 1024
export const RUN_CODE_MAX_NESTED_CALLS = 128
export const RUN_CODE_MAX_NESTED_CONCURRENCY = 8

export type RunCodeFrontend = 'codex' | 'function'

export interface RunCodeToolBinding {
  id: string
  name: string
  description: string
  execution: 'parallel' | 'sequential'
}

export type RunCodeParentMessage =
  | {
      type: 'START'
      version: typeof RUN_CODE_PROTOCOL_VERSION
      cellId: string
      frontend: RunCodeFrontend
      source: string
      bindings: RunCodeToolBinding[]
      store: Record<string, unknown>
    }
  | {
      type: 'NESTED_RESULT'
      version: typeof RUN_CODE_PROTOCOL_VERSION
      cellId: string
      callId: string
      ok: boolean
      result?: unknown
      error?: string
    }
  | {
      type: 'RESUME'
      version: typeof RUN_CODE_PROTOCOL_VERSION
      cellId: string
    }
  | {
      type: 'STOP'
      version: typeof RUN_CODE_PROTOCOL_VERSION
      cellId: string
      reason: string
    }

export type RunCodeHostMessage =
  | {
      type: 'READY'
      version: typeof RUN_CODE_PROTOCOL_VERSION
      pid: number
    }
  | {
      type: 'HEARTBEAT'
      version: typeof RUN_CODE_PROTOCOL_VERSION
      cellId?: string
      now: number
    }
  | {
      type: 'NESTED_CALL'
      version: typeof RUN_CODE_PROTOCOL_VERSION
      cellId: string
      callId: string
      bindingId: string
      arguments: unknown
    }
  | {
      type: 'YIELDED'
      version: typeof RUN_CODE_PROTOCOL_VERSION
      cellId: string
      output: unknown[]
    }
  | {
      type: 'RESULT'
      version: typeof RUN_CODE_PROTOCOL_VERSION
      cellId: string
      output: unknown[]
      returnValue?: unknown
      store: Record<string, unknown>
    }
  | {
      type: 'ERROR'
      version: typeof RUN_CODE_PROTOCOL_VERSION
      cellId: string
      error: string
      output?: unknown[]
    }
