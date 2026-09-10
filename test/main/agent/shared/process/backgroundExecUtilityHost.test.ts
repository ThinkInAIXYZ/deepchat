import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const registryMock = vi.hoisted(() => ({
  record: vi.fn(),
  clear: vi.fn(),
  reapStaleOnce: vi.fn().mockResolvedValue(null)
}))

vi.mock('@/agent/shared/process/childProcessRegistry', () => ({
  childProcessRegistry: registryMock
}))

import {
  getParentPortMessagePayload,
  runBackgroundExecUtilityHostIfRequested
} from '@/agent/shared/process/backgroundExecUtilityHost'
import type { BackgroundExecRpcRequest } from '@/agent/shared/process/backgroundExecSessionManager'

describe('backgroundExecUtilityHost', () => {
  const request: BackgroundExecRpcRequest = {
    type: 'background-exec:request',
    id: 'rpc-1',
    method: 'list',
    args: ['conversation-1']
  }

  beforeEach(() => {
    registryMock.record.mockReset()
    registryMock.clear.mockReset()
    registryMock.reapStaleOnce.mockReset().mockResolvedValue(null)
  })

  afterEach(() => {
    vi.useRealTimers()
    delete process.env.DEEPCHAT_EXEC_UTILITY_HOST
    delete (process as NodeJS.Process & { parentPort?: unknown }).parentPort
  })

  it('keeps raw RPC payloads for unit-test and mock callers', () => {
    expect(getParentPortMessagePayload(request)).toBe(request)
  })

  it('unwraps Electron parentPort MessageEvent payloads', () => {
    expect(getParentPortMessagePayload({ data: request })).toBe(request)
  })

  it('reaps stale background-exec child processes when the host runs', () => {
    vi.useFakeTimers()
    process.env.DEEPCHAT_EXEC_UTILITY_HOST = '1'
    const parentPort = {
      postMessage: vi.fn(),
      on: vi.fn(),
      start: vi.fn()
    }
    Object.defineProperty(process, 'parentPort', { configurable: true, value: parentPort })

    expect(runBackgroundExecUtilityHostIfRequested()).toBe(true)
    expect(registryMock.reapStaleOnce).toHaveBeenCalledWith('background-exec')
  })

  it('keeps shell environment helper on the utility-safe logger', async () => {
    const { readFileSync } = await vi.importActual<typeof import('node:fs')>('node:fs')
    const source = readFileSync(
      path.join(process.cwd(), 'src/main/agent/shared/process/shellEnvHelper.ts'),
      'utf8'
    )

    expect(source).toContain("from './backgroundExecLogger'")
    expect(source).not.toContain('@shared/logger')
  })
})
