import { expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { DimRuntimeSupervisor } from '@/agent/dim/runtimeSupervisor'

// Explicit smoke target: no network requests or runtime downloads during tests.
it.runIf(process.env.DEEPCHAT_DIM_SMOKE === '1')(
  'runs through the injected plugins and restores committed content',
  async () => {
    const profile = await mkdtemp(path.join(os.tmpdir(), 'dc-dim-native-'))
    const runtime = new DimRuntimeSupervisor({
      runtimeRoot: path.resolve('runtime/dim'),
      profileRoot: profile,
      nodeExecutable: path.resolve(
        'runtime/node',
        ...(process.platform === 'win32' ? ['node.exe'] : ['bin', 'node'])
      ),
      profile: 'mock'
    })
    try {
      const [client, sameClient] = await Promise.all([runtime.start(), runtime.start()])
      expect(sameClient).toBe(client)
      expect(await client.call('deepchat.host.capabilities')).toMatchObject({
        apiVersion: 1,
        plugin: 'deepchat-host'
      })
      expect(await client.call('deepchat.storage.capabilities')).toMatchObject({
        apiVersion: 1,
        plugin: 'deepchat-storage'
      })
      const { sessionId } = await client.call<{ sessionId: string }>('deepchat.host.launch', {
        cwd: profile
      })
      const ref = { sessionId, branchId: 'main' }
      const submissionId = randomUUID()

      expect(await client.call('deepchat.host.lookup', { ...ref, submissionId })).toEqual({
        status: 'unknown'
      })
      const receipt = await client.call('deepchat.host.input', {
        ...ref,
        mode: 'queue',
        submissionId,
        rawBlocks: [],
        content: [{ type: 'text', text: 'DeepChat dim integration' }]
      })
      expect(receipt).toMatchObject({ inputId: expect.any(String), sequence: expect.any(Number) })
      await client.call('deepchat.host.idle', ref)
      expect(await client.call('deepchat.host.lookup', { ...ref, submissionId })).toMatchObject({
        status: 'accepted',
        ...(receipt as object)
      })
      type History = {
        through: number
        events: Array<{ type: string; name: string; data: { delta?: string } }>
      }
      const history = await client.call<History>('deepchat.storage.history', {
        ...ref,
        after: 0,
        limit: 100
      })
      expect(
        history.events.some(
          (event) =>
            event.name === 'text' && event.data.delta?.includes('Echo: DeepChat dim integration')
        )
      ).toBe(true)
      expect(history.events.at(-1)).toMatchObject({
        type: 'turn',
        name: 'end',
        data: { status: 'completed' }
      })
      await expect(
        client.call('deepchat.storage.history', { ...ref, limit: 1000 })
      ).rejects.toMatchObject({ data: { appError: 'invalid_params' } })
      await runtime.stop()
      const restored = await runtime.start()
      const page = await restored.call('deepchat.storage.history', {
        ...ref,
        after: 0,
        through: history.through,
        limit: 100
      })
      expect(page).toEqual(history)
      expect(await restored.call('deepchat.host.lookup', { ...ref, submissionId })).toMatchObject({
        status: 'accepted'
      })
      await restored.call('deepchat.host.stop', ref)
    } finally {
      await runtime.stop()
      await rm(profile, { recursive: true, force: true })
    }
  },
  60_000
)

it.runIf(process.env.DEEPCHAT_DIM_SMOKE === '1')(
  'boots the production profile with its injected plugins without an account login',
  async () => {
    const profile = await mkdtemp(path.join(os.tmpdir(), 'dc-dim-product-'))
    const runtime = new DimRuntimeSupervisor({
      runtimeRoot: path.resolve('runtime/dim'),
      profileRoot: profile,
      nodeExecutable: path.resolve(
        'runtime/node',
        ...(process.platform === 'win32' ? ['node.exe'] : ['bin', 'node'])
      )
    })
    try {
      const client = await runtime.start()
      expect(await client.call('deepchat.host.capabilities')).toMatchObject({
        plugin: 'deepchat-host',
        apiVersion: 1
      })
      expect(await client.call('deepchat.storage.capabilities')).toMatchObject({
        plugin: 'deepchat-storage',
        apiVersion: 1
      })
    } finally {
      await runtime.stop()
      await rm(profile, { recursive: true, force: true })
    }
  },
  60_000
)
