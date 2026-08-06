import { Readable } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { readBoundedUtf8Stdin } from '../../../src/cli/stdin'

describe('CLI standard input', () => {
  it('reads chunked UTF-8 without changing the prompt', async () => {
    const input = Readable.from([Buffer.from('你好'), Buffer.from('\nDeepChat')])

    await expect(readBoundedUtf8Stdin(input, new AbortController().signal, 64)).resolves.toBe(
      '你好\nDeepChat'
    )
  })

  it('rejects cumulative overflow before constructing the final string', async () => {
    const input = Readable.from([Buffer.from('1234'), Buffer.from('56789')])

    await expect(
      readBoundedUtf8Stdin(input, new AbortController().signal, 8)
    ).rejects.toMatchObject({ code: 'body_too_large', exitCode: 2 })
  })

  it('rejects malformed UTF-8', async () => {
    const input = Readable.from([Buffer.from([0xc3, 0x28])])

    await expect(
      readBoundedUtf8Stdin(input, new AbortController().signal, 8)
    ).rejects.toMatchObject({ code: 'invalid_request', exitCode: 2 })
  })
})
