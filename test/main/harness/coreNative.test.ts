import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { expect, it, vi } from 'vitest'
import { CoreNativeCalls } from '../../../src/harness/core/native'
import { CorePayloadStore } from '../../../src/harness/core/payload'

vi.unmock('fs')
vi.unmock('node:fs')
vi.unmock('path')
vi.unmock('node:path')

it('reserves Native retirement capacity and drains real receipts while fencing queued work', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'rutis-native-window-'))
  const main = await CorePayloadStore.create(directory)
  const core = new CorePayloadStore(main.config, 'core')
  const calls: Array<{ args: unknown; receipt: ReturnType<typeof Promise.withResolvers<void>> }> =
    []
  let stopping = false
  const native = new CoreNativeCalls(
    core,
    async (_method, payload) => {
      const args = await main.decode(payload)
      const receipt = Promise.withResolvers<void>()
      calls.push({ args, receipt })
      await receipt.promise
      return await main.encode(undefined)
    },
    () => stopping
  )
  try {
    const ordinary = Array.from({ length: 14 }, () => native.call('crypto.available', []))
    await vi.waitFor(() => expect(calls).toHaveLength(14))
    const command = {
      operation: 'send',
      id: randomUUID(),
      message: { type: 'START', source: 'original' }
    }
    const queued = native.call('helpers', [command])
    command.message.source = 'changed-after-call'
    const controls = [
      native.call('helpers', [{ operation: 'close' }]),
      native.call('browser', [{ operation: 'cancel', id: randomUUID() }])
    ]
    await vi.waitFor(() => expect(calls).toHaveLength(16))
    calls[0].receipt.resolve()
    await vi.waitFor(() => expect(calls).toHaveLength(17))
    expect(calls[16].args).toMatchObject([{ message: { source: 'original' } }])
    const rejected = expect(native.call('crypto.available', [])).rejects.toThrow('stopping')
    stopping = true
    calls[14].receipt.resolve()
    calls[15].receipt.resolve()
    await rejected
    let drained = false
    const drain = native.drain().then(() => {
      drained = true
    })
    await Promise.resolve()
    expect(drained).toBe(false)
    for (const call of calls) call.receipt.resolve()
    await Promise.all([...ordinary, queued, ...controls])
    await drain
    expect(calls).toHaveLength(17)
  } finally {
    for (const call of calls) call.receipt.resolve()
    await native.drain()
    await core.close()
    await main.close()
    rmSync(directory, { recursive: true, force: true })
  }
})
