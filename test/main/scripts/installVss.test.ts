import { describe, expect, it, vi } from 'vitest'
import {
  VssDownloadError,
  downloadExtension,
  normalizeArch,
  normalizePlatform,
  parseArgs,
  targetTriple,
  validateExtensionMetadata
} from '../../../scripts/installVss.js'
import { parseArgs as parseSmokeArgs } from '../../../scripts/smoke-duckdb-vss.js'

function response(status: number, body = 'ok'): Response {
  return new Response(body, { status })
}

function extensionFixture({
  signature = 'duckdb_signature',
  version = 'v1.5.3',
  triple = 'osx_arm64'
}: {
  signature?: string
  version?: string
  triple?: string
} = {}): Buffer {
  return Buffer.concat([Buffer.from('native-binary-body'), Buffer.from(`\n${signature}\n${version}\n${triple}\n`)])
}

describe('installVss helpers', () => {
  it('parses platform, arch, repository, and bare pnpm separator arguments', () => {
    expect(
      parseArgs(['--', '--platform', 'darwin', '--arch=x64', '--repository', 'https://mirror'])
    ).toEqual({
      platform: 'darwin',
      arch: 'x64',
      repository: 'https://mirror'
    })
    expect(targetTriple(normalizePlatform('macos'), normalizeArch('amd64'))).toBe('osx_amd64')
  })

  it('retries transient network failures and 5xx responses before returning the body', async () => {
    const fetchImpl = vi
      .fn<() => Promise<Response>>()
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockResolvedValueOnce(response(500, 'server error'))
      .mockResolvedValueOnce(response(200, 'extension'))
    const sleep = vi.fn(async () => undefined)

    const body = await downloadExtension('https://extensions.example/v1.5.3/osx_arm64/vss.gz', {
      fetchImpl,
      sleep,
      baseDelayMs: 10,
      context: {
        duckdbVersion: 'v1.5.3',
        triple: 'osx_arm64',
        url: 'https://extensions.example/v1.5.3/osx_arm64/vss.gz'
      }
    })

    expect(body.toString()).toBe('extension')
    expect(fetchImpl).toHaveBeenCalledTimes(3)
    expect(sleep).toHaveBeenNthCalledWith(1, 10)
    expect(sleep).toHaveBeenNthCalledWith(2, 20)
  })

  it('does not retry permanent 404 responses and reports version, triple, and URL', async () => {
    const fetchImpl = vi.fn(async () => response(404, 'missing'))
    const sleep = vi.fn(async () => undefined)
    let caught: unknown

    try {
      await downloadExtension('https://extensions.example/v1.5.3/linux_amd64/vss.gz', {
        fetchImpl,
        sleep,
        context: {
          duckdbVersion: 'v1.5.3',
          triple: 'linux_amd64',
          url: 'https://extensions.example/v1.5.3/linux_amd64/vss.gz'
        }
      })
    } catch (error) {
      caught = error
    }

    expect(caught).toBeInstanceOf(VssDownloadError)
    expect((caught as Error).message).toContain('v1.5.3')
    expect((caught as Error).message).toContain('linux_amd64')
    expect((caught as Error).message).toContain('https://extensions.example/v1.5.3/linux_amd64/vss.gz')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(sleep).not.toHaveBeenCalled()
  })

  it('retries when a download attempt times out', async () => {
    const fetchImpl = vi
      .fn<() => Promise<Response>>()
      .mockImplementationOnce(() => new Promise(() => undefined))
      .mockResolvedValueOnce(response(200, 'extension'))
    const sleep = vi.fn(async () => undefined)

    const body = await downloadExtension('https://extensions.example/v1.5.3/osx_arm64/vss.gz', {
      fetchImpl,
      sleep,
      retries: 1,
      timeoutMs: 1,
      context: {
        duckdbVersion: 'v1.5.3',
        triple: 'osx_arm64',
        url: 'https://extensions.example/v1.5.3/osx_arm64/vss.gz'
      }
    })

    expect(body.toString()).toBe('extension')
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(sleep).toHaveBeenCalledTimes(1)
  })

  it('fails fast when smoke script flags are missing values', () => {
    expect(() => parseSmokeArgs(['--platform'])).toThrow(/Missing value/)
    expect(() => parseSmokeArgs(['--platform', '--arch', 'arm64'])).toThrow(/Missing value/)
    expect(parseSmokeArgs(['--platform', 'darwin', '--arch=arm64'])).toEqual({
      platform: 'darwin',
      arch: 'arm64'
    })
    expect(parseSmokeArgs(['--extension-gzip-path', '/tmp/vss.duckdb_extension.gz'])).toEqual({
      'extension-gzip-path': '/tmp/vss.duckdb_extension.gz'
    })
  })

  it('accepts extension metadata with matching signature, version, and target triple', () => {
    expect(() =>
      validateExtensionMetadata(extensionFixture(), {
        duckdbVersion: 'v1.5.3',
        triple: 'osx_arm64'
      })
    ).not.toThrow()
  })

  it('rejects extension metadata with the wrong target triple', () => {
    expect(() =>
      validateExtensionMetadata(extensionFixture({ triple: 'osx_amd64' }), {
        duckdbVersion: 'v1.5.3',
        triple: 'osx_arm64'
      })
    ).toThrow(/osx_arm64/)
  })

  it('rejects extension metadata with the wrong DuckDB version', () => {
    expect(() =>
      validateExtensionMetadata(extensionFixture({ version: 'v1.5.2' }), {
        duckdbVersion: 'v1.5.3',
        triple: 'osx_arm64'
      })
    ).toThrow(/v1\.5\.3/)
  })

  it('rejects extension metadata without a DuckDB signature footer', () => {
    expect(() =>
      validateExtensionMetadata(extensionFixture({ signature: 'not_a_signature' }), {
        duckdbVersion: 'v1.5.3',
        triple: 'osx_arm64'
      })
    ).toThrow(/duckdb_signature/)
  })
})
