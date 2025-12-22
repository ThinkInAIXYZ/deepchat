import safeRegex from 'safe-regex2'

const DEFAULT_MAX_PATTERN_LENGTH = 1000

/**
 * Validate regex pattern for ReDoS safety
 * @param pattern The regex pattern to validate
 * @param maxLength Maximum allowed pattern length (default: 1000)
 * @throws Error if pattern is unsafe or exceeds length limit
 */
export function validateRegexPattern(
  pattern: string,
  maxLength: number = DEFAULT_MAX_PATTERN_LENGTH
): void {
  // Check length limit
  if (pattern.length > maxLength) {
    throw new Error(
      `Regular expression pattern exceeds maximum length of ${maxLength} characters. Pattern length: ${pattern.length}`
    )
  }

  // Check for ReDoS vulnerability using safe-regex2
  if (!safeRegex(pattern)) {
    throw new Error(
      `Regular expression pattern is potentially unsafe and may cause ReDoS (Regular Expression Denial of Service). Please use a simpler, safer pattern.`
    )
  }
}

/**
 * Check if a regex pattern is safe (non-throwing version)
 * @param pattern The regex pattern to check
 * @param maxLength Maximum allowed pattern length (default: 1000)
 * @returns true if pattern is safe, false otherwise
 */
export function isSafeRegexPattern(
  pattern: string,
  maxLength: number = DEFAULT_MAX_PATTERN_LENGTH
): boolean {
  // Check length limit
  if (pattern.length > maxLength) {
    return false
  }

  // Check for ReDoS vulnerability using safe-regex2
  return safeRegex(pattern)
}
