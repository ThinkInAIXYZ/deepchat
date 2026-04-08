import { describe, expect, it, vi } from 'vitest'
import {
  buildRemoteDeliverySegments,
  buildRemoteDraftText,
  buildRemoteFinalText,
  buildRemoteFullText,
  buildRemoteRenderableBlocks,
  buildRemoteStreamText,
  buildRemoteTraceText,
  buildRemoteStatusText
} from '@/presenter/remoteControlPresenter/services/remoteBlockRenderer'

describe('remoteBlockRenderer', () => {
  it('renders reasoning and answer blocks in order', async () => {
    const renderBlocks = await buildRemoteRenderableBlocks({
      messageId: 'msg-1',
      blocks: [
        {
          type: 'reasoning_content',
          content: 'Think first',
          status: 'success',
          timestamp: 1
        },
        {
          type: 'content',
          content: 'Answer next',
          status: 'success',
          timestamp: 2
        }
      ],
      loadSearchResults: vi.fn().mockResolvedValue([])
    })

    expect(renderBlocks).toEqual([
      expect.objectContaining({
        key: 'msg-1:0:reasoning',
        kind: 'reasoning',
        text: '[Reasoning]\nThink first'
      }),
      expect.objectContaining({
        key: 'msg-1:1:answer',
        kind: 'answer',
        text: '[Answer]\nAnswer next'
      })
    ])
    expect(buildRemoteFullText(renderBlocks)).toContain('[Reasoning]\nThink first')
    expect(buildRemoteFullText(renderBlocks)).toContain('[Answer]\nAnswer next')
  })

  it('renders tool call and summarized tool result blocks separately', async () => {
    const renderBlocks = await buildRemoteRenderableBlocks({
      messageId: 'msg-2',
      blocks: [
        {
          type: 'tool_call',
          content: '',
          status: 'success',
          timestamp: 1,
          tool_call: {
            id: 'tool-1',
            name: 'shell_command',
            params: '{"command":"ls -la"}',
            response: 'line 1\nline 2'
          },
          extra: {
            toolCallArgsComplete: true
          }
        }
      ],
      loadSearchResults: vi.fn().mockResolvedValue([])
    })

    expect(renderBlocks).toHaveLength(2)
    expect(renderBlocks[0]).toEqual(
      expect.objectContaining({
        kind: 'toolCall'
      })
    )
    expect(renderBlocks[0].text).toContain('[Tool Call] shell_command')
    expect(renderBlocks[1]).toEqual(
      expect.objectContaining({
        kind: 'toolResult',
        truncated: false
      })
    )
    expect(renderBlocks[1].text).toContain('[Tool Result] shell_command')
    expect(renderBlocks[1].text).toContain('Characters: 13')
  })

  it('truncates long tool results while preserving metadata', async () => {
    const renderBlocks = await buildRemoteRenderableBlocks({
      messageId: 'msg-3',
      blocks: [
        {
          type: 'tool_call',
          content: '',
          status: 'success',
          timestamp: 1,
          tool_call: {
            id: 'tool-1',
            name: 'cat',
            params: '{"path":"README.md"}',
            response: 'A'.repeat(2_000)
          },
          extra: {
            toolCallArgsComplete: true
          }
        }
      ],
      loadSearchResults: vi.fn().mockResolvedValue([])
    })

    expect(renderBlocks[1].truncated).toBe(true)
    expect(renderBlocks[1].text).toContain('...[truncated]')
  })

  it('renders stored search results with titles and links', async () => {
    const loadSearchResults = vi.fn().mockResolvedValue([
      {
        title: 'Result A',
        url: 'https://example.com/a',
        snippet: 'Snippet A'
      },
      {
        title: 'Result B',
        url: 'https://example.com/b',
        snippet: 'Snippet B'
      }
    ])
    const renderBlocks = await buildRemoteRenderableBlocks({
      messageId: 'msg-4',
      blocks: [
        {
          id: 'search-1',
          type: 'search',
          content: '',
          status: 'success',
          timestamp: 1,
          extra: {
            searchId: 'search-1',
            label: 'web_search',
            engine: 'bocha'
          }
        }
      ],
      loadSearchResults
    })

    expect(loadSearchResults).toHaveBeenCalledWith('msg-4', 'search-1')
    expect(renderBlocks[0].kind).toBe('search')
    expect(renderBlocks[0].text).toContain('[Search] web_search')
    expect(renderBlocks[0].text).toContain('1. Result A')
    expect(renderBlocks[0].text).toContain('https://example.com/a')
  })

  it('renders image notices instead of binary payloads', async () => {
    const renderBlocks = await buildRemoteRenderableBlocks({
      messageId: 'msg-5',
      blocks: [
        {
          type: 'image',
          status: 'success',
          timestamp: 1,
          image_data: {
            data: 'aGVsbG8=',
            mimeType: 'image/png'
          }
        }
      ],
      loadSearchResults: vi.fn().mockResolvedValue([])
    })

    expect(renderBlocks[0]).toEqual(
      expect.objectContaining({
        kind: 'imageNotice'
      })
    )
    expect(renderBlocks[0].text).toContain('MIME: image/png')
    expect(renderBlocks[0].text).toContain('Remote channel does not render binary images.')
  })

  it('builds draft text from trailing pending reasoning and answer blocks only', () => {
    const draftText = buildRemoteDraftText([
      {
        type: 'content',
        content: 'Already sent',
        status: 'success',
        timestamp: 1
      },
      {
        type: 'reasoning_content',
        content: 'Thinking now',
        status: 'pending',
        timestamp: 2
      },
      {
        type: 'content',
        content: 'Draft answer',
        status: 'pending',
        timestamp: 3
      }
    ])

    expect(draftText).toContain('[Reasoning]\nThinking now')
    expect(draftText).toContain('[Answer]\nDraft answer')
    expect(draftText).not.toContain('Already sent')
  })

  it('builds stream text from answer content only', () => {
    const streamText = buildRemoteStreamText([
      {
        type: 'reasoning_content',
        content: 'Think first',
        status: 'success',
        timestamp: 1
      },
      {
        type: 'content',
        content: 'Visible answer',
        status: 'pending',
        timestamp: 2
      },
      {
        type: 'content',
        content: 'More answer',
        status: 'success',
        timestamp: 3
      }
    ])

    expect(streamText).toBe('Visible answer\n\nMore answer')
  })

  it('builds remote trace lines from raw tool names and summarized params', () => {
    const traceText = buildRemoteTraceText([
      {
        type: 'tool_call',
        content: '',
        status: 'success',
        timestamp: 1,
        tool_call: {
          id: 'tool-1',
          name: 'search_files',
          params: '{"query":"daily news|agent.dynamic|moti.send","limit":10}'
        },
        extra: {
          toolCallArgsComplete: true
        }
      },
      {
        type: 'tool_call',
        content: '',
        status: 'success',
        timestamp: 2,
        tool_call: {
          id: 'tool-2',
          name: 'read_file',
          params: '{"path":"/tmp/report.md"}'
        },
        extra: {
          toolCallArgsComplete: true
        }
      }
    ])

    expect(traceText).toBe(
      '🔎 search_files: "daily news|agent.dynamic|moti.send"\n📖 read_file: "/tmp/report.md"'
    )
  })

  it('adds a separate error trace line for failed tool calls and truncates long previews', () => {
    const traceText = buildRemoteTraceText([
      {
        type: 'tool_call',
        content: '',
        status: 'error',
        timestamp: 1,
        tool_call: {
          id: 'tool-1',
          name: 'shell_command',
          params: JSON.stringify({
            command: `ls ${'very-long-segment/'.repeat(20)}`
          }),
          response: JSON.stringify({
            error: 'permission denied'
          })
        },
        extra: {
          toolCallArgsComplete: true
        }
      }
    ])

    expect(traceText).toContain('💻 shell_command: "ls very-long-segment/')
    expect(traceText).toContain('..."')
    expect(traceText).toContain('\n❌ shell_command: "permission denied"')
  })

  it('does not build trace text for answer-only turns', () => {
    const traceText = buildRemoteTraceText([
      {
        type: 'content',
        content: 'Only the final answer',
        status: 'success',
        timestamp: 1
      }
    ])

    expect(traceText).toBe('')
  })

  it('builds ordered delivery segments that preserve answer and process transitions', () => {
    const segments = buildRemoteDeliverySegments('msg-1', [
      {
        type: 'content',
        content: 'Reviewing these files first.',
        status: 'success',
        timestamp: 1
      },
      {
        type: 'tool_call',
        content: '',
        status: 'success',
        timestamp: 2,
        tool_call: {
          id: 'tool-1',
          name: 'read_file',
          params: '{"path":"/tmp/a.md"}'
        },
        extra: {
          toolCallArgsComplete: true
        }
      },
      {
        type: 'tool_call',
        content: '',
        status: 'error',
        timestamp: 3,
        tool_call: {
          id: 'tool-2',
          name: 'shell_command',
          params: '{"command":"ls -la"}',
          response: '{"error":"permission denied"}'
        },
        extra: {
          toolCallArgsComplete: true
        }
      },
      {
        type: 'content',
        content: 'Everything is organized.',
        status: 'pending',
        timestamp: 4
      }
    ])

    expect(segments).toEqual([
      {
        key: 'msg-1:0:answer',
        kind: 'answer',
        text: 'Reviewing these files first.',
        sourceMessageId: 'msg-1'
      },
      {
        key: 'msg-1:1:process',
        kind: 'process',
        text: '📖 read_file: "/tmp/a.md"\n💻 shell_command: "ls -la"\n❌ shell_command: "permission denied"',
        sourceMessageId: 'msg-1'
      },
      {
        key: 'msg-1:3:answer',
        kind: 'answer',
        text: 'Everything is organized.',
        sourceMessageId: 'msg-1'
      }
    ])
  })

  it('keeps consecutive answer blocks together when hidden blocks appear between them', () => {
    const segments = buildRemoteDeliverySegments('msg-2', [
      {
        type: 'content',
        content: 'Part 1',
        status: 'success',
        timestamp: 1
      },
      {
        type: 'reasoning_content',
        content: 'hidden',
        status: 'success',
        timestamp: 2
      },
      {
        type: 'search',
        content: '',
        status: 'success',
        timestamp: 3
      },
      {
        type: 'content',
        content: 'Part 2',
        status: 'success',
        timestamp: 4
      }
    ])

    expect(segments).toEqual([
      {
        key: 'msg-2:0:answer',
        kind: 'answer',
        text: 'Part 1\n\nPart 2',
        sourceMessageId: 'msg-2'
      }
    ])
  })

  it('builds compact status text for tool execution and waiting states', () => {
    expect(
      buildRemoteStatusText([
        {
          type: 'tool_call',
          content: '',
          status: 'pending',
          timestamp: 1,
          tool_call: {
            id: 'tool-1',
            name: 'shell_command',
            params: '{"command":"ls"}'
          }
        }
      ])
    ).toBe('Running: calling shell_command...')

    expect(buildRemoteStatusText([], true)).toBe('Waiting for your response...')
  })

  it('builds final text from answer content before falling back to terminal errors', () => {
    expect(
      buildRemoteFinalText([
        {
          type: 'reasoning_content',
          content: 'hidden',
          status: 'success',
          timestamp: 1
        },
        {
          type: 'content',
          content: 'Final answer',
          status: 'success',
          timestamp: 2
        }
      ])
    ).toBe('Final answer')

    expect(
      buildRemoteFinalText(
        [
          {
            type: 'content',
            content: 'partial answer',
            status: 'success',
            timestamp: 0
          },
          {
            type: 'error',
            content: 'assistant failed',
            status: 'error',
            timestamp: 1
          }
        ],
        {
          preferTerminalError: true,
          fallbackNoResponseText: 'No assistant response was produced.'
        }
      )
    ).toBe('assistant failed')
  })
})
