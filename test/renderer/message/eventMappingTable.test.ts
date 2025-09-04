import { describe, it, expect } from 'vitest'
import type { LLMAgentEvent } from '@shared/types/core/agent-events'
import type { AssistantMessageBlock } from '@shared/chat'

/**
 * 表驱动的事件→UI映射契约测试
 * 基于 docs/agent/message-architecture.md 中的映射表
 */

interface MappingTestCase {
  name: string
  event: LLMAgentEvent
  expectedBlock: Partial<AssistantMessageBlock>
  notes?: string
}

// 映射表测试用例
const mappingTestCases: MappingTestCase[] = [
  // 文本内容映射
  {
    name: 'response.content → content block',
    event: {
      type: 'response',
      data: {
        eventId: 'test-123',
        content: 'Hello world!'
      }
    },
    expectedBlock: {
      type: 'content',
      content: 'Hello world!',
      status: 'success'
    },
    notes: 'Markdown 渲染，需安全处理'
  },

  // 推理内容映射
  {
    name: 'response.reasoning_content → reasoning_content block',
    event: {
      type: 'response',
      data: {
        eventId: 'test-123',
        reasoning_content: 'Let me think about this...'
      }
    },
    expectedBlock: {
      type: 'reasoning_content',
      content: 'Let me think about this...',
      status: 'success'
    },
    notes: '可选 reasoning_time'
  },

  // 工具调用开始
  {
    name: 'response.tool_call=start → tool_call block (loading)',
    event: {
      type: 'response',
      data: {
        eventId: 'test-123',
        tool_call: 'start',
        tool_call_id: 'tool-456',
        tool_call_name: 'searchWeb',
        tool_call_params: '{"query": "test"}'
      }
    },
    expectedBlock: {
      type: 'tool_call',
      status: 'loading',
      tool_call: {
        id: 'tool-456',
        name: 'searchWeb',
        params: '{"query": "test"}'
      }
    },
    notes: '新建或激活同 id 块'
  },

  // 工具调用运行中
  {
    name: 'response.tool_call=running → tool_call block (loading)',
    event: {
      type: 'response',
      data: {
        eventId: 'test-123',
        tool_call: 'running',
        tool_call_id: 'tool-456'
      }
    },
    expectedBlock: {
      type: 'tool_call',
      status: 'loading',
      tool_call: {
        id: 'tool-456'
      }
    },
    notes: '追加参数/中间输出'
  },

  // 工具调用结束
  {
    name: 'response.tool_call=end → tool_call block (success)',
    event: {
      type: 'response',
      data: {
        eventId: 'test-123',
        tool_call: 'end',
        tool_call_id: 'tool-456',
        tool_call_response: 'Search completed'
      }
    },
    expectedBlock: {
      type: 'tool_call',
      status: 'success',
      tool_call: {
        id: 'tool-456',
        response: 'Search completed'
      }
    },
    notes: '终态，写入 response'
  },

  // 权限请求
  {
    name: 'response.permission-required → action block (tool_call_permission)',
    event: {
      type: 'response',
      data: {
        eventId: 'test-123',
        tool_call: 'permission-required',
        tool_call_id: 'tool-789',
        tool_call_name: 'writeFile',
        permission_request: {
          toolName: 'writeFile',
          serverName: 'filesystem',
          permissionType: 'write',
          description: 'Write to local file system'
        }
      }
    },
    expectedBlock: {
      type: 'action',
      action_type: 'tool_call_permission',
      status: 'pending',
      tool_call: {
        id: 'tool-789',
        name: 'writeFile'
      }
    },
    notes: '待用户授权，后续置 granted/denied'
  },

  // 速率限制
  {
    name: 'response.rate_limit → action block (rate_limit)',
    event: {
      type: 'response',
      data: {
        eventId: 'test-123',
        rate_limit: {
          providerId: 'openai',
          qpsLimit: 10,
          currentQps: 15,
          queueLength: 3,
          estimatedWaitTime: 2000
        }
      }
    },
    expectedBlock: {
      type: 'action',
      action_type: 'rate_limit',
      status: 'pending',
      extra: {
        providerId: 'openai',
        qpsLimit: 10,
        currentQps: 15,
        queueLength: 3,
        estimatedWaitTime: 2000
      }
    },
    notes: '可根据严重度置 error'
  },

  // 图像数据
  {
    name: 'response.image_data → image block',
    event: {
      type: 'response',
      data: {
        eventId: 'test-123',
        image_data: {
          data: 'base64encodeddata',
          mimeType: 'image/png'
        }
      }
    },
    expectedBlock: {
      type: 'image',
      status: 'success',
      image_data: {
        data: 'base64encodeddata',
        mimeType: 'image/png'
      }
    },
    notes: 'Base64，大小与类型受限'
  },

  // 错误事件
  {
    name: 'error.error → error block',
    event: {
      type: 'error',
      data: {
        eventId: 'test-123',
        error: 'Network connection failed'
      }
    },
    expectedBlock: {
      type: 'error',
      content: 'Network connection failed',
      status: 'error'
    },
    notes: '错误块仅由错误事件驱动'
  },

  // 结束事件（不生成UI块）
  {
    name: 'end.end → no UI block',
    event: {
      type: 'end',
      data: {
        eventId: 'test-123',
        userStop: false
      }
    },
    expectedBlock: null as any, // 特殊标记：不生成块
    notes: '用于收尾：将残留 loading 置为 error/cancel'
  }
]

// 状态转换测试用例
const statusTransitionCases = [
  { from: 'loading', to: 'success', valid: true },
  { from: 'loading', to: 'error', valid: true },
  { from: 'pending', to: 'granted', valid: true },
  { from: 'pending', to: 'denied', valid: true },
  { from: 'pending', to: 'error', valid: true },
  { from: 'success', to: 'loading', valid: false },
  { from: 'error', to: 'success', valid: false },
  { from: 'granted', to: 'pending', valid: false },
  { from: 'denied', to: 'granted', valid: false }
]

describe('Event-to-UI Mapping Table Contract Tests', () => {
  describe('Mapping Table Compliance', () => {
    mappingTestCases.forEach((testCase) => {
      it(`should map ${testCase.name} correctly`, () => {
        if (testCase.expectedBlock === null) {
          // 结束事件不生成UI块
          expect(testCase.event.type).toBe('end')
          return
        }

        const actualBlock = mapEventToBlock(testCase.event)

        // 验证必需字段
        expect(actualBlock.type).toBe(testCase.expectedBlock.type)
        expect(actualBlock.status).toBe(testCase.expectedBlock.status)
        expect(actualBlock.timestamp).toBeDefined()
        expect(typeof actualBlock.timestamp).toBe('number')

        // 验证内容字段
        if (testCase.expectedBlock.content !== undefined) {
          expect(actualBlock.content).toBe(testCase.expectedBlock.content)
        }

        // 验证 action_type
        if (testCase.expectedBlock.action_type) {
          expect(actualBlock.action_type).toBe(testCase.expectedBlock.action_type)
        }

        // 验证 tool_call 对象
        if (testCase.expectedBlock.tool_call) {
          expect(actualBlock.tool_call).toMatchObject(testCase.expectedBlock.tool_call)
        }

        // 验证 image_data
        if (testCase.expectedBlock.image_data) {
          expect(actualBlock.image_data).toEqual(testCase.expectedBlock.image_data)
        }

        // 验证 extra 字段
        if (testCase.expectedBlock.extra) {
          expect(actualBlock.extra).toEqual(testCase.expectedBlock.extra)
        }
      })
    })
  })

  describe('Status Transition Rules', () => {
    statusTransitionCases.forEach(({ from, to, valid }) => {
      it(`should ${valid ? 'allow' : 'reject'} transition from ${from} to ${to}`, () => {
        const isValid = isValidStatusTransition(from as any, to as any)
        expect(isValid).toBe(valid)
      })
    })
  })

  describe('Block Type Validation', () => {
    it('should only allow defined block types', () => {
      const validBlockTypes = [
        'content',
        'search',
        'reasoning_content',
        'error',
        'tool_call',
        'action',
        'image',
        'artifact-thinking'
      ]

      mappingTestCases.forEach((testCase) => {
        if (testCase.expectedBlock && testCase.expectedBlock.type) {
          expect(validBlockTypes).toContain(testCase.expectedBlock.type)
        }
      })
    })

    it('should only allow defined action_type values', () => {
      const validActionTypes = ['tool_call_permission', 'maximum_tool_calls_reached', 'rate_limit']

      mappingTestCases.forEach((testCase) => {
        if (testCase.expectedBlock?.action_type) {
          expect(validActionTypes).toContain(testCase.expectedBlock.action_type)
        }
      })
    })
  })

  describe('Tool Call ID Aggregation', () => {
    it('should maintain consistent tool_call_id across lifecycle', () => {
      const toolCallId = 'consistent-tool-123'

      const startEvent: LLMAgentEvent = {
        type: 'response',
        data: {
          eventId: 'test-123',
          tool_call: 'start',
          tool_call_id: toolCallId,
          tool_call_name: 'calculator'
        }
      }

      const runningEvent: LLMAgentEvent = {
        type: 'response',
        data: {
          eventId: 'test-123',
          tool_call: 'running',
          tool_call_id: toolCallId
        }
      }

      const endEvent: LLMAgentEvent = {
        type: 'response',
        data: {
          eventId: 'test-123',
          tool_call: 'end',
          tool_call_id: toolCallId,
          tool_call_response: 'Calculation complete'
        }
      }

      const startBlock = mapEventToBlock(startEvent)
      const runningBlock = mapEventToBlock(runningEvent)
      const endBlock = mapEventToBlock(endEvent)

      expect(startBlock.tool_call?.id).toBe(toolCallId)
      expect(runningBlock.tool_call?.id).toBe(toolCallId)
      expect(endBlock.tool_call?.id).toBe(toolCallId)
    })
  })

  describe('Timestamp Monotonicity', () => {
    it('should generate increasing timestamps for sequential events', () => {
      const events: LLMAgentEvent[] = [
        {
          type: 'response',
          data: { eventId: 'test-123', content: 'First message' }
        },
        {
          type: 'response',
          data: { eventId: 'test-123', content: 'Second message' }
        },
        {
          type: 'response',
          data: { eventId: 'test-123', content: 'Third message' }
        }
      ]

      const blocks = events.map(mapEventToBlock)

      // 验证时间戳递增（允许相等，因为可能在同一毫秒内）
      for (let i = 1; i < blocks.length; i++) {
        expect(blocks[i].timestamp).toBeGreaterThanOrEqual(blocks[i - 1].timestamp)
      }
    })
  })

  describe('Error Recovery Patterns', () => {
    it('should handle end event with loading blocks correctly', () => {
      const loadingBlocks: AssistantMessageBlock[] = [
        {
          type: 'tool_call',
          status: 'loading',
          timestamp: Date.now(),
          tool_call: { id: 'tool-1', name: 'search' }
        },
        {
          type: 'content',
          status: 'success',
          timestamp: Date.now(),
          content: 'Completed text'
        }
      ]

      const endEvent: LLMAgentEvent = {
        type: 'end',
        data: { eventId: 'test-123', userStop: false }
      }

      const processedBlocks = processEndEvent(endEvent, loadingBlocks)

      // Loading blocks should be marked as error
      expect(processedBlocks[0].status).toBe('error')
      // Success blocks should remain unchanged
      expect(processedBlocks[1].status).toBe('success')
    })

    it('should preserve permission blocks during error recovery', () => {
      const blocksWithPermission: AssistantMessageBlock[] = [
        {
          type: 'action',
          action_type: 'tool_call_permission',
          status: 'pending',
          timestamp: Date.now()
        },
        {
          type: 'tool_call',
          status: 'loading',
          timestamp: Date.now(),
          tool_call: { id: 'tool-1', name: 'write' }
        }
      ]

      const endEvent: LLMAgentEvent = {
        type: 'end',
        data: { eventId: 'test-123', userStop: true }
      }

      const processedBlocks = processEndEvent(endEvent, blocksWithPermission)

      // Permission blocks should be preserved
      expect(processedBlocks[0].status).toBe('pending')
      expect(processedBlocks[0].action_type).toBe('tool_call_permission')
      // Tool call blocks should be marked as error
      expect(processedBlocks[1].status).toBe('error')
    })
  })
})

// Helper functions (same as in rendererContract.test.ts)
function mapEventToBlock(event: LLMAgentEvent): AssistantMessageBlock {
  const timestamp = Date.now()

  if (event.type === 'error') {
    return {
      type: 'error',
      content: event.data.error,
      status: 'error',
      timestamp
    }
  }

  if (event.type === 'response') {
    const { data } = event

    if (data.content) {
      return {
        type: 'content',
        content: data.content,
        status: 'success',
        timestamp
      }
    }

    if (data.reasoning_content) {
      return {
        type: 'reasoning_content',
        content: data.reasoning_content,
        status: 'success',
        timestamp
      }
    }

    if (data.tool_call) {
      if (data.tool_call === 'start') {
        return {
          type: 'tool_call',
          status: 'loading',
          timestamp,
          tool_call: {
            id: data.tool_call_id,
            name: data.tool_call_name,
            params: data.tool_call_params
          }
        }
      }

      if (data.tool_call === 'running') {
        return {
          type: 'tool_call',
          status: 'loading',
          timestamp,
          tool_call: {
            id: data.tool_call_id
          }
        }
      }

      if (data.tool_call === 'end') {
        return {
          type: 'tool_call',
          status: 'success',
          timestamp,
          tool_call: {
            id: data.tool_call_id,
            response: data.tool_call_response
          }
        }
      }

      if (data.tool_call === 'permission-required') {
        return {
          type: 'action',
          action_type: 'tool_call_permission',
          status: 'pending',
          timestamp,
          tool_call: {
            id: data.tool_call_id,
            name: data.tool_call_name
          }
        }
      }
    }

    if (data.rate_limit) {
      return {
        type: 'action',
        action_type: 'rate_limit',
        status: 'pending',
        timestamp,
        extra: data.rate_limit as any
      }
    }

    if (data.image_data) {
      return {
        type: 'image',
        status: 'success',
        timestamp,
        image_data: data.image_data
      }
    }
  }

  throw new Error(`Unsupported event: ${JSON.stringify(event)}`)
}

function isValidStatusTransition(
  from: AssistantMessageBlock['status'],
  to: AssistantMessageBlock['status']
): boolean {
  const validTransitions: Record<string, string[]> = {
    loading: ['success', 'error'],
    pending: ['granted', 'denied', 'error'],
    success: [],
    error: [],
    granted: [],
    denied: []
  }

  return validTransitions[from]?.includes(to) ?? false
}

function processEndEvent(
  event: LLMAgentEvent,
  blocks: AssistantMessageBlock[]
): AssistantMessageBlock[] {
  return blocks.map((block) => {
    // Preserve permission blocks
    if (block.type === 'action' && block.action_type === 'tool_call_permission') {
      return block
    }

    // Mark loading blocks as error
    if (block.status === 'loading') {
      return { ...block, status: 'error' }
    }

    return block
  })
}
