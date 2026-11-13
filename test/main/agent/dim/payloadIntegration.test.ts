import { expect, it, vi } from 'vitest'
import { createServer, type ServerResponse } from 'node:http'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { DimRuntimeSupervisor } from '@/agent/dim/runtimeSupervisor'
import { DimModelBridge } from '@/agent/dim/modelBridge'
import { prepareDimPayload } from '@/agent/dim/payload'

vi.unmock('fs')
vi.unmock('node:fs')

it.runIf(process.env.DEEPCHAT_DIM_SMOKE === '1')(
  'passes complete audio bytes beyond the RPC frame limit through native file ingress, validates integrity and cleans transport files',
  async () => {
    const profile = await mkdtemp(path.join(os.tmpdir(), 'dim-large-payload-'))
    const actual = path.join(profile, 'actual')
    const alias = path.join(profile, 'alias')
    await mkdir(actual)
    await symlink(actual, alias, process.platform === 'win32' ? 'junction' : 'dir')
    const audio = Buffer.alloc(18 * 1024 * 1024 + 17, 0x57)
    const expected = createHash('sha256').update(audio).digest('hex')
    let calls = 0
    let held: ServerResponse | undefined
    let cancelled = false
    const server = createServer(async (request, response) => {
      const chunks: Buffer[] = []
      for await (const chunk of request) chunks.push(Buffer.from(chunk))
      const body = JSON.parse(Buffer.concat(chunks).toString())
      const part = body.messages
        .flatMap((message: { content: unknown }) =>
          Array.isArray(message.content) ? message.content : []
        )
        .find((part: { type: string }) => part.type === 'input_audio')
      expect(
        createHash('sha256').update(Buffer.from(part.input_audio.data, 'base64')).digest('hex')
      ).toBe(expected)
      calls++
      if (JSON.stringify(body.messages).includes('hold-large-audio')) {
        held = response
        response.writeHead(200, { 'Content-Type': 'text/event-stream' }).flushHeaders()
        response.once('close', () => {
          cancelled = true
        })
        return
      }
      response
        .writeHead(200, { 'Content-Type': 'text/event-stream' })
        .end(
          `data: ${JSON.stringify({ id: 'large-audio', object: 'chat.completion.chunk', created: 0, model: 'fixture', choices: [{ index: 0, delta: { role: 'assistant', content: 'Full audio received' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`
        )
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const host = new DimRuntimeSupervisor({
      runtimeRoot: path.resolve('runtime/dim'),
      profileRoot: alias,
      nodeExecutable: path.resolve(
        'runtime/node',
        ...(process.platform === 'win32' ? ['node.exe'] : ['bin/node'])
      ),
      nativePlugins: true
    })
    try {
      const bridge = new DimModelBridge(host)
      const model = await bridge.configure({
        key: 'large-payload',
        displayName: 'Large payload',
        connection: {
          driverKind: 'openai-compatible',
          baseUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`,
          auth: { type: 'anonymous' }
        },
        model: {
          modelId: 'fixture',
          displayName: 'Fixture',
          status: 'active',
          capabilities: {
            modalities: ['text', 'audio'],
            toolCalling: false,
            streaming: true,
            structuredOutput: false,
            vision: false,
            audio: true,
            reasoning: false,
            contextWindow: 64000,
            maxOutputTokens: 1000
          }
        }
      })
      const request = {
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: { type: 'base64', mediaType: 'audio/wav', data: audio.toString('base64') }
              }
            ]
          }
        ]
      }
      expect((await bridge.complete(model, request)).text).toBe('Full audio received')
      expect(await readdir(host.payloadRoot)).toEqual([])
      const controller = new AbortController()
      const holding = bridge
        .complete(model, { ...request, system: 'hold-large-audio' }, controller.signal)
        .then(
          () => null,
          (error: unknown) => error
        )
      await expect.poll(() => held !== undefined, { timeout: 10_000 }).toBe(true)
      controller.abort()
      expect(await holding).toBeInstanceOf(Error)
      await expect.poll(() => cancelled, { timeout: 10_000 }).toBe(true)
      expect(await readdir(host.payloadRoot)).toEqual([])
      let text = ''
      for await (const event of bridge.stream(model, request))
        if (event.type === 'text') text += event.content
      expect(text).toBe('Full audio received')
      expect(await readdir(host.payloadRoot)).toEqual([])
      const client = await host.start()
      const staged = await prepareDimPayload(host.payloadRoot, {
        model: { ...model },
        request,
        config: {}
      })
      const reference = (staged.params as { deepchatPayload: { name: string } }).deepchatPayload
      try {
        await writeFile(path.join(host.payloadRoot, reference.name), 'tampered')
        await expect(client.call('deepchat.native.complete', staged.params)).rejects.toThrow(
          'Invalid native file payload'
        )
        await expect(
          client.call('deepchat.native.complete', {
            deepchatPayload: {
              ...reference,
              name: '../escape.json',
              bytes: 8,
              sha256: '0'.repeat(64)
            }
          })
        ).rejects.toThrow('Invalid native file payload')
        expect(calls).toBe(3)
        await host.stop()
        await host.start()
        expect(await readdir(host.payloadRoot)).toEqual([])
      } finally {
        await staged.dispose()
      }
    } finally {
      await host.stop()
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
      await rm(profile, { recursive: true, force: true })
    }
  },
  90_000
)
