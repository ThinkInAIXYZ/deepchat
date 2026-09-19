import { AGENT_MEMORY_DIRECTIVE_CJK_TOPIC_MIN_VISIBLE_CHARS } from '../types/agent-memory'
import { unicodeCodePointLength } from './unicodeText'

const CJK_SCRIPT_PATTERN =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u
const NON_VISIBLE_OR_COMBINING_PATTERN = /[\p{Cc}\p{Cf}\p{M}\p{Z}\s]+/gu

export function containsCjkScript(value: string): boolean {
  return CJK_SCRIPT_PATTERN.test(value.normalize('NFKC'))
}

export function isMemoryDirectiveTopicSpecificEnough(value: string): boolean {
  const normalized = value.normalize('NFKC')
  if (!CJK_SCRIPT_PATTERN.test(normalized)) return true

  const visibleBaseCharacters = normalized.replace(NON_VISIBLE_OR_COMBINING_PATTERN, '')
  return (
    unicodeCodePointLength(visibleBaseCharacters) >=
    AGENT_MEMORY_DIRECTIVE_CJK_TOPIC_MIN_VISIBLE_CHARS
  )
}
