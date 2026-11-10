import { captureDimProfile } from '@/agent/dim/profileSnapshot'
import { DimProfileBackups } from '@/agent/dim/profileBackups'
import { DimMediaFiles } from '@/agent/dim/mediaFiles'
import { DimSessionControls } from '@/agent/dim/sessionControls'
import { prepareDimPayload } from '@/agent/dim/payload'
import { DimScopes } from '@/agent/dim/scopes'
import { DimContent } from '@/agent/dim/content'
import { DimProjectionStore } from '@/agent/dim/projectionStore'
import { nativeMediaReference } from '@shared/dimMedia'
import { expect, it, vi } from 'vitest'
import { createServer } from 'node:http'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import path from 'node:path'
import os from 'node:os'
import { ModelType } from '@shared/model'
import type { ModelConfig } from '@shared/types/provider'
import type { ProviderSettingsPort } from '@/provider/settings'
import { DimRuntimeSupervisor } from '@/agent/dim/runtimeSupervisor'
import { DimModelBridge } from '@/agent/dim/modelBridge'
import { DimModelCatalog } from '@/agent/dim/modelCatalog'
import { DimProductGateway } from '@/agent/dim/productGateway'
import { DimModality, type DimMediaTask } from '@/agent/dim/modality'
import { DimConnectionError } from '@/agent/dim/pluginClient'
import { DimEmbeddingModels } from '@/agent/dim/embeddingModels'
import { DimMediaModels } from '@/agent/dim/mediaModels'
import { dimDatabase } from './fixtures/database'

vi.unmock('fs')
vi.unmock('node:fs')

interface TaskReply {
  task: DimMediaTask
}
it.runIf(process.env.DEEPCHAT_DIM_SMOKE === '1').each([
  { label: 'standard image, speech, video, transcription and embeddings', desktopVendors: false },
  { label: 'Voice.ai and APIMart protocols with native recovery', desktopVendors: true },
  {
    label: 'media conversations with native loop and file projection',
    desktopVendors: false,
    mediaChat: true
  }
])(
  'runs $label through native dim owners',
  async ({ desktopVendors, mediaChat }) => {
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64'
    )
    const largeReference = Buffer.alloc(18 * 1024 * 1024 + 17, 0x62)
    png.copy(largeReference)
    const referenceBase64 = largeReference.toString('base64')
    const video = Buffer.from('native-video-bytes')
    let videoPollHeld = false
    let resumeVideo = false
    const wave = Buffer.from('RIFF\u0004\u0000\u0000\u0000WAVE')
    const largeWave = Buffer.alloc(18 * 1024 * 1024 + 17, 0x61)
    wave.copy(largeWave)
    let largeTranscriptions = 0
    let heldTranscriptions = 0
    let cancelledTranscriptions = 0
    const requests: Array<{
      url: string
      authorization?: string
      productHeader?: string
      body?: Record<string, unknown>
    }> = []
    let embeddingHeld = false
    let embeddingCancelled = false
    let held = false
    let releaseImage: (() => void) | undefined
    let cancelled = false
    let credential = 'native-media-first'
    let vendorPhase = 'native'
    let heldSpeech = false
    let cancelledSpeech = false
    let apimartSubmissions = 0
    let apimartResume = false
    let apimartPolls = 0
    const apimartTasks = new Map<string, { category: string; hold: boolean }>()
    const fixture = createServer(async (request, response) => {
      const chunks: Buffer[] = []
      for await (const chunk of request) chunks.push(Buffer.from(chunk))
      const body = Buffer.concat(chunks)
      requests.push({
        url: request.url!,
        authorization: request.headers.authorization,
        productHeader: request.headers['x-product-secret'] as string | undefined,
        ...(request.headers['content-type']?.includes('application/json')
          ? { body: JSON.parse(body.toString()) }
          : {})
      })
      if (request.url === '/v1/api/v1/tts/speech')
        throw new Error('Voice.ai base URL was incorrectly versioned')
      if (request.url === '/api/v1/tts/speech') {
        const input = JSON.parse(body.toString())
        expect(input).toMatchObject({
          model: 'voiceai-native-model',
          voice_id: 'selected-voice',
          language: 'fr',
          temperature: 0.4,
          top_p: 0.7
        })
        if (input.text === 'native voice hold') {
          heldSpeech = true
          response.writeHead(200, { 'Content-Type': 'audio/wav' }).flushHeaders()
          response.once('close', () => {
            cancelledSpeech = true
          })
        } else if (input.text === 'native voice json') {
          response
            .writeHead(200, { 'Content-Type': 'application/json' })
            .end(
              JSON.stringify({ audio: { base64: wave.toString('base64'), mime_type: 'audio/wav' } })
            )
        } else if (input.text === 'native voice url') {
          response.writeHead(200, { 'Content-Type': 'application/json' }).end(
            JSON.stringify({
              audio_url: `http://127.0.0.1:${(fixture.address() as { port: number }).port}/native-output/speech`
            })
          )
        } else response.writeHead(200, { 'Content-Type': 'audio/wav' }).end(wave)
        return
      }
      if (
        vendorPhase === 'apimart' &&
        ['/v1/images/generations', '/v1/videos/generations'].includes(request.url!)
      ) {
        const input = JSON.parse(body.toString())
        const id = `compat-${++apimartSubmissions}`
        apimartTasks.set(id, {
          category: request.url!.includes('/images/') ? 'image' : 'video',
          hold: input.prompt.includes('resume') || input.prompt.includes('cancel')
        })
        response
          .writeHead(200, { 'Content-Type': 'application/json' })
          .end(JSON.stringify({ data: [{ task_id: id }] }))
        return
      }
      if (request.url?.startsWith('/v1/tasks/compat-')) {
        apimartPolls++
        const id = request.url.split('/').at(-1)!.split('?')[0]
        const task = apimartTasks.get(id)!
        response.writeHead(200, { 'Content-Type': 'application/json' }).end(
          JSON.stringify({
            data: {
              status: task.hold && !apimartResume ? 'processing' : 'completed',
              result: {
                [`${task.category}s`]: [
                  {
                    url: `http://127.0.0.1:${(fixture.address() as { port: number }).port}/native-output/${task.category}`
                  }
                ]
              }
            }
          })
        )
        return
      }
      if (request.url?.startsWith('/native-output/')) {
        const category = request.url.split('/').at(-1)
        response
          .writeHead(200, {
            'Content-Type':
              category === 'image' ? 'image/png' : category === 'speech' ? 'audio/wav' : 'video/mp4'
          })
          .end(category === 'image' ? png : category === 'speech' ? wave : video)
        return
      }
      if (request.url === '/v1/chat/completions') {
        const input = JSON.parse(body.toString())
        if (input.stream) {
          const images = input.messages.flatMap((message: { role: string; content?: unknown }) =>
            Array.isArray(message.content)
              ? message.content
                  .filter((part) => part.type === 'image_url')
                  .map((part) => ({ role: message.role, url: part.image_url.url }))
              : []
          )
          expect(images).toContainEqual({
            role: 'user',
            url: `data:image/png;base64,${png.toString('base64')}`
          })
          expect(JSON.stringify(input)).not.toContain('imgcache://')
          response
            .writeHead(200, { 'Content-Type': 'text/event-stream' })
            .end(
              `data: ${JSON.stringify({ id: 'vision', object: 'chat.completion.chunk', model: 'vision-chat', choices: [{ index: 0, delta: { role: 'assistant', content: 'Native image history read' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`
            )
        } else {
          response.writeHead(200, { 'Content-Type': 'application/json' }).end(
            JSON.stringify({
              id: 'title',
              object: 'chat.completion',
              model: 'vision-chat',
              choices: [
                {
                  index: 0,
                  message: { role: 'assistant', content: 'Image session' },
                  finish_reason: 'stop'
                }
              ]
            })
          )
        }
        return
      }
      if (request.url === '/v1/images/generations') {
        expect(JSON.parse(body.toString()).prompt).toContain('native image')
        if (JSON.parse(body.toString()).prompt === 'native image hold') {
          held = true
          releaseImage = () =>
            response.end(
              JSON.stringify({ created: 0, data: [{ b64_json: png.toString('base64') }] })
            )
          response.writeHead(200, { 'Content-Type': 'application/json' })
          response.flushHeaders()
          response.once('close', () => {
            cancelled = true
          })
          return
        }
        response.writeHead(200, { 'Content-Type': 'application/json' })
        response.end(JSON.stringify({ created: 0, data: [{ b64_json: png.toString('base64') }] }))
      } else if (request.url === '/v1/images/edits') {
        expect(body.includes(png)).toBe(true)
        response
          .writeHead(200, { 'Content-Type': 'application/json' })
          .end(JSON.stringify({ created: 0, data: [{ b64_json: png.toString('base64') }] }))
      } else if (request.url === '/v1/videos') {
        if (mediaChat && JSON.parse(body.toString()).prompt.startsWith('native video')) {
          expect(body.includes(Buffer.from(referenceBase64))).toBe(true)
        }
        response.writeHead(200, { 'Content-Type': 'application/json' })
        response.end(
          JSON.stringify({
            id: JSON.parse(body.toString()).prompt.includes('resume')
              ? 'native-resume-video'
              : JSON.parse(body.toString()).prompt.includes('cancel')
                ? 'native-cancel-video'
                : 'native-video',
            status: 'queued'
          })
        )
      } else if (
        request.url === '/v1/videos/native-video' ||
        request.url === '/v1/videos/native-resume-video' ||
        request.url === '/v1/videos/native-cancel-video'
      ) {
        videoPollHeld = true
        response.writeHead(200, { 'Content-Type': 'application/json' })
        response.end(
          JSON.stringify({
            status:
              request.url.includes('cancel') || (request.url.includes('resume') && !resumeVideo)
                ? 'in_progress'
                : 'completed'
          })
        )
      } else if (request.url?.endsWith('/content')) {
        response.writeHead(200, { 'Content-Type': 'video/mp4' })
        response.end(video)
      } else if (request.url === '/v1/embeddings') {
        const values = JSON.parse(body.toString()).input as string[]
        if (values[0] === 'native embedding hold') {
          embeddingHeld = true
          response.writeHead(200, { 'Content-Type': 'application/json' })
          response.flushHeaders()
          response.once('close', () => {
            embeddingCancelled = true
          })
          return
        }
        if (values.length > 2 || values[0] === 'input-too-long') {
          response.writeHead(400, { 'Content-Type': 'application/json' })
          response.end(
            JSON.stringify({
              error: {
                message:
                  values[0] === 'input-too-long'
                    ? 'Input text is too long'
                    : 'Too many inputs. Maximum batch size is 2.'
              }
            })
          )
          return
        }
        response.writeHead(200, { 'Content-Type': 'application/json' })
        response.end(
          JSON.stringify({
            object: 'list',
            data: values.map((value, index) => ({
              object: 'embedding',
              index,
              embedding: [1, value.startsWith('vector-') ? Number(value.slice(7)) : 0]
            })),
            usage: { prompt_tokens: values.length, total_tokens: values.length }
          })
        )
      } else if (request.url === '/v1/audio/speech') {
        expect(['native speech', 'native speech large']).toContain(
          JSON.parse(body.toString()).input
        )
        response.writeHead(200, { 'Content-Type': 'audio/wav' })
        response.end(JSON.parse(body.toString()).input === 'native speech large' ? largeWave : wave)
      } else if (request.url === '/v1/audio/transcriptions') {
        expect(body.toString()).toContain('whisper-1')
        if (body.length > 8 * 1024 * 1024) {
          expect(body.includes(largeWave)).toBe(true)
          if (!body.includes(Buffer.from('hold-native-audio'))) largeTranscriptions++
        }
        if (body.includes(Buffer.from('hold-native-audio'))) {
          expect(body.includes(largeWave)).toBe(true)
          heldTranscriptions++
          response.writeHead(200, { 'Content-Type': 'application/json' })
          response.flushHeaders()
          response.once('close', () => {
            cancelledTranscriptions++
          })
          return
        }
        response.writeHead(200, { 'Content-Type': 'application/json' })
        response.end(JSON.stringify({ text: 'native transcription' }))
      } else {
        response.writeHead(404)
        response.end()
      }
    })
    await new Promise<void>((resolve) => fixture.listen(0, '127.0.0.1', resolve))
    const profile = await mkdtemp(path.join(os.tmpdir(), 'dc-dim-media-'))
    const database = dimDatabase()
    let scopes!: DimScopes
    let catalog!: DimModelCatalog
    const gateway = new DimProductGateway({
      resolve: async () => ({
        version: 'empty',
        tools: [],
        execute: async () => {
          throw new Error('No desktop tool execution is allowed')
        }
      }),
      credential: (id, reference, signal) => catalog.credential(id, reference, signal),
      mediaInput: (request, signal) => scopes.mediaInput(request, signal)
    })
    const host = new DimRuntimeSupervisor({
      runtimeRoot: path.resolve('runtime/dim'),
      profileRoot: profile,
      nodeExecutable: path.resolve(
        'runtime/node',
        ...(process.platform === 'win32' ? ['node.exe'] : ['bin', 'node'])
      ),
      nativePlugins: true,
      gatewayAddress: await gateway.start()
    })
    scopes = new DimScopes({ database: database.data, host })
    const provider = {
      id: 'desktop-media',
      name: 'Media fixture',
      apiType: mediaChat ? 'openai-completions' : 'openai',
      enable: true,
      baseUrl: `http://127.0.0.1:${(fixture.address() as { port: number }).port}/v1`,
      apiKey: 'protected-by-product',
      customHeaders: { 'x-product-secret': 'native-media-header-secret' }
    }
    const getModelConfig = (id: string) =>
      ({
        type:
          id === 'gpt-image-1'
            ? ModelType.ImageGeneration
            : id === 'sora-2' || id.startsWith('doubao-seedance-')
              ? ModelType.VideoGeneration
              : id === 'tts-1'
                ? ModelType.TTS
                : id === 'text-embedding-3-small'
                  ? ModelType.Embedding
                  : ModelType.Chat,
        speechRecognition: id === 'whisper-1',
        contextLength: 8192,
        maxTokens: 1024,
        functionCall: false,
        vision: id === 'vision-chat',
        reasoning: false
      }) as ModelConfig
    catalog = new DimModelCatalog({
      settings: {
        getProviderById: () => provider,
        getModelStatus: () => true,
        getModelConfig,
        getProviderModelRouteMetadata: () => undefined,
        getVoiceAiConfig: () => ({
          model: 'voiceai-native-model',
          language: 'fr',
          audioFormat: 'wav',
          temperature: 0.4,
          topP: 0.7,
          agentId: ''
        }),
        getProviderMediaRoute: (_providerId, modelId) => ({
          endpoint: modelId === 'gpt-image-1' ? '/v1/images/generations' : '/v1/videos/generations',
          parameterNames:
            modelId === 'gpt-image-1'
              ? ['size', 'quality', 'output_format']
              : ['seconds', 'aspect_ratio', 'resolution', 'generate_audio', 'image_urls']
        }),
        getCapabilitySnapshot: () =>
          ({
            supportsReasoning: false,
            supportsAudioInput: false,
            reasoningPortrait: null
          }) as ReturnType<ProviderSettingsPort['getCapabilitySnapshot']>
      },
      models: new DimModelBridge(host),
      grants: database.data.dimProviderGrantsTable,
      credential: async () => credential
    })
    const embedding = new DimEmbeddingModels({ models: catalog, bridge: new DimModelBridge(host) })
    const media = new DimModality(host)
    const desktopMedia = new DimMediaModels({
      settings: { getModelConfig },
      models: catalog,
      media
    })
    const wait = async (id: string) => {
      const done = await media.wait(id)
      expect(done.state, JSON.stringify(done.error)).toBe('succeeded')
      expect(JSON.stringify(done)).not.toContain(credential)
      return done
    }
    try {
      let client = await host.start()
      if (mediaChat) {
        const artifacts: Array<{ fileId: string; sha256: string; bytes: number }> = []
        // A media model is selected by an Agent-local native host. The real model
        // remains non-chat; only the conversation alias enters the native loop.
        for (const [modelId, text, mimeType] of [
          ['gpt-image-1', 'native image', 'image/png'],
          ['tts-1', 'native speech', 'audio/wav'],
          ['sora-2', 'native video', 'video/mp4'],
          ['tts-1', 'native speech large', 'audio/wav']
        ]) {
          const alias = await catalog.admit(provider.id, modelId, { session: true })
          const created = await client.call<{ sessionId: string }>('deepchat.host.launch', {
            cwd: profile,
            model: { ...alias },
            tools: []
          })
          const desktopId = `media-chat-${created.sessionId}`
          database.data.newSessionsTable.create(desktopId, 'agent', desktopId, profile)
          database.data.dimSessionBindingsTable.bind(desktopId, created.sessionId)
          const ref = { sessionId: created.sessionId, branchId: 'main' }
          const controls = new DimSessionControls(host)
          if (modelId === 'sora-2') {
            const mismatched = await prepareDimPayload(host.payloadRoot, {
              ...ref,
              branchId: 'other-branch',
              mediaOptions: { video: { references: [{ type: 'image', data: referenceBase64 }] } }
            })
            try {
              await expect(
                client.call('session.deepchat_native.configure', {
                  ...(mismatched.params as Record<
                    string,
                    import('@shared/contracts/json').JsonValue
                  >),
                  ...ref
                })
              ).rejects.toThrow('Invalid native file payload')
            } finally {
              await mismatched.dispose()
            }
          }
          await controls.call('native_configure', ref, {
            config: { temperature: 0.7 },
            mediaOptions: {
              speech: { voice: 'alloy', responseFormat: 'wav' },
              ...(modelId === 'sora-2'
                ? {
                    video: {
                      references: [{ type: 'image', data: referenceBase64, mimeType: 'image/png' }]
                    }
                  }
                : {})
            }
          })
          if (modelId === 'sora-2') {
            const standalone = await desktopMedia.generateVideoStandalone(
              provider.id,
              'native video standalone large',
              modelId,
              { references: [{ type: 'image', data: referenceBase64, mimeType: 'image/png' }] }
            )
            expect(standalone.videos[0].data).toBe(video.toString('base64'))
            const listed = await media.list({ category: 'video', limit: 100 })
            expect(listed.tasks.length).toBeGreaterThan(0)
            expect(JSON.stringify(listed).length).toBeLessThan(64 * 1024)
            expect(listed.tasks.every((task) => !('params' in task))).toBe(true)
            const status = await media.status(listed.tasks[0].task_id)
            expect(status.state).toBe('succeeded')
            expect(status).not.toHaveProperty('params')
            expect(status.has_remote_handle).toBe(true)
            expect(status).not.toHaveProperty('remote_handle')
            const settings = await controls.call<{
              metadata: { deepchatMedia: { deepchatOptionsFile: string } }
            }>('native_settings', ref)
            expect(JSON.stringify(settings).length).toBeLessThan(64 * 1024)
            const fileId = settings.metadata.deepchatMedia.deepchatOptionsFile
            expect(fileId).toBeTypeOf('string')
            const stored = await new DimMediaFiles(host).describe(fileId)
            expect(stored).toMatchObject({
              name: 'media-options.json',
              mediaType: 'application/vnd.deepchat.media-options+json'
            })
            expect(stored.bytes).toBeGreaterThan(4 * 1024 * 1024)
            expect(await readdir(host.payloadRoot)).toEqual([])
            artifacts.push({ fileId, bytes: stored.bytes, sha256: stored.sha256 })
          }
          await client.call('deepchat.host.input', {
            ...ref,
            mode: 'queue',
            submissionId: randomUUID(),
            rawBlocks: [],
            content: [{ type: 'text', text }]
          })
          await client.call('deepchat.host.idle', ref)
          const page = await new DimContent(host).events(
            ref,
            [
              'input/message',
              'input/applied',
              'input/consumed',
              'turn/start',
              'step/text',
              'turn/end'
            ],
            200
          )
          const transcript = { events: page.events.map((item) => item.event).reverse() }
          const ended = transcript.events
            .filter((event) => event.type === 'turn' && event.name === 'end')
            .at(-1)?.data
          expect(
            ended,
            JSON.stringify({ ended, requests: requests.map(({ url }) => url) })
          ).toMatchObject({ status: 'completed' })
          const output = transcript.events.find(
            (event) =>
              event.type === 'step' &&
              event.name === 'text' &&
              String(event.data.delta).includes('imgcache://dim_')
          )
          expect(output).toBeDefined()
          const projection = new DimProjectionStore(database.data)
          const binding = database.data.dimSessionBindingsTable.get(desktopId)!
          for (const event of transcript.events) projection.apply(binding, event)
          const messages = database.data.deepchatMessagesTable.getBySession(desktopId)
          const block = JSON.parse(
            messages.find((message) => message.role === 'assistant')!.content
          )[0]
          expect(block.image_data.mimeType).toBe(mimeType)
          const file = nativeMediaReference(block.image_data.data)!
          expect(file).not.toBeNull()
          expect(file.kind).toBe('file')
          if (file.kind !== 'file') throw new Error('Conversation media has no native Session file')
          const owned = new DimMediaFiles(host)
          const metadata = await owned.describe(file.fileId)
          expect(metadata).toMatchObject({ name: file.name, mediaType: mimeType })
          const hash = createHash('sha256')
          for (let offset = 0; offset < metadata.bytes; ) {
            const page = await owned.readChunk(
              file.fileId,
              offset,
              Math.min(512 * 1024, metadata.bytes - offset)
            )
            expect(page.length).toBeGreaterThan(0)
            hash.update(page)
            offset += page.length
          }
          expect(hash.digest('hex')).toBe(metadata.sha256)
          if (text === 'native speech large') expect(metadata.bytes).toBe(largeWave.length)
          artifacts.push({ fileId: file.fileId, bytes: metadata.bytes, sha256: metadata.sha256 })
          if (modelId === 'gpt-image-1') {
            const vision = await catalog.admit(provider.id, 'vision-chat')
            await controls.call('set_model', ref, { ...vision })
            await client.call('deepchat.host.input', {
              ...ref,
              mode: 'queue',
              submissionId: randomUUID(),
              rawBlocks: [],
              content: [{ type: 'text', text: 'Describe the generated image' }]
            })
            await client.call('deepchat.host.idle', ref)
            const visionOutput = await new DimContent(host).latest(ref, ['turn/end'])
            expect(
              visionOutput.event?.data,
              JSON.stringify({ visionOutput, endpoints: requests.map((request) => request.url) })
            ).toMatchObject({
              status: 'completed'
            })
            expect(
              requests.some(
                (request) => request.url === '/v1/chat/completions' && request.body?.stream === true
              )
            ).toBe(true)
            await controls.call('set_model', ref, { ...alias })
            await client.call('deepchat.host.input', {
              ...ref,
              mode: 'queue',
              submissionId: randomUUID(),
              rawBlocks: [],
              content: [
                { type: 'text', text: 'native image edit' },
                {
                  type: 'image',
                  source: { type: 'url', mediaType: 'image/png', url: block.image_data.data }
                }
              ]
            })
            await client.call('deepchat.host.idle', ref)
            expect(requests.filter((request) => request.url === '/v1/images/edits')).toHaveLength(1)
            const sendMedia = (text: string) =>
              client.call('deepchat.host.input', {
                ...ref,
                mode: 'queue',
                submissionId: randomUUID(),
                rawBlocks: [],
                content: [{ type: 'text', text }]
              })
            await sendMedia('native image hold')
            await expect.poll(() => held, { timeout: 10_000 }).toBe(true)
            await sendMedia('native image queue one')
            await sendMedia('native image queue two')
            releaseImage!()
            await client.call('deepchat.host.idle', ref)
            for (const text of ['native image queue one', 'native image queue two'])
              expect(
                requests.filter(
                  (request) =>
                    typeof request.body?.prompt === 'string' && request.body.prompt.includes(text)
                )
              ).toHaveLength(1)
            held = false
            cancelled = false

            await client.call('deepchat.host.input', {
              ...ref,
              mode: 'queue',
              submissionId: randomUUID(),
              rawBlocks: [],
              content: [{ type: 'text', text: 'native image hold' }]
            })
            await expect.poll(() => held, { timeout: 10_000 }).toBe(true)
            const queued = await client.call<{ inputId: string }>('deepchat.host.input', {
              ...ref,
              mode: 'queue',
              submissionId: randomUUID(),
              rawBlocks: [],
              content: [{ type: 'text', text: 'native image withdrawn' }]
            })
            expect(await controls.call('withdraw', ref, { inputId: queued.inputId })).toMatchObject(
              { status: 'deleted' }
            )
            await client.call('deepchat.host.stop', ref)
            await client.call('deepchat.host.idle', ref)
            await expect.poll(() => cancelled, { timeout: 10_000 }).toBe(true)
            const listed = await client.call<{ tasks: DimMediaTask[] }>('modality.task.list', {
              category: 'image',
              limit: 100
            })
            const owned = listed.tasks.filter((task) =>
              task.client_task_id?.startsWith(`deepchat/media/${created.sessionId}/`)
            )
            expect(owned.filter((task) => task.state === 'cancelled')).toHaveLength(1)
            expect(owned.every((task) => ['succeeded', 'cancelled'].includes(task.state))).toBe(
              true
            )
            expect(new Set(owned.map((task) => task.client_task_id)).size).toBe(owned.length)
            expect(
              requests.some((request) => request.body?.prompt === 'native image withdrawn')
            ).toBe(false)
            const history = await client.call<{ through: string | number }>(
              'deepchat.storage.history',
              { ...ref, after: '0', limit: 200 }
            )
            const fork = await controls.call<{ sessionId: string }>('fork', ref, {
              at: String(history.through)
            })
            const scope = await client.call<{ ownedPaths: string[] }>('deepchat.storage.scope', {
              sessionId: fork.sessionId
            })
            expect(scope.ownedPaths.some((owned) => path.basename(owned) === file.fileId)).toBe(
              true
            )
            await client.call('deepchat.host.delete', { sessionId: created.sessionId })
            expect(await new DimMediaFiles(host).describe(file.fileId)).toMatchObject({
              sha256: metadata.sha256
            })
          }
        }
        await host.stop()
        client = await host.start()
        const recoveredVideos = await media.list({ category: 'video', limit: 100 })
        expect(recoveredVideos.tasks).toHaveLength(2)
        expect(recoveredVideos.tasks.every((task) => task.state === 'succeeded')).toBe(true)
        expect(recoveredVideos.tasks.every((task) => task.has_remote_handle)).toBe(true)
        expect(JSON.stringify(recoveredVideos).length).toBeLessThan(64 * 1024)
        expect(requests.filter((request) => request.url === '/v1/videos')).toHaveLength(2)
        const before = await media.list({ limit: 100 })
        await host.stop()
        const identity = JSON.parse(
          await readFile(path.resolve('runtime/dim/plugins/native-host-lock.json'), 'utf8')
        )
        const snapshot = await captureDimProfile(path.join(profile, 'dim'), os.tmpdir(), identity)
        const target = new DimRuntimeSupervisor({
          runtimeRoot: path.resolve('runtime/dim'),
          profileRoot: path.join(profile, 'receiver'),
          nativePlugins: true,
          nodeExecutable: path.resolve(
            'runtime/node',
            ...(process.platform === 'win32' ? ['node.exe'] : ['bin', 'node'])
          )
        })
        try {
          const manifest = await snapshot.manifest()
          await target.withStopped(async () => {
            const prepared = await new DimProfileBackups({
              runtimeRoot: path.resolve('runtime/dim'),
              profileRoot: path.join(profile, 'receiver'),
              temporaryRoot: os.tmpdir(),
              host: target,
              readers: () => {
                throw new Error('Media merge must remain cold')
              }
            }).prepareMerge(snapshot.directory, manifest)
            try {
              const installed = await prepared.install()
              await installed.commit()
            } finally {
              await prepared.dispose()
            }
          })
          const restored = new DimMediaFiles(target)
          for (const artifact of artifacts) {
            expect(await restored.describe(artifact.fileId)).toMatchObject({
              bytes: artifact.bytes,
              sha256: artifact.sha256
            })
            const hash = createHash('sha256')
            for (let offset = 0; offset < artifact.bytes; ) {
              const page = await restored.readChunk(
                artifact.fileId,
                offset,
                Math.min(512 * 1024, artifact.bytes - offset)
              )
              expect(page.length).toBeGreaterThan(0)
              hash.update(page)
              offset += page.length
            }
            expect(hash.digest('hex')).toBe(artifact.sha256)
          }
          const receiver = await target.start()
          await expect(
            receiver.call('modality.task.status', { task_id: before.tasks[0].task_id })
          ).rejects.toThrow()
        } finally {
          await target.stop()
          await snapshot.dispose()
        }
        return
      }
      if (!desktopVendors) {
        const imageModel = await catalog.admit(provider.id, 'gpt-image-1')
        const speechModel = await catalog.admit(provider.id, 'tts-1')
        const transcriptionModel = await catalog.admit(provider.id, 'whisper-1')
        expect(imageModel.providerId).not.toBe('openai')
        await expect(
          client.call('deepchat.host.launch', { cwd: profile, model: { ...imageModel } })
        ).rejects.toThrow()
        expect(requests).toHaveLength(0)
        const submission = {
          category: 'image',
          operation: 'generate',
          model: { ...imageModel },
          params: { prompt: 'native image first', outputFormat: 'png' },
          client_task_id: randomUUID()
        }
        const image = await client.call<TaskReply>('modality.task.submit', submission)
        const imageResult = await wait(image.task.task_id)
        expect(
          (await client.call<TaskReply>('modality.task.submit', submission)).task.task_id
        ).toBe(image.task.task_id)
        expect(requests.filter((request) => request.url === '/v1/images/generations')).toHaveLength(
          1
        )
        const file = imageResult.result!.files[0]
        expect(await media.readResult(imageResult, file.name, 1024 * 1024)).toEqual(png)
        const speech = await client.call<TaskReply>('modality.task.submit', {
          category: 'speech',
          operation: 'synthesize',
          model: { ...speechModel },
          params: { text: 'native speech', voice: 'alloy', outputFormat: 'wav' }
        })
        await wait(speech.task.task_id)
        const transcription = await client.call<TaskReply>('modality.task.submit', {
          category: 'speech',
          operation: 'transcribe',
          model: { ...transcriptionModel },
          files: [
            { name: 'sample.wav', media_type: 'audio/wav', data_base64: wave.toString('base64') }
          ]
        })
        const transcribed = await wait(transcription.task.task_id)
        expect(transcribed.result?.data).toMatchObject({ text: 'native transcription' })
        const inputRoot = path.join(profile, 'dim/deepchat-media-inputs')
        const retainedInputs = async () =>
          (await readdir(inputRoot)).filter((name) => /^[0-9a-f-]{36}$/.test(name))
        expect(
          await desktopMedia.transcribeAudioStandalone(
            provider.id,
            'whisper-1',
            largeWave.toString('base64'),
            'audio/wav',
            'large.wav'
          )
        ).toBe('native transcription')
        expect(largeTranscriptions).toBe(1)
        await expect.poll(retainedInputs, { timeout: 10_000 }).toEqual([])
        expect(await readdir(host.payloadRoot)).toEqual([])
        const heldAudio = {
          category: 'speech',
          operation: 'transcribe',
          params: { prompt: 'hold-native-audio' },
          model: transcriptionModel,
          client_task_id: randomUUID(),
          files: [
            { name: 'hold.wav', media_type: 'audio/wav', data_base64: largeWave.toString('base64') }
          ]
        }
        const heldAudioTask = await media.submit(heldAudio)
        await expect.poll(() => heldTranscriptions, { timeout: 10_000 }).toBe(1)
        expect((await media.submit(heldAudio)).task_id).toBe(heldAudioTask.task_id)
        expect(heldTranscriptions).toBe(1)
        expect(await retainedInputs()).toHaveLength(1)
        await media.cancel(heldAudioTask.task_id)
        await expect.poll(() => cancelledTranscriptions, { timeout: 10_000 }).toBe(1)
        await expect.poll(retainedInputs, { timeout: 10_000 }).toEqual([])
        expect(
          requests.every((request) => request.authorization === 'Bearer native-media-first')
        ).toBe(true)
        const generated = await desktopMedia.generateImageStandalone(
          provider.id,
          'native image desktop facade',
          'gpt-image-1',
          {
            quality: 'high',
            background: 'opaque',
            moderation: 'low',
            outputFormat: 'png',
            size: '1024x1024'
          }
        )
        expect(generated).toMatchObject({
          providerId: provider.id,
          modelId: 'gpt-image-1',
          images: [{ data: png.toString('base64'), mimeType: 'image/png' }]
        })
        expect(
          requests.findLast((request) => request.url === '/v1/images/generations')?.body
        ).toMatchObject({
          prompt: 'native image desktop facade',
          quality: 'high',
          background: 'opaque',
          moderation: 'low',
          output_format: 'png'
        })
        const spoken = await desktopMedia.generateSpeechStandalone(
          provider.id,
          'native speech',
          'tts-1',
          {
            voice: 'alloy',
            responseFormat: 'wav',
            speed: 1.25
          }
        )
        expect(spoken.audio).toEqual({ data: wave.toString('base64'), mimeType: 'audio/wav' })
        expect(
          requests.findLast((request) => request.url === '/v1/audio/speech')?.body
        ).toMatchObject({
          input: 'native speech',
          voice: 'alloy',
          response_format: 'wav',
          speed: 1.25
        })
        expect(
          await desktopMedia.transcribeAudioStandalone(
            provider.id,
            'whisper-1',
            wave.toString('base64'),
            'Audio/WAV',
            'C:\\recordings\\sample.wav'
          )
        ).toBe('native transcription')
        const generatedVideo = await desktopMedia.generateVideoStandalone(
          provider.id,
          'native video facade',
          'sora-2',
          {
            seconds: '8',
            size: '1280x720',
            ratio: '16:9',
            resolution: '720p',
            watermark: false,
            generateAudio: true,
            inputReference: { data: 'AQID', mimeType: 'image/png' },
            references: [{ type: 'image', url: 'https://example.com/reference.png' }]
          }
        )
        expect(generatedVideo.videos).toEqual([
          { data: video.toString('base64'), mimeType: 'video/mp4' }
        ])
        expect(requests.findLast((request) => request.url === '/v1/videos')?.body).toMatchObject({
          model: 'sora-2',
          prompt: 'native video facade',
          seconds: '8',
          size: '1280x720',
          input_reference: { data: 'AQID', mime_type: 'image/png' },
          extra_body: {
            ratio: '16:9',
            resolution: '720p',
            watermark: false,
            generate_audio: true,
            content: [
              {
                type: 'image_url',
                image_url: { url: 'https://example.com/reference.png' },
                role: 'reference_image'
              }
            ]
          }
        })
        await desktopMedia.generateVideoStandalone(
          provider.id,
          'native video flat',
          'doubao-seedance-2',
          { seconds: '5', ratio: '16:9', generateAudio: false }
        )
        const flatVideo = requests.findLast((request) => request.url === '/v1/videos')?.body
        expect(flatVideo).toMatchObject({
          model: 'doubao-seedance-2',
          duration: 5,
          ratio: '16:9',
          generate_audio: false
        })
        expect(flatVideo).not.toHaveProperty('extra_body')
        const cancelledVideo = await media.submit({
          category: 'video',
          operation: 'generate',
          model: await catalog.admit(provider.id, 'sora-2'),
          params: { prompt: 'native video cancel' }
        })
        await expect
          .poll(
            async () =>
              (
                await client.call<TaskReply>('modality.task.status', {
                  task_id: cancelledVideo.task_id
                })
              ).task.remote_handle,
            { timeout: 10_000 }
          )
          .toBeTruthy()
        expect(await client.call('deepchat.storage.readiness')).toMatchObject({
          idle: false,
          media: true
        })
        let accessedProfile = false
        await expect(
          host.withStopped(
            async () => {
              accessedProfile = true
            },
            { ifIdle: true }
          )
        ).rejects.toMatchObject({ data: { appError: 'daemon_busy' } })
        expect(accessedProfile).toBe(false)
        expect((await media.cancel(cancelledVideo.task_id)).state).toBe('cancelled')
        videoPollHeld = false
        const videoModel = await catalog.admit(provider.id, 'sora-2')
        const resumable = await media.submit({
          category: 'video',
          operation: 'generate',
          model: videoModel,
          params: { prompt: 'native video resume' }
        })
        await expect.poll(() => videoPollHeld, { timeout: 10_000 }).toBe(true)
        await expect
          .poll(
            async () =>
              (await client.call<TaskReply>('modality.task.status', { task_id: resumable.task_id }))
                .task.remote_handle,
            { timeout: 10_000 }
          )
          .toBeTruthy()
        await host.stop()
        resumeVideo = true
        client = await host.start()
        const resumed = await wait(resumable.task_id)
        expect(await media.readResult(resumed, resumed.result!.files[0].name, 1024)).toEqual(video)
        expect(
          requests.filter(
            (request) =>
              request.url === '/v1/videos' && request.body?.prompt === 'native video resume'
          )
        ).toHaveLength(1)
        const values = Array.from({ length: 35 }, (_, index) => `vector-${index}`)
        expect(
          await embedding.getEmbeddings(provider.id, 'text-embedding-3-small', values)
        ).toEqual(values.map((_, index) => [1, index]))
        expect(await embedding.getDimensions(provider.id, 'text-embedding-3-small')).toEqual({
          data: { dimensions: 2, normalized: true }
        })
        const beforeLongInput = requests.filter(
          (request) => request.url === '/v1/embeddings'
        ).length
        await expect(
          embedding.getEmbeddings(provider.id, 'text-embedding-3-small', ['input-too-long'])
        ).rejects.toThrow('Native embedding request failed')
        expect(requests.filter((request) => request.url === '/v1/embeddings').length).toBe(
          beforeLongInput + 1
        )
        const embeddingAbort = new AbortController()
        const embeddingWait = embedding
          .getEmbeddings(
            provider.id,
            'text-embedding-3-small',
            ['native embedding hold'],
            embeddingAbort.signal
          )
          .catch((error: unknown) => error)
        await expect.poll(() => embeddingHeld, { timeout: 10_000 }).toBe(true)
        embeddingAbort.abort(new Error('cancel native embedding'))
        expect(await embeddingWait).toMatchObject({ message: 'cancel native embedding' })
        await expect.poll(() => embeddingCancelled, { timeout: 10_000 }).toBe(true)
        const heldTask = await media.submit({
          ...submission,
          client_task_id: randomUUID(),
          params: { prompt: 'native image hold' }
        })
        const abort = new AbortController()
        const waiting = media.wait(heldTask.task_id, abort.signal).catch((error: unknown) => error)
        await expect.poll(() => held).toBe(true)
        abort.abort(new Error('stop native media'))
        expect(await waiting).toMatchObject({ message: 'stop native media' })
        await expect.poll(() => cancelled).toBe(true)
        expect(
          (await client.call<TaskReply>('modality.task.status', { task_id: heldTask.task_id })).task
            .state
        ).toBe('cancelled')
        // Lose only the product receipt after native admission. Never replay the task.
        const uncertain = new DimModality({
          payloadRoot: host.payloadRoot,
          openConnection: async () => {
            const connection = await host.openConnection()
            return {
              call: async (method: string, params: never, timeout: number) => {
                await connection.call(method, params, timeout)
                throw new DimConnectionError('lost media receipt', 'unknown')
              },
              close: () => connection.close()
            }
          }
        } as unknown as DimRuntimeSupervisor)
        const clientTaskId = randomUUID()
        await expect(
          uncertain.submit({ ...heldAudio, client_task_id: clientTaskId })
        ).rejects.toMatchObject({ clientTaskId })
        await expect.poll(() => heldTranscriptions, { timeout: 10_000 }).toBe(2)
        expect(await retainedInputs()).toHaveLength(1)
        expect(await readdir(host.payloadRoot)).toEqual([])
        const orphan = path.join(inputRoot, randomUUID())
        await mkdir(orphan)
        await writeFile(path.join(orphan, 'input-0'), 'uncommitted input')
        await host.stop()
        credential = 'native-media-rotated'
        client = await host.start()
        await expect.poll(retainedInputs, { timeout: 10_000 }).toEqual([])
        expect(heldTranscriptions).toBe(2)
        expect(
          (await client.call<TaskReply>('modality.task.status', { task_id: image.task.task_id }))
            .task.state
        ).toBe('succeeded')
        // No configure/alias refresh call after restart: reconstruct through the native public owner.
        const restored = await client.call<TaskReply>('modality.task.submit', {
          ...submission,
          client_task_id: randomUUID(),
          params: { prompt: 'native image restored' }
        })
        await wait(restored.task.task_id)
        expect(requests.at(-1)?.authorization).toBe('Bearer native-media-rotated')
      } else {
        provider.apiType = 'voiceai'
        provider.baseUrl = provider.baseUrl.replace(/\/v1$/, '')
        vendorPhase = 'voiceai'
        for (const kind of ['binary', 'json', 'url']) {
          const speech = await desktopMedia.generateSpeechStandalone(
            provider.id,
            `native voice ${kind}`,
            'selected-voice'
          )
          expect(speech.audio).toEqual({ data: wave.toString('base64'), mimeType: 'audio/wav' })
        }
        const voiceTask = await media.submit({
          category: 'speech',
          operation: 'synthesize',
          model: await catalog.admit(provider.id, 'selected-voice'),
          params: { text: 'native voice hold' }
        })
        await expect.poll(() => heldSpeech).toBe(true)
        expect((await media.cancel(voiceTask.task_id)).state).toBe('cancelled')
        await expect.poll(() => cancelledSpeech).toBe(true)
        provider.apiType = 'apimart'
        provider.baseUrl += '/v1'
        vendorPhase = 'apimart'
        const compatImage = await desktopMedia.generateImageStandalone(
          provider.id,
          'native apimart image',
          'gpt-image-1',
          { size: '1536x1024', quality: 'high', outputFormat: 'png', background: 'opaque' }
        )
        expect(compatImage.images[0]).toEqual({
          data: png.toString('base64'),
          mimeType: 'image/png'
        })
        const imageRequest = requests.findLast(
          (request) => request.url === '/v1/images/generations'
        )!.body!
        expect(imageRequest).toMatchObject({
          model: 'gpt-image-1',
          size: '3:2',
          quality: 'high',
          output_format: 'png'
        })
        expect(imageRequest).not.toHaveProperty('background')
        const compatVideo = await desktopMedia.generateVideoStandalone(
          provider.id,
          'native apimart video',
          'sora-2',
          {
            seconds: '5',
            ratio: '16:9',
            resolution: '720p',
            watermark: true,
            generateAudio: false,
            inputReference: { data: 'AQID', mimeType: 'image/png' }
          }
        )
        expect(compatVideo.videos[0]).toEqual({
          data: video.toString('base64'),
          mimeType: 'video/mp4'
        })
        const videoRequest = requests.findLast(
          (request) => request.url === '/v1/videos/generations'
        )!.body!
        expect(videoRequest).toMatchObject({
          seconds: '5',
          aspect_ratio: '16:9',
          resolution: '720p',
          generate_audio: false,
          image_urls: ['data:image/png;base64,AQID']
        })
        expect(videoRequest).not.toHaveProperty('watermark')
        const compatModel = await catalog.admit(provider.id, 'sora-2')
        const compatCancel = await media.submit({
          category: 'video',
          operation: 'generate',
          model: compatModel,
          params: { prompt: 'native apimart cancel' }
        })
        await expect.poll(() => apimartPolls).toBeGreaterThanOrEqual(3)
        expect((await media.cancel(compatCancel.task_id)).state).toBe('cancelled')
        const beforeResume = apimartSubmissions
        const compatResume = await media.submit({
          category: 'video',
          operation: 'generate',
          model: compatModel,
          params: { prompt: 'native apimart resume' }
        })
        await expect
          .poll(
            async () =>
              (
                await client.call<TaskReply>('modality.task.status', {
                  task_id: compatResume.task_id
                })
              ).task.remote_handle
          )
          .toBeTruthy()
        await host.stop()
        apimartResume = true
        client = await host.start()
        const resumedCompat = await media.wait(compatResume.task_id)
        expect(resumedCompat.state).toBe('succeeded')
        expect(apimartSubmissions).toBe(beforeResume + 1)
        expect(
          await media.readResult(resumedCompat, resumedCompat.result!.files[0].name, 1024)
        ).toEqual(video)
        expect(requests.every((request) => request.authorization === `Bearer ${credential}`)).toBe(
          true
        )
      }
      expect(
        requests.every((request) => request.productHeader === 'native-media-header-secret')
      ).toBe(true)
    } finally {
      await host.stop()
      await gateway.stop()
      database.sqlite.close()
      fixture.closeAllConnections()
      await new Promise<void>((resolve) => fixture.close(() => resolve()))
      await rm(profile, { recursive: true, force: true })
    }
  },
  90_000
)
