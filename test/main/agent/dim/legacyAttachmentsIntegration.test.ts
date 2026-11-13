import { expect, it, vi } from 'vitest'
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import { dimDatabase } from './fixtures/database'
import { DimRuntimeSupervisor } from '@/agent/dim/runtimeSupervisor'
import { DimModelBridge } from '@/agent/dim/modelBridge'
import { DimLegacySource, legacyImageBlocks } from '@/agent/dim/legacySource'
import { DimLegacyMigration } from '@/agent/dim/legacyMigration'
import {
  dimHistoryHash,
  dimHistoryPlan,
  normalizeDimImportedMessage
} from '@/agent/dim/historyImport'
import { DimContent } from '@/agent/dim/content'
import { DimSessionRuntime } from '@/agent/dim/sessionRuntime'
import { DimScopeTransitions } from '@/agent/dim/scopeTransitions'
import type { ChatMessageRecord, UserMessageContent } from '@shared/types/agent-interface'

type WirePart = { type: string; text?: string; image_url?: { url: string } }
type WireMessage = { role: string; content?: string | WirePart[]; tool_calls?: unknown[] }

vi.unmock('fs')
vi.unmock('node:fs')

it.runIf(process.env.DEEPCHAT_DIM_SMOKE === '1')(
  'preserves sanitized legacy attachments through recovery and scope transitions',
  async () => {
    const profile = await mkdtemp(path.join(os.tmpdir(), 'dim-legacy-attachments-'))
    const database = dimDatabase()
    const requests: Array<{ messages: WireMessage[] }> = []
    const server = createServer(async (request, response) => {
      let body = ''
      for await (const chunk of request) body += chunk
      requests.push(JSON.parse(body))
      response.writeHead(200, { 'Content-Type': 'text/event-stream' })
      response.end(
        `data: ${JSON.stringify({ id: 'legacy-attachments', object: 'chat.completion.chunk', model: 'fixture', created: 0, choices: [{ index: 0, delta: { role: 'assistant', content: 'Continuation complete' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`
      )
    })
    const host = new DimRuntimeSupervisor({
      runtimeRoot: path.resolve(process.env.DEEPCHAT_DIM_TEST_RUNTIME_ROOT ?? 'runtime/dim'),
      profileRoot: profile,
      nodeExecutable: path.resolve(
        'runtime/node',
        ...(process.platform === 'win32' ? ['node.exe'] : ['bin/node'])
      ),
      nativePlugins: true
    })
    const productSessionId = 'legacy-attachments'
    const png =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF9sAAAAASUVORK5CYII='
    const imageUrl = `data:image/png;base64,${png}`
    const encoded = (text: string) => Buffer.from(text).toString('base64')
    const skippedPdf = encoded('SKIPPED_PDF_RAW_BYTES')
    const skippedImage = encoded('SKIPPED_IMAGE_RAW_BYTES')
    const ocrImage = encoded('OCR_ORIGINAL_IMAGE_RAW_BYTES')
    const preview = encoded('TOOL_PREVIEW_RAW_BYTES')
    const audio = encoded('AUDIO_RAW_BYTES')
    const missingImagePath = path.join(profile, 'missing-original-image.png')
    const textPath = path.join(profile, 'ordinary-notes.txt')
    const neverRunPath = path.join(profile, 'historical-write-must-not-run.txt')
    const toolParams = JSON.stringify({ path: neverRunPath, content: 'HISTORICAL_WRITE_PAYLOAD' })
    const user: UserMessageContent = {
      text: 'LEGACY_USER_ATTACHMENTS',
      files: [
        {
          name: 'inline.png',
          path: '/old/inline.png',
          type: 'image/png',
          content: imageUrl,
          resolvedRepresentation: { kind: 'image' }
        },
        {
          name: 'embedded.pdf',
          path: '/old/embedded.pdf',
          type: 'application/pdf',
          content: 'PDF_EMBEDDED_TEXT_SENTINEL',
          resolvedRepresentation: { kind: 'embedded_text' }
        },
        {
          name: 'skipped.pdf',
          path: '/old/skipped.pdf',
          type: 'application/pdf',
          content: `data:application/pdf;base64,${skippedPdf}`,
          resolvedRepresentation: { kind: 'unavailable', reason: 'user_skipped_attachment_content' }
        },
        {
          name: 'skipped.png',
          path: '/old/skipped.png',
          type: 'image/png',
          content: `data:image/png;base64,${skippedImage}`,
          resolvedRepresentation: { kind: 'unavailable', reason: 'user_skipped_image_content' }
        },
        {
          name: 'ocr.png',
          path: '/old/ocr.png',
          type: 'image/png',
          content: `data:image/png;base64,${ocrImage}`,
          resolvedRepresentation: {
            kind: 'ocr_text',
            text: 'OCR_SELECTED_TEXT_SENTINEL',
            tokenCount: 8,
            truncated: false
          }
        },
        {
          name: 'ordinary-notes.txt',
          path: textPath,
          type: 'text/plain',
          content: 'ORDINARY_FILE_RAW_CONTENT'
        },
        { name: 'missing-original-image.png', path: missingImagePath, type: 'image/png' },
        { name: 'recording.wav', path: '/old/recording.wav', type: 'audio/wav', content: audio }
      ],
      links: [],
      search: false,
      think: false
    }
    const message = (
      id: string,
      orderSeq: number,
      role: 'user' | 'assistant',
      content: string
    ): ChatMessageRecord => ({
      id,
      sessionId: productSessionId,
      orderSeq,
      role,
      content,
      status: 'sent',
      metadata: '{}',
      isContextEdge: 0,
      createdAt: 1234,
      updatedAt: 1234
    })
    const originals = [
      {
        ...message('legacy-user', 1, 'user', JSON.stringify(user)),
        // Force a genuinely interrupted multi-chunk upload without bloating model context.
        metadata: JSON.stringify({ archiveOnly: '历史🐳'.repeat(70000) })
      },
      message(
        'legacy-assistant',
        2,
        'assistant',
        JSON.stringify([
          {
            id: 'legacy-tool-block',
            type: 'tool_call',
            status: 'success',
            timestamp: 1234,
            tool_call: {
              id: 'legacy-write-call-id',
              name: 'write',
              params: toolParams,
              response: 'HISTORICAL_TOOL_RESULT',
              imagePreviews: [
                { id: 'old-preview', data: preview, mimeType: 'image/png', source: 'tool_output' }
              ]
            }
          },
          {
            id: 'legacy-preview',
            type: 'image',
            status: 'success',
            timestamp: 1234,
            image_data: { data: preview, mimeType: 'image/png' }
          }
        ])
      )
    ]
    const source = new DimLegacySource({
      database: database.data,
      transcript: { getMessages: () => originals },
      tape: { getEffectiveViewInputRows: () => [] },
      summary: {
        getSummaryState: () => ({
          summaryText: null,
          summaryCursorOrderSeq: 0,
          summaryUpdatedAt: null
        })
      },
      pending: { listPendingInputs: () => [] },
      images: async (messages) => legacyImageBlocks(messages)
    })
    try {
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
      const model = await new DimModelBridge(host).configure({
        key: 'legacy-attachments',
        displayName: 'Legacy attachments',
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
            modalities: ['text', 'image'],
            toolCalling: true,
            streaming: true,
            structuredOutput: true,
            vision: true,
            audio: false,
            reasoning: false,
            contextWindow: 64000,
            maxOutputTokens: 1000
          }
        }
      })
      const native = await host.start()
      const { sessionId } = await native.call<{ sessionId: string }>('deepchat.host.launch', {
        cwd: profile,
        model: { ...model },
        policy: { preset: 'full-access', allowedTools: [], disallowedTools: [] }
      })
      const ref = { sessionId, branchId: 'main' }
      const binding = database.data.dimSessionBindingsTable.bind(
        productSessionId,
        sessionId,
        'main',
        3
      )
      const snapshot = await source.snapshot(productSessionId)
      expect(snapshot.contextText?.['legacy-user']).toContain('PDF_EMBEDDED_TEXT_SENTINEL')
      expect(snapshot.contextText?.['legacy-user']).toContain('OCR_SELECTED_TEXT_SENTINEL')
      expect(snapshot.images?.['legacy-user']).toHaveLength(1)
      snapshot.messages = snapshot.messages.map(normalizeDimImportedMessage)
      const plan = dimHistoryPlan(snapshot)
      expect(plan.chunks.length).toBeGreaterThan(1)
      database.data.dimSessionImportsTable.begin(binding, plan)
      await native.call('session.deepchat_migration.begin', {
        ...ref,
        migrationId: plan.migrationId,
        manifest: {
          migrationId: plan.migrationId,
          productSessionId,
          digest: plan.digest,
          chunks: plan.chunks.length
        }
      })
      await native.call('session.deepchat_migration.chunk', {
        ...ref,
        migrationId: plan.migrationId,
        index: 0,
        payload: plan.chunks[0],
        checksum: dimHistoryHash(plan.chunks[0])
      })
      expect(requests).toEqual([])
      await host.stop()
      const restarted = await host.start()
      expect(
        await restarted.call('session.deepchat_migration.status', {
          ...ref,
          migrationId: plan.migrationId
        })
      ).toMatchObject({ sealed: false, uploaded: [0] })
      let sourceReads = 0
      const migration = new DimLegacyMigration({
        database: database.data,
        host,
        snapshot: async () => {
          sourceReads++
          if (sourceReads > 1) throw new Error('Sealed import must not reread legacy attachments')
          return source.snapshot(productSessionId)
        }
      })
      await migration.prepare(binding)
      expect(sourceReads).toBe(1)
      expect(database.data.dimSessionImportsTable.get(binding)).toMatchObject({ sealed: true })
      expect(requests).toEqual([])
      const content = new DimContent(host)
      const assertOriginals = async () => {
        const transcript = await content.transcript(ref, productSessionId)
        expect(transcript.contextText['legacy-user']).toContain('PDF_EMBEDDED_TEXT_SENTINEL')
        expect(transcript.contextText['legacy-user']).not.toContain('SKIPPED_PDF_RAW_BYTES')
        expect(transcript.contextText['legacy-user']).not.toContain('AUDIO_RAW_BYTES')
        for (const original of originals) {
          const restored = transcript.messages.find((item) => item.id === original.id)!
          expect(restored.content).toBe(original.content)
          expect(JSON.parse(restored.metadata)).toMatchObject(JSON.parse(original.metadata))
        }
        await expect(readFile(neverRunPath)).rejects.toMatchObject({ code: 'ENOENT' })
      }
      await assertOriginals()
      // Both the first continuation and the next one must read the sealed native context.
      for (const text of ['FIRST_NATIVE_CONTINUATION', 'SECOND_NATIVE_CONTINUATION']) {
        await host.stop()
        await migration.prepare(binding)
        expect(sourceReads).toBe(1)
        const client = await host.start()
        await client.call('deepchat.host.input', {
          ...ref,
          mode: 'queue',
          submissionId: randomUUID(),
          rawBlocks: [],
          content: [{ type: 'text', text }]
        })
        await client.call('deepchat.host.idle', ref)
        expect(requests).toHaveLength(text === 'FIRST_NATIVE_CONTINUATION' ? 1 : 2)
        const wire = requests.at(-1)!
        const parts = wire.messages.flatMap((item) =>
          typeof item.content === 'string'
            ? [{ type: 'text', text: item.content }]
            : (item.content ?? [])
        )
        const modelText = parts
          .filter((part) => part.type === 'text')
          .map((part) => part.text ?? '')
          .join('\n')
        const count = (value: string) => modelText.split(value).length - 1
        for (const value of [
          'LEGACY_USER_ATTACHMENTS',
          'PDF_EMBEDDED_TEXT_SENTINEL',
          'OCR_SELECTED_TEXT_SENTINEL',
          'legacy-write-call-id',
          toolParams,
          'HISTORICAL_TOOL_RESULT'
        ]) {
          expect(count(value), value).toBe(1)
        }
        const historical = parts.filter((part) => part.text?.includes('legacy-write-call-id'))
        expect(historical).toHaveLength(1)
        expect(historical[0].text).toContain('name: write')
        expect(historical[0].text).toContain(toolParams)
        expect(historical[0].text).toContain('HISTORICAL_TOOL_RESULT')
        expect(wire.messages.some((item) => item.role === 'tool' || item.tool_calls?.length)).toBe(
          false
        )
        expect(parts.filter((part) => part.type === 'image_url' || part.type === 'image')).toEqual([
          expect.objectContaining({
            type: 'image_url',
            image_url: expect.objectContaining({ url: imageUrl })
          })
        ])
        expect(modelText).toContain(text)
        expect(modelText).toContain(textPath)
        expect(modelText).toContain(missingImagePath)
        expect(modelText).toContain('[omitted; use read if needed]')
        expect(modelText).toContain('user_skipped_attachment_content')
        expect(modelText).toContain('user_skipped_image_content')
        for (const value of [
          png,
          'data:image/',
          'data:application/pdf',
          skippedPdf,
          skippedImage,
          ocrImage,
          preview,
          audio,
          'ORDINARY_FILE_RAW_CONTENT',
          'SKIPPED_PDF_RAW_BYTES',
          'SKIPPED_IMAGE_RAW_BYTES',
          'OCR_ORIGINAL_IMAGE_RAW_BYTES',
          'TOOL_PREVIEW_RAW_BYTES',
          'AUDIO_RAW_BYTES'
        ]) {
          expect(modelText, value).not.toContain(value)
        }
        await assertOriginals()
      }

      // Rebuilding a sealed scope must carry the sanitized sidecar, not replay archive JSON.
      const runtime = new DimSessionRuntime({
        database: database.data,
        host,
        launch: async () => {
          throw new Error('Transition fixture already has a native binding')
        },
        projected: () => {},
        failed: (_id, error) => {
          throw error
        }
      })
      const transitions = new DimScopeTransitions({
        database: database.data,
        host,
        runtime,
        installed: () => {}
      })
      const assertTransition = async (
        expectedText: string,
        previousText?: string,
        session = productSessionId
      ) => {
        const active = database.data.dimSessionBindingsTable.get(session)!
        const activeRef = { sessionId: active.dimSessionId, branchId: active.branchId }
        await host.stop()
        const transcript = await content.transcript(activeRef, session)
        const restored = transcript.messages.find((item) => item.role === 'user')!
        const text = transcript.contextText[restored.id]
        expect(text).toContain(expectedText)
        expect(text).toContain('PDF_EMBEDDED_TEXT_SENTINEL')
        expect(text).toContain('OCR_SELECTED_TEXT_SENTINEL')
        expect(transcript.images[restored.id]).toHaveLength(1)
        expect(JSON.parse(restored.content).files).toEqual(user.files)
        expect(
          Object.keys(transcript.contextText).every((id) =>
            transcript.messages.some((item) => item.id === id)
          )
        ).toBe(true)
        const client = await host.start()
        await client.call('session.deepchat_inputs.submit', {
          ...activeRef,
          input: {
            mode: 'queue',
            submission_id: randomUUID(),
            user: { content: [{ type: 'text', text: 'AFTER_SCOPE_TRANSITION' }] }
          }
        })
        await client.call('deepchat.host.idle', activeRef)
        const wire = requests.at(-1)!
        const parts = wire.messages.flatMap((item) =>
          typeof item.content === 'string'
            ? [{ type: 'text', text: item.content }]
            : (item.content ?? [])
        )
        const modelText = parts
          .filter((part) => part.type === 'text')
          .map((part) => part.text ?? '')
          .join('\n')
        const count = (value: string) => modelText.split(value).length - 1
        for (const value of [
          expectedText,
          'PDF_EMBEDDED_TEXT_SENTINEL',
          'OCR_SELECTED_TEXT_SENTINEL'
        ])
          expect(count(value), value).toBe(1)
        expect(parts.filter((part) => part.type === 'image_url' || part.type === 'image')).toEqual([
          expect.objectContaining({
            type: 'image_url',
            image_url: expect.objectContaining({ url: imageUrl })
          })
        ])
        expect(wire.messages.some((item) => item.role === 'tool' || item.tool_calls?.length)).toBe(
          false
        )
        const historicalTool = transcript.messages.find((item) => item.id === 'legacy-assistant')
        for (const value of ['legacy-write-call-id', toolParams, 'HISTORICAL_TOOL_RESULT']) {
          expect(count(value), value).toBe(historicalTool ? 1 : 0)
          if (historicalTool) expect(transcript.contextText[historicalTool.id]).toContain(value)
        }
        if (session !== productSessionId) {
          expect(transcript.messages).toEqual([restored])
          expect(count('AFTER_SCOPE_TRANSITION')).toBe(1)
        }
        if (previousText) expect(modelText).not.toContain(previousText)
        for (const value of [
          png,
          skippedPdf,
          skippedImage,
          ocrImage,
          preview,
          audio,
          'ORDINARY_FILE_RAW_CONTENT',
          'SKIPPED_PDF_RAW_BYTES',
          'SKIPPED_IMAGE_RAW_BYTES',
          'OCR_ORIGINAL_IMAGE_RAW_BYTES',
          'TOOL_PREVIEW_RAW_BYTES',
          'AUDIO_RAW_BYTES'
        ])
          expect(modelText, value).not.toContain(value)
        await expect(readFile(neverRunPath)).rejects.toMatchObject({ code: 'ENOENT' })
        return restored
      }
      await transitions.replace(productSessionId, { cwd: profile }, { kind: 'retain' })
      const retained = await assertTransition('LEGACY_USER_ATTACHMENTS')
      const editedContent = JSON.stringify({ ...user, text: 'EDITED_LEGACY_ATTACHMENTS' })
      await transitions.replace(
        productSessionId,
        { cwd: profile },
        {
          kind: 'edit',
          messageId: retained.id,
          expectedContent: retained.content,
          content: editedContent
        }
      )
      const edited = await assertTransition('EDITED_LEGACY_ATTACHMENTS', 'LEGACY_USER_ATTACHMENTS')
      await transitions.replace(
        productSessionId,
        { cwd: profile },
        {
          kind: 'retry',
          messageId: edited.id,
          fromOrderSeq: edited.orderSeq
        }
      )
      await assertTransition('EDITED_LEGACY_ATTACHMENTS', 'LEGACY_USER_ATTACHMENTS')
      const active = database.data.dimSessionBindingsTable.get(productSessionId)!
      const forkSource = await content.transcript(
        { sessionId: active.dimSessionId, branchId: active.branchId },
        productSessionId
      )
      const forkProductId = 'forked-legacy-attachments'
      const forkTarget = await (
        await host.start()
      ).call<{ sessionId: string }>('deepchat.host.launch', {
        cwd: profile,
        modelFromSession: active.dimSessionId
      })
      database.data.dimSessionBindingsTable.bind(forkProductId, forkTarget.sessionId)
      await transitions.replace(
        forkProductId,
        { cwd: profile },
        {
          kind: 'fork',
          productSessionId,
          sessionId: active.dimSessionId,
          branchId: active.branchId,
          through: forkSource.through,
          messageId: edited.id
        }
      )
      const forked = await assertTransition(
        'EDITED_LEGACY_ATTACHMENTS',
        'LEGACY_USER_ATTACHMENTS',
        forkProductId
      )
      expect(forked.id).not.toBe(edited.id)
    } finally {
      await host.stop()
      server.closeAllConnections()
      if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()))
      database.sqlite.close()
      await rm(profile, { recursive: true, force: true })
    }
  },
  90_000
)
