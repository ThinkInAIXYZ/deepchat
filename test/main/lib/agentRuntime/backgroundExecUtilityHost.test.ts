import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
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

  it('keeps shell environment helper on the utility-safe logger', async () => {
    const { readFileSync } = await vi.importActual<typeof import('node:fs')>('node:fs')
    const source = readFileSync(
      path.join(process.cwd(), 'src/main/lib/agentRuntime/shellEnvHelper.ts'),
      'utf8'
    )

    expect(source).toContain("from './backgroundExecLogger'")
    expect(source).not.toContain('@shared/logger')
  })
})
