import { randomUUID } from 'node:crypto'
import {
  RequestError,
  type CreateElicitationRequest,
  type CreateElicitationResponse
} from '@agentclientprotocol/sdk'
import { fromJsonSchema } from '@modelcontextprotocol/client'
import { z } from 'zod'
import type {
  AcpElicitationDecision,
  AcpElicitationField,
  AcpElicitationView
} from '@shared/types/acp-elicitation'
import { readElicitationFields } from '@shared/types/elicitation'
import { validateAndCloneJsonSchema, assertBoundedMcpJson } from '@/mcp/schemaValidation'

const text = z.string().max(65_536)
const id = z.string().min(1).max(256)
const option = z.object({ label: text, description: text.optional(), preview: text.optional() })
const metaSchema = z.object({
  version: z.literal(1),
  autoResolveAfterSeconds: z.number().finite().nonnegative().nullish(),
  autoResolveAtEpochSeconds: z.number().finite().nonnegative().optional(),
  customAnswerFor: id.optional(),
  noteFor: id.optional(),
  secret: z.boolean().optional(),
  preview: text.optional(),
  questions: z
    .array(
      z.object({
        id: id.optional(),
        question: text,
        header: text,
        options: z.array(option).max(128),
        multiSelect: z.boolean(),
        allowCustomAnswer: z.boolean().optional(),
        isSecret: z.boolean().optional(),
        note: z
          .object({
            fieldId: id,
            title: text.optional(),
            description: text.optional(),
            isSecret: z.boolean().optional()
          })
          .optional()
      })
    )
    .max(64)
    .optional()
})

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}

function readMeta(value: unknown): z.infer<typeof metaSchema> | undefined {
  const candidate = record(record(value).lody).elicitation
  if (record(candidate).version !== 1) return undefined
  const parsed = metaSchema.safeParse(candidate)
  if (!parsed.success) throw RequestError.invalidParams('Invalid Lody elicitation metadata')
  return parsed.data
}

function normalizeFields(
  schema: Record<string, unknown>,
  meta: ReturnType<typeof readMeta>
): AcpElicitationField[] {
  const properties = record(schema.properties)
  const fields: AcpElicitationField[] = readElicitationFields(schema).map((field) => {
    const raw = record(properties[field.name])
    if (!['string', 'number', 'integer', 'boolean', 'array'].includes(String(raw.type))) {
      throw RequestError.invalidParams('Unsupported elicitation field type')
    }
    if (raw.type === 'array' && field.type !== 'multi-select') {
      throw RequestError.invalidParams('Elicitation arrays require enumerated string values')
    }
    const hints = readMeta(raw._meta)
    const rawOptions = raw.oneOf ?? record(raw.items).anyOf
    const options = field.options?.map((entry) => {
      const rawOption = record(
        Array.isArray(rawOptions)
          ? rawOptions.find((candidate) => record(candidate).const === entry.value)
          : undefined
      )
      return {
        ...entry,
        description: typeof rawOption.description === 'string' ? rawOption.description : undefined,
        preview: readMeta(rawOption._meta)?.preview
      }
    })
    return {
      ...field,
      options,
      secret: hints?.secret,
      preview: hints?.preview,
      customAnswerFor: hints?.customAnswerFor,
      noteFor: hints?.noteFor
    }
  })
  const byName = new Map(fields.map((field) => [field.name, field]))
  for (const field of fields) {
    const targetId = field.customAnswerFor ?? field.noteFor
    if (!targetId) continue
    const target = byName.get(targetId)
    if (
      field.type !== 'string' ||
      !target ||
      target === field ||
      target.customAnswerFor ||
      target.noteFor ||
      (field.customAnswerFor && field.noteFor) ||
      (field.customAnswerFor && target.required)
    ) {
      throw RequestError.invalidParams('Invalid elicitation answer relationship')
    }
    if (
      fields.some(
        (other) =>
          other !== field &&
          (field.customAnswerFor ? other.customAnswerFor === targetId : other.noteFor === targetId)
      )
    ) {
      throw RequestError.invalidParams('Duplicate elicitation answer relationship')
    }
  }
  const noteIds = new Set(
    meta?.questions?.flatMap((question) => (question.note ? [question.note.fieldId] : [])) ?? []
  )
  const questions = fields.filter(
    (field) => !field.customAnswerFor && !field.noteFor && !noteIds.has(field.name)
  )
  const used = new Set<string>()
  for (const [index, question] of (meta?.questions ?? []).entries()) {
    const field = question.id ? byName.get(question.id) : questions[index]
    if (!field || field.customAnswerFor || field.noteFor || used.has(field.name)) {
      throw RequestError.invalidParams('Invalid elicitation question identity')
    }
    used.add(field.name)
    field.title = question.header || field.title
    field.description = question.question || field.description
    field.secret ||= question.isSecret
    const raw = record(properties[field.name])
    const rawOptions = raw.oneOf ?? raw.enum ?? record(raw.items).anyOf ?? record(raw.items).enum
    field.options = field.options?.map((entry, index) => {
      const sourceIndex = Array.isArray(rawOptions)
        ? rawOptions.findIndex((candidate) =>
            typeof candidate === 'string'
              ? candidate === entry.value
              : record(candidate).const === entry.value
          )
        : index
      return {
        ...entry,
        description: entry.description ?? question.options[sourceIndex]?.description,
        preview: entry.preview ?? question.options[sourceIndex]?.preview
      }
    })
    if (question.note) {
      const note = byName.get(question.note.fieldId)
      if (
        !note ||
        note === field ||
        note.type !== 'string' ||
        note.customAnswerFor ||
        (note.noteFor && note.noteFor !== field.name)
      ) {
        throw RequestError.invalidParams('Invalid elicitation note identity')
      }
      // A question's note may define the relation even without property metadata.
      if (used.has(note.name) || meta?.questions?.some((q) => q.id === note.name)) {
        throw RequestError.invalidParams('Elicitation note collides with a question')
      }
      note.noteFor = field.name
      note.title = question.note.title ?? note.title
      note.description = question.note.description ?? note.description
      note.secret ||= question.note.isSecret
    }
  }
  for (const field of fields) {
    if (field.secret || (field.customAnswerFor && byName.get(field.customAnswerFor)?.secret)) {
      field.secret = true
      delete field.defaultValue
    }
  }
  return fields
}

type Context = {
  connectionId: string
  agentId: string
  agentName: string
  conversationId?: string
  signal: AbortSignal
}
type Pending = {
  view: AcpElicitationView
  connectionId: string
  remoteSessionId?: string
  elicitationId?: string
  originRequestId?: string | number | null
  schema?: Record<string, unknown>
  lody: boolean
  resolve: (response: CreateElicitationResponse) => void
  cleanup: () => void
}

export class AcpElicitationBridge {
  version = 0
  private readonly pending = new Map<string, Pending>()
  private readonly secrets = new Map<string, Set<string>>()

  constructor(private readonly changed: () => void) {}

  list(): AcpElicitationView[] {
    return [...this.pending.values()].map((entry) => entry.view)
  }

  request(params: CreateElicitationRequest, context: Context): Promise<CreateElicitationResponse> {
    if (context.signal.aborted || this.pending.size >= 32)
      return Promise.resolve({ action: 'cancel' })
    assertBoundedMcpJson(params, 'ACP elicitation', 262_144)
    if (params.mode !== 'form' && params.mode !== 'url')
      throw RequestError.invalidParams('Unsupported elicitation mode')
    const meta = readMeta(params._meta)
    const schema =
      params.mode === 'form'
        ? validateAndCloneJsonSchema(params.requestedSchema, 'ACP elicitation schema')
        : undefined
    if (schema && Object.keys(record(schema.properties)).length > 64)
      throw RequestError.invalidParams('Too many elicitation fields')
    const fields = schema ? normalizeFields(schema, meta) : []
    let url: string | undefined
    if (params.mode === 'url') {
      try {
        const candidate = new URL(String(params.url))
        if (
          !['http:', 'https:'].includes(candidate.protocol) ||
          candidate.username ||
          candidate.password ||
          candidate.href.length > 8192
        )
          throw new Error()
        url = candidate.href
      } catch {
        throw RequestError.invalidParams('Invalid elicitation URL')
      }
    }
    const deadlines = [
      meta?.autoResolveAtEpochSeconds === undefined
        ? undefined
        : meta.autoResolveAtEpochSeconds * 1000,
      meta?.autoResolveAfterSeconds == null
        ? undefined
        : Date.now() + meta.autoResolveAfterSeconds * 1000
    ].filter((value): value is number => value !== undefined)
    const expiresAt = deadlines.length ? Math.min(...deadlines) : undefined
    if (expiresAt !== undefined && expiresAt <= Date.now())
      return Promise.resolve({ action: 'cancel' })
    const requestId = randomUUID()
    const view: AcpElicitationView = {
      requestId,
      agentId: context.agentId,
      agentName: context.agentName,
      conversationId: context.conversationId,
      mode: params.mode,
      message: params.message,
      fields,
      url,
      expiresAt,
      toolCallId:
        'toolCallId' in params && typeof params.toolCallId === 'string'
          ? params.toolCallId
          : undefined,
      status: 'pending'
    }
    const promise = new Promise<CreateElicitationResponse>((resolve) => {
      const abort = () => this.finish(requestId, { action: 'cancel' })
      let timeout: ReturnType<typeof setTimeout> | undefined
      const expire = () => {
        if (expiresAt === undefined) return
        if (expiresAt <= Date.now()) abort()
        else timeout = setTimeout(expire, Math.min(expiresAt - Date.now(), 2_147_483_647))
      }
      if (expiresAt !== undefined)
        timeout = setTimeout(expire, Math.min(expiresAt - Date.now(), 2_147_483_647))
      context.signal.addEventListener('abort', abort, { once: true })
      this.pending.set(requestId, {
        view,
        connectionId: context.connectionId,
        schema,
        lody: !!meta,
        remoteSessionId:
          'sessionId' in params && typeof params.sessionId === 'string'
            ? params.sessionId
            : undefined,
        originRequestId:
          'requestId' in params ? (params.requestId as string | number | null) : undefined,
        elicitationId: params.mode === 'url' ? String(params.elicitationId) : undefined,
        resolve,
        cleanup: () => {
          clearTimeout(timeout)
          context.signal.removeEventListener('abort', abort)
        }
      })
      if (context.signal.aborted) abort()
    })
    this.notifyChanged()
    return promise
  }

  async respond(decision: AcpElicitationDecision, conversationId?: string): Promise<boolean> {
    const pending = this.pending.get(decision.requestId)
    if (
      !pending ||
      (conversationId !== undefined && pending.view.conversationId !== conversationId)
    )
      return false
    if (pending.view.expiresAt !== undefined && pending.view.expiresAt <= Date.now()) {
      this.finish(decision.requestId, { action: 'cancel' })
      return false
    }
    if (pending.view.status !== 'pending') {
      if (decision.action === 'cancel') {
        pending.cleanup()
        this.pending.delete(decision.requestId)
        this.notifyChanged()
      }
      return false
    }
    if (decision.action !== 'accept' || !pending.schema) {
      this.finish(decision.requestId, { action: decision.action })
      return true
    }
    const content = { ...decision.content }
    assertBoundedMcpJson(content, 'ACP elicitation response', 65_536)
    for (const field of pending.view.fields) {
      const value = content[field.name]
      if (field.customAnswerFor && typeof value === 'string' && value.trim()) {
        delete content[field.customAnswerFor]
      }
    }
    const validation = await fromJsonSchema<Record<string, unknown>>({
      ...pending.schema,
      type: 'object',
      required: Array.isArray(pending.schema.required) ? (pending.schema.required as string[]) : [],
      additionalProperties: false
    })['~standard'].validate(content)
    if (validation.issues) throw new Error('The answer does not match the requested form')
    // Validation may yield: cancellation or another renderer can settle the request meanwhile.
    if (this.pending.get(decision.requestId) !== pending || pending.view.status !== 'pending')
      return false
    if (pending.view.expiresAt !== undefined && pending.view.expiresAt <= Date.now()) {
      this.finish(decision.requestId, { action: 'cancel' })
      return false
    }
    const retainedSecrets = this.secrets.get(pending.connectionId)
    if (
      retainedSecrets &&
      (retainedSecrets.size > 4096 ||
        [...retainedSecrets].reduce((size, secret) => size + secret.length, 0) > 1_048_576)
    )
      throw new Error('Reconnect before submitting more private answers')
    const answers: Record<string, string | string[]> = Object.create(null)
    for (const field of pending.view.fields) {
      const value = content[field.name]
      if (field.customAnswerFor) {
        if (typeof value === 'string' && value.trim()) answers[field.customAnswerFor] = value
      } else if (typeof value === 'string' || Array.isArray(value)) {
        answers[field.name] = value
      }
      if (field.secret && value !== undefined) {
        const secrets = this.secrets.get(pending.connectionId) ?? new Set<string>()
        for (const secret of Array.isArray(value) ? value : [String(value)])
          if (secret) secrets.add(secret)
        this.secrets.set(pending.connectionId, secrets)
      }
    }
    this.finish(decision.requestId, {
      action: 'accept',
      content,
      ...(pending.lody ? { _meta: { lody: { elicitation: { version: 1, answers } } } } : {})
    })
    return true
  }

  complete(connectionId: string, elicitationId: string): void {
    for (const pending of this.pending.values()) {
      if (pending.connectionId !== connectionId || pending.elicitationId !== elicitationId) continue
      if (pending.view.status === 'pending')
        this.finish(pending.view.requestId, { action: 'cancel' })
      else pending.view.status = 'completed'
    }
    this.notifyChanged()
  }

  cancelSession(connectionId: string, sessionId: string): void {
    for (const [id, entry] of this.pending)
      if (entry.connectionId === connectionId && entry.remoteSessionId === sessionId)
        this.finish(id, { action: 'cancel' })
  }

  cancelOrigin(connectionId: string, requestId: string | number): void {
    for (const [id, entry] of this.pending)
      if (
        entry.connectionId === connectionId &&
        entry.originRequestId === requestId &&
        entry.view.status === 'pending'
      )
        this.finish(id, { action: 'cancel' })
  }

  closeConnection(connectionId: string): void {
    for (const [id, entry] of this.pending)
      if (entry.connectionId === connectionId) this.finish(id, { action: 'cancel' })
    this.secrets.delete(connectionId)
  }

  redact<T>(connectionId: string, value: T): T {
    const secrets = this.secrets.get(connectionId)
    if (!secrets?.size) return value
    const scrub = (input: unknown, rawValue = false): unknown => {
      if (
        rawValue &&
        (typeof input === 'number' || typeof input === 'boolean') &&
        secrets.has(String(input))
      )
        return '[redacted]'
      if (typeof input === 'string') {
        for (const secret of secrets) input = (input as string).replaceAll(secret, '[redacted]')
        return input
      }
      if (Array.isArray(input)) return input.map((value) => scrub(value, rawValue))
      if (input && typeof input === 'object')
        return Object.fromEntries(
          Object.entries(input).map(([key, entry]) => [
            key,
            [
              'type',
              'sessionUpdate',
              'status',
              'kind',
              'mode',
              'action',
              'sessionId',
              'toolCallId',
              'turnId',
              'taskId',
              'runId',
              'planId',
              'messagePhase',
              'titleSource'
            ].includes(key)
              ? entry
              : scrub(entry, rawValue || key === 'rawInput' || key === 'rawOutput')
          ])
        )
      return input
    }
    return scrub(value) as T
  }

  private notifyChanged(): void {
    this.version += 1
    this.changed()
  }

  private finish(requestId: string, response: CreateElicitationResponse): void {
    const pending = this.pending.get(requestId)
    if (!pending) return
    pending.cleanup()
    if (pending.elicitationId && response.action === 'accept') {
      pending.view.status = 'waiting_external'
      // Accepted URL requests are local status views, not unresolved RPCs.
      pending.view.expiresAt = Math.min(
        pending.view.expiresAt ?? Infinity,
        Date.now() + 15 * 60_000
      )
      const timeout = setTimeout(
        () => this.finish(requestId, { action: 'cancel' }),
        Math.max(0, pending.view.expiresAt - Date.now())
      )
      timeout.unref?.()
      pending.cleanup = () => clearTimeout(timeout)
    } else this.pending.delete(requestId)
    pending.resolve(response)
    this.notifyChanged()
  }
}
