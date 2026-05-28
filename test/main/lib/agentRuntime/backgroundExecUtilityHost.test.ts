import { describe, expect, it } from 'vitest'
import { getParentPortMessagePayload } from '@/lib/agentRuntime/backgroundExecUtilityHost'
import type { BackgroundExecRpcRequest } from '@/lib/agentRuntime/backgroundExecSessionManager'

describe('backgroundExecUtilityHost', () => {
  const request: BackgroundExecRpcRequest = {
    type: 'background-exec:request',
    id: 'rpc-1',
    method: 'list',
    args: ['conversation-1']
  }

  it('keeps raw RPC payloads for unit-test and mock callers', () => {
    expect(getParentPortMessagePayload(request)).toBe(request)
  })

  it('unwraps Electron parentPort MessageEvent payloads', () => {
    expect(getParentPortMessagePayload({ data: request })).toBe(request)
  })
})
