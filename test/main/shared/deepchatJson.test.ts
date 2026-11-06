import { describe, expect, it } from 'vitest'
import { parseDeepchatJson, reviveDeepchatJson, stringifyDeepchatJson } from '@shared/deepchatJson'

describe('deepchat JSON Date transport', () => {
  it('preserves nested Date values and invalid Date objects', () => {
    const created = new Date('2026-01-02T03:04:05.006Z')
    const decoded = parseDeepchatJson(
      stringifyDeepchatJson({
        metadata: { fileCreated: created },
        files: [{ modified: new Date(Number.NaN) }]
      })
    ) as {
      metadata: { fileCreated: Date }
      files: Array<{ modified: Date }>
    }
    expect(decoded.metadata.fileCreated).toBeInstanceOf(Date)
    expect(decoded.metadata.fileCreated.getTime()).toBe(created.getTime())
    expect(decoded.files[0].modified).toBeInstanceOf(Date)
    expect(decoded.files[0].modified.getTime()).toBeNaN()
  })

  it('leaves ordinary objects and primitives unchanged', () => {
    expect(reviveDeepchatJson({ type: 'preview', value: 'plain' })).toEqual({
      type: 'preview',
      value: 'plain'
    })
    expect(reviveDeepchatJson(null)).toBeNull()
    expect(reviveDeepchatJson('2026-01-02T03:04:05.006Z')).toBe('2026-01-02T03:04:05.006Z')
  })

  it('does not rebuild objects already supplied by structured clone', () => {
    const date = new Date('2026-01-02T03:04:05.006Z')
    const bytes = new Uint8Array([1, 2, 3])
    const decoded = reviveDeepchatJson({ date, bytes }) as { date: Date; bytes: Uint8Array }
    expect(decoded.date).toBe(date)
    expect(decoded.bytes).toBe(bytes)

    const plain = { nested: { text: 'plain' }, values: [1, { ok: true }] }
    expect(reviveDeepchatJson(plain)).toBe(plain)
    expect(reviveDeepchatJson(plain.values)).toBe(plain.values)
  })

  it('round-trips marker-shaped ordinary JSON objects', () => {
    const marker = { __deepchatDate: 'date', value: '2026-01-02T03:04:05.006Z' }
    const entries = { __deepchatDate: 'entries', entries: [['nested', marker]] }
    const decoded = parseDeepchatJson(stringifyDeepchatJson({ marker, entries }))
    expect(decoded).toEqual({ marker, entries })
    expect((decoded as { marker: unknown }).marker).not.toBeInstanceOf(Date)
  })
})
