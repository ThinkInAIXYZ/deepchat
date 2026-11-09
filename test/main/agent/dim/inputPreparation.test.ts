import { expect, it, vi } from 'vitest'
import { DimInputPreparation } from '@/agent/dim/inputPreparation'
import type { AttachmentPreparationInput } from '@shared/types/attachment'
import type { SendMessageInput } from '@shared/types/agent-interface'

const ready = { status: 'ready' as const, issues: [], suggestedActions: [] }
it('retains product presentation and prepares native image bytes without writing a conversation', async () => {
  const input: SendMessageInput = {
    text: 'inspect the image',
    search: true,
    activeSkills: ['design'],
    files: [
      {
        name: 'photo.png',
        path: '/photo.png',
        mimeType: 'image/png',
        content: 'data:image/png;base64,cG5n',
        resolvedRepresentation: { kind: 'image' }
      }
    ]
  }
  const attachments = {
    prepare: vi.fn(async (_input: AttachmentPreparationInput) => ({
      content: input,
      summary: ready
    }))
  }
  const preparation = new DimInputPreparation({
    capabilities: () => ({ vision: true, audio: false }),
    attachments
  })
  const result = await preparation.prepare('product', input, undefined, {
    preserveResolvedRepresentations: true
  })
  expect(attachments.prepare.mock.calls[0][0]).toMatchObject({
    supportsVision: true,
    preserveResolvedRepresentations: true
  })
  expect(result.representation).toMatchObject({
    text: input.text,
    files: input.files,
    search: true,
    activeSkills: ['design']
  })
  expect(result.content).toContainEqual({
    type: 'image',
    source: { type: 'base64', mediaType: 'image/png', data: 'cG5n' }
  })
  expect(JSON.stringify(result.content)).toContain('inspect the image')
  expect(JSON.stringify(result.content)).not.toContain('Code Mode')
})

it('leaves a blocked preparation unsubmitted and honors cancellation after asynchronous OCR', async () => {
  const input = { text: '', files: [{ name: 'scan.pdf', path: '/scan.pdf' }] }
  const summary = { status: 'needs_user_action' as const, issues: [], suggestedActions: [] }
  const abort = new AbortController()
  const attachments = { prepare: vi.fn(async () => ({ content: input, summary })) }
  const preparation = new DimInputPreparation({
    capabilities: () => ({ vision: false, audio: false }),
    attachments
  })
  expect(await preparation.prepare('product', input)).toMatchObject({ content: [], summary })
  attachments.prepare.mockImplementation(async () => {
    abort.abort(new Error('cancel OCR'))
    return { content: input, summary }
  })
  await expect(preparation.prepare('product', input, abort.signal)).rejects.toThrow('cancel OCR')
})
