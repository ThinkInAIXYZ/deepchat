import { PassThrough } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'

import { LightOcrHelperServer } from '../../../src/main/ocr/lightOcrHelper'

const bundleId = 'ppocrv6-small-native-20260719.1'

function createEngine(close: () => Promise<void>) {
  return {
    info: {
      coreVersion: 'test-core',
      modelBundleId: bundleId,
      execution: {
        requestedProvider: 'cpu',
        sessions: {
          detection: {
            actualProviderChain: ['cpu'],
            precision: 'fp32',
            qualificationId: 'test-detection'
          },
          recognition: {
            actualProviderChain: ['cpu'],
            precision: 'fp32',
            qualificationId: 'test-recognition'
          }
        }
      }
    },
    recognizeEncoded: vi.fn(async () => {
      throw new Error('not used')
    }),
    close
  }
}

describe('LightOcrHelperServer', () => {
  it('uses the upstream auto provider policy without an incompatible session fallback', async () => {
    const stdin = new PassThrough()
    const stdout = new PassThrough()
    const stderr = new PassThrough()
    const createEngineMock = vi.fn(async () => createEngine(async () => undefined))
    const server = new LightOcrHelperServer({
      bundlePath: '/bundle',
      expectedBundleId: bundleId,
      tempRoot: '/private-temp',
      createEngine: createEngineMock,
      stdin,
      stdout,
      stderr
    })
    let output = ''
    stdout.on('data', (chunk) => {
      output += chunk.toString()
    })
    server.start()

    stdin.write(
      `${JSON.stringify({
        type: 'configure',
        id: 'configure-auto',
        backend: 'auto',
        strategy: 'bounded-960'
      })}\n`
    )
    await expect.poll(() => output.includes('configure-auto')).toBe(true)

    expect(createEngineMock).toHaveBeenCalledWith(
      expect.objectContaining({
        execution: {
          provider: 'auto',
          sessionFallback: 'error',
          precision: 'auto',
          performanceHint: 'latency'
        }
      })
    )
    await server.shutdown()
  })

  it('does not create a second resident engine when closing the previous engine fails', async () => {
    const stdin = new PassThrough()
    const stdout = new PassThrough()
    const stderr = new PassThrough()
    const messages: Array<{
      id?: string
      type: string
      error?: { code: string }
    }> = []
    let output = ''
    stdout.on('data', (chunk) => {
      output += chunk.toString()
      let newline = output.indexOf('\n')
      while (newline >= 0) {
        messages.push(JSON.parse(output.slice(0, newline)))
        output = output.slice(newline + 1)
        newline = output.indexOf('\n')
      }
    })

    const close = vi.fn(async () => {
      throw new Error('native close failed')
    })
    const engineFactory = vi.fn(async () => createEngine(close))
    const server = new LightOcrHelperServer({
      bundlePath: '/bundle',
      expectedBundleId: bundleId,
      tempRoot: '/private-temp',
      createEngine: engineFactory,
      stdin,
      stdout,
      stderr
    })
    server.start()

    stdin.write(
      `${JSON.stringify({
        type: 'configure',
        id: 'first',
        backend: 'cpu',
        strategy: 'bounded-960'
      })}\n`
    )
    await expect.poll(() => messages.find((message) => message.id === 'first')?.type).toBe('result')

    stdin.write(
      `${JSON.stringify({
        type: 'configure',
        id: 'second',
        backend: 'cpu',
        strategy: 'tiled-v1'
      })}\n`
    )
    await expect.poll(() => messages.find((message) => message.id === 'second')?.type).toBe('error')

    stdin.write(
      `${JSON.stringify({
        type: 'configure',
        id: 'third',
        backend: 'cpu',
        strategy: 'tiled-v1'
      })}\n`
    )
    await expect.poll(() => messages.find((message) => message.id === 'third')?.type).toBe('error')

    expect(messages.find((message) => message.id === 'second')?.error.code).toBe(
      'engine_close_failed'
    )
    expect(messages.find((message) => message.id === 'third')?.error.code).toBe(
      'engine_close_failed'
    )
    expect(engineFactory).toHaveBeenCalledTimes(1)
    expect(close).toHaveBeenCalledTimes(1)
    await server.shutdown()
  })
})
