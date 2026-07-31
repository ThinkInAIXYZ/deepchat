import { describe, expect, it } from 'vitest'
import {
  buildMcpAppContentSecurityPolicy,
  buildMcpAppPermissionsPolicy
} from '@/mcp/apps/sandboxProtocol'

describe('MCP App sandbox policy', () => {
  it('keeps network access deny-by-default and admits only declared origins', () => {
    const policy = buildMcpAppContentSecurityPolicy({
      connectDomains: ['https://api.example.com'],
      resourceDomains: ['https://static.example.com'],
      frameDomains: ['https://embed.example.com']
    })

    expect(policy).toContain("default-src 'none'")
    expect(policy).toContain('connect-src https://api.example.com')
    expect(policy).toContain("object-src 'none'")
    expect(policy).toContain("form-action 'none'")
    expect(policy).toContain('frame-src https://embed.example.com')
  })

  it('does not grant an implicit frame source when none is declared', () => {
    expect(buildMcpAppContentSecurityPolicy(undefined)).toContain("frame-src 'none'")
  })

  it('drops CSP sources containing directive separators or whitespace', () => {
    const policy = buildMcpAppContentSecurityPolicy({
      connectDomains: [
        'https://api.example.com',
        'https://safe.example; script-src *',
        'https://line.example\nscript-src *'
      ]
    })

    expect(policy).toContain('connect-src https://api.example.com')
    expect(policy).not.toContain('https://safe.example')
    expect(policy).not.toContain('https://line.example')
    expect(policy).not.toContain('script-src *')
  })

  it('uses declared base URI domains without implicitly adding the sandbox origin', () => {
    const policy = buildMcpAppContentSecurityPolicy({
      baseUriDomains: ['https://assets.example.com']
    })

    expect(policy).toContain('base-uri https://assets.example.com')
    expect(policy).not.toContain("base-uri 'self'")
  })

  it('denies undeclared device capabilities in the response policy', () => {
    expect(
      buildMcpAppPermissionsPolicy({
        camera: {},
        clipboardWrite: {}
      })
    ).toBe('camera=(self), microphone=(), geolocation=(), clipboard-write=(self)')
    expect(buildMcpAppPermissionsPolicy(undefined)).toBe(
      'camera=(), microphone=(), geolocation=(), clipboard-write=()'
    )
  })
})
