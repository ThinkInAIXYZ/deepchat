import { afterEach, describe, expect, it } from 'vitest'
import { createServer, type Server, type Socket } from 'node:net'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { DimConnectionError, DimMethodError, DimPluginClient } from '@/agent/dim/pluginClient'

const sockets = new Set<Socket>()
const servers: Server[] = []
const directories: string[] = []
const clients: DimPluginClient[] = []

afterEach(async () => {
  for (const client of clients.splice(0)) client.close()
  for (const socket of sockets) socket.destroy()
  sockets.clear()
  for (const server of servers.splice(0))
    await new Promise<void>((resolve) => server.close(() => resolve()))
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))
  )
})

async function connect(handle: (socket: Socket) => void) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'dc-dim-wire-'))
  directories.push(directory)
  const address =
    process.platform === 'win32'
      ? `\\\\.\\pipe\\dc-dim-test-${randomUUID()}`
      : path.join(directory, 'test.sock')
  const server = createServer((socket) => {
    sockets.add(socket)
    socket.on('error', () => {})
    handle(socket)
  })
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(address, resolve))
  const client = await DimPluginClient.connect(address)
  clients.push(client)
  return client
}

describe('dim local plugin transport', () => {
  it('correlates fragmented replies and notifications without rounding timeline positions', async () => {
    const client = await connect((socket) =>
      socket.once('data', (request) => {
        const { id } = JSON.parse(request.toString())
        socket.write(
          '{"jsonrpc":"2.0","method":"session.event","params":{"sequence":18446744073709551615}}\n'
        )
        socket.write(`{"jsonrpc":"2.0","id":${id},"res`)
        setImmediate(() => socket.write('ult":{"sequence":18446744073709551614,"text":"你好"}}\n'))
      })
    )
    const notices: unknown[] = []
    client.on('notification', (notice) => notices.push(notice))
    expect(await client.call('deepchat.storage.history')).toEqual({
      sequence: '18446744073709551614',
      text: '你好'
    })
    expect(notices).toEqual([
      { method: 'session.event', params: { sequence: '18446744073709551615' } }
    ])
  })

  it('preserves typed method rejection and keeps the connection usable', async () => {
    const client = await connect((socket) =>
      socket.on('data', (request) => {
        const { id, method } = JSON.parse(request.toString())
        socket.write(
          JSON.stringify(
            method === 'invalid'
              ? {
                  jsonrpc: '2.0',
                  id,
                  error: {
                    code: -32602,
                    message: 'Invalid input',
                    data: { appError: 'invalid_params' }
                  }
                }
              : { jsonrpc: '2.0', id, result: {} }
          ) + '\n'
        )
      })
    )
    const error = await client.call('invalid').catch((failure) => failure)
    expect(error).toBeInstanceOf(DimMethodError)
    expect(error.data).toEqual({ appError: 'invalid_params' })
    expect(await client.call('valid')).toEqual({})
  })

  it('rejects unsafe outgoing cursors before writing a request', async () => {
    let requests = 0
    const client = await connect((socket) =>
      socket.on('data', () => {
        requests++
      })
    )
    await expect(
      client.call('deepchat.storage.history', { after: Number.MAX_SAFE_INTEGER + 1 })
    ).rejects.toMatchObject({ outcome: 'not-sent' })
    expect(requests).toBe(0)
  })

  it('treats disconnect after submission as unknown, never an implicit rejection', async () => {
    const client = await connect((socket) => socket.once('data', () => socket.destroy()))
    await expect(client.call('deepchat.host.input')).rejects.toMatchObject({ outcome: 'unknown' })
    await expect(client.call('deepchat.host.input')).rejects.toMatchObject({ outcome: 'not-sent' })
  })

  it('reports a timed out accepted command as unknown and rejects malformed frames', async () => {
    const client = await connect((socket) =>
      socket.once('data', () => {
        setTimeout(() => socket.write('invalid-json\n'), 50)
      })
    )
    const failure = await client.call('deepchat.host.input', {}, 10).catch((error) => error)
    expect(failure).toBeInstanceOf(DimConnectionError)
    expect(failure.outcome).toBe('unknown')
    expect(failure.message).toContain('deepchat.host.input timed out')
    await expect(client.call('deepchat.storage.history')).rejects.toMatchObject({
      outcome: 'unknown'
    })
  })
})
