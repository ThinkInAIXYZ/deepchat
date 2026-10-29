import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const runtimeRoot = path.dirname(require.resolve('@arcships/rutis-runtime/package.json'))
const { base64Decode } = (await import(
  pathToFileURL(path.join(runtimeRoot, 'src/values.mjs')).href
)) as { base64Decode(text: string): Uint8Array }

describe('Rutis byte value contract', () => {
  it('decodes exact independent byte buffers across pooled and native-part sizes', () => {
    for (const size of [0, 1, 2, 3, 63, 4095, 4096, 8192, 307200, 8 * 1024 * 1024]) {
      const source = Buffer.allocUnsafe(size)
      for (let index = 0; index < size; index++) source[index] = index % 256
      const encoded = source.toString('base64')
      const decoded = base64Decode(encoded)
      const second = base64Decode(encoded)
      expect(decoded.constructor).toBe(Uint8Array)
      expect(Buffer.from(decoded).equals(source)).toBe(true)
      expect(decoded.byteOffset).toBe(0)
      expect(decoded.buffer).toBeInstanceOf(ArrayBuffer)
      expect(decoded.buffer.byteLength).toBe(size)
      expect(decoded.buffer).not.toBe(second.buffer)
      decoded.fill(0)
      expect(Buffer.from(second).equals(source)).toBe(true)
    }
  })

  it('rejects malformed padding, unused bits, whitespace and non-base64 characters', () => {
    for (const encoded of [
      'A',
      'AA',
      'AAA',
      'A===',
      'AAAA=',
      'A A=',
      'AA==\n',
      'AB==',
      'AAB=',
      '____',
      'é===',
      '\0AAA',
      '====',
      'AA=A'
    ]) {
      expect(() => base64Decode(encoded)).toThrow(/expected base64/)
    }
  })
})
