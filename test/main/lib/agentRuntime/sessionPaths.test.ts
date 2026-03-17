import { createHash } from 'crypto'
import path from 'path'
import { app } from 'electron'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveToolOffloadPath } from '@/lib/agentRuntime/sessionPaths'

describe('sessionPaths offload path sanitization', () => {
  const homeDir = path.join('C:', 'Users', 'tester')

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('sanitizes colon-based tool call ids into a normal .offload file name', () => {
    vi.spyOn(app, 'getPath').mockReturnValue(homeDir)

    const toolCallId = 'function.cdp_send:11'
    const fingerprint = createHash('sha1').update(toolCallId).digest('hex').slice(0, 8)
    const filePath = resolveToolOffloadPath('session-a', toolCallId)

    expect(filePath).toBe(
      path.join(
        homeDir,
        '.deepchat',
        'sessions',
        'session-a',
        `tool_function.cdp_send_11_${fingerprint}.offload`
      )
    )
    expect(path.basename(filePath!)).not.toContain(':')
    expect(path.basename(filePath!)).toMatch(/\.offload$/)
  })

  it('sanitizes other windows-invalid characters and trailing dots or spaces', () => {
    vi.spyOn(app, 'getPath').mockReturnValue(homeDir)

    const filePath = resolveToolOffloadPath('session-a', 'bad<>:"/\\\\|?*\u0001name. ')
    const fileName = path.basename(filePath!)

    expect(fileName).toMatch(/^tool_[^<>:"/\\|?*\u0000-\u001f]+\.offload$/)
    expect(fileName).not.toContain(':')
    expect(fileName).not.toMatch(/[. ]\.offload$/)
  })

  it('adds a fingerprint so colliding sanitized tool ids still map to different files', () => {
    vi.spyOn(app, 'getPath').mockReturnValue(homeDir)

    const colonFilePath = resolveToolOffloadPath('session-a', 'tool:1')
    const slashFilePath = resolveToolOffloadPath('session-a', 'tool/1')

    expect(path.basename(colonFilePath!)).toMatch(/^tool_tool_1_[0-9a-f]{8}\.offload$/)
    expect(path.basename(slashFilePath!)).toMatch(/^tool_tool_1_[0-9a-f]{8}\.offload$/)
    expect(colonFilePath).not.toBe(slashFilePath)
  })
})
