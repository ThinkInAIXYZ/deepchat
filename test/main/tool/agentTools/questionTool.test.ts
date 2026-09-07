import { describe, expect, it } from 'vitest'
import {
  parseQuestionToolArgs,
  QUESTION_TOOL_CONTRACT_HINT,
  QUESTION_TOOL_NAME
} from '@/tool/agentTools/questionTool'

describe('parseQuestionToolArgs', () => {
  it('normalizes valid question tool arguments and applies defaults', () => {
    const result = parseQuestionToolArgs(
      JSON.stringify({
        header: '  Clarify  ',
        question: '  Which option should we use?  ',
        options: [
          { label: '  Option A  ', description: '  First choice  ' },
          { label: 'Option B', description: '   ' }
        ]
      })
    )

    expect(result).toEqual({
      success: true,
      data: {
        header: 'Clarify',
        question: 'Which option should we use?',
        options: [{ label: 'Option A', description: 'First choice' }, { label: 'Option B' }],
        multiple: false,
        custom: true
      }
    })
  })

  it('repairs recoverable JSON before validation', () => {
    const result = parseQuestionToolArgs(
      '{"question":"Pick one","options":[{"label":"A","description":"  Alpha  ",},],}'
    )

    expect(result).toEqual({
      success: true,
      data: {
        question: 'Pick one',
        options: [{ label: 'A', description: 'Alpha' }],
        multiple: false,
        custom: true
      }
    })
  })

  it('normalizes option header aliases emitted by models', () => {
    const result = parseQuestionToolArgs(
      JSON.stringify({
        question: 'Your message seems incomplete. What would you like help with?',
        options: [
          {
            header: 'Continue working on DeepChat',
            description: 'Proceed with the current DeepChat project work'
          },
          { header: 'Something else', description: 'I will clarify what I need' }
        ]
      })
    )

    expect(result).toEqual({
      success: true,
      data: {
        question: 'Your message seems incomplete. What would you like help with?',
        options: [
          {
            label: 'Continue working on DeepChat',
            description: 'Proceed with the current DeepChat project work'
          },
          { label: 'Something else', description: 'I will clarify what I need' }
        ],
        multiple: false,
        custom: true
      }
    })
  })

  it('returns a contract hint when the JSON is not parseable', () => {
    expect(parseQuestionToolArgs('{"question":"\\uZZZZ"}')).toEqual({
      success: false,
      error: `Invalid JSON for question tool arguments. ${QUESTION_TOOL_CONTRACT_HINT}`
    })
  })

  it('rejects unsupported top-level fields even when required fields are present', () => {
    const cases = [
      {
        fieldName: 'allowOther',
        payload: {
          question: 'Pick one',
          options: [{ label: 'A' }],
          allowOther: true
        }
      },
      {
        fieldName: 'questions',
        payload: {
          question: 'Pick one',
          options: [{ label: 'A' }],
          questions: [{ question: 'Nested', options: [{ label: 'B' }] }]
        }
      }
    ] as const

    for (const testCase of cases) {
      const result = parseQuestionToolArgs(JSON.stringify(testCase.payload))

      expect(result.success).toBe(false)
      if (result.success) {
        throw new Error(`Expected ${testCase.fieldName} payload to be rejected`)
      }

      expect(result.error).toContain(`Invalid arguments for ${QUESTION_TOOL_NAME}.`)
      expect(result.error).toContain(QUESTION_TOOL_CONTRACT_HINT)
      expect(result.error).toContain(testCase.fieldName)
    }
  })
})
