/**
 * Error classification utility to identify non-retryable errors.
 * Non-retryable errors should stop the agent loop, while all other errors
 * should allow the loop to continue so LLM can decide whether to retry.
 */

/**
 * Checks if an error is non-retryable (should stop the agent loop).
 *
 * Non-retryable errors are those that won't be resolved by retrying:
 * - Invalid input format (invalid URL, malformed JSON, etc.)
 * - Explicit permission denied
 * - Schema validation failures
 * - Authentication errors that can't be resolved by retry
 * - Malformed requests that won't work on retry
 *
 * All other errors (network errors, timeouts, destroyed objects, etc.)
 * are considered retryable by default and should allow the loop to continue.
 *
 * @param error - The error to classify (Error object or string)
 * @returns true if the error is non-retryable (should stop loop), false otherwise
 */
export function isNonRetryableError(error: Error | string): boolean {
  const errorMessage = error instanceof Error ? error.message : String(error)
  const lowerMessage = errorMessage.toLowerCase()

  // Invalid URL format - won't work on retry
  if (
    lowerMessage.includes('invalid url') ||
    lowerMessage.includes('malformed url') ||
    lowerMessage.includes('url parse error') ||
    lowerMessage.includes('invalid uri')
  ) {
    return true
  }

  // Invalid JSON format in arguments - won't work on retry
  if (
    lowerMessage.includes('invalid json') ||
    lowerMessage.includes('json parse error') ||
    lowerMessage.includes('unexpected token') ||
    lowerMessage.includes('malformed json')
  ) {
    return true
  }

  // Schema validation failures - wrong parameter types, missing required fields
  if (
    lowerMessage.includes('schema validation') ||
    lowerMessage.includes('validation error') ||
    lowerMessage.includes('invalid argument') ||
    lowerMessage.includes('invalid parameter') ||
    lowerMessage.includes('required field') ||
    lowerMessage.includes('missing required') ||
    lowerMessage.includes('type error') ||
    lowerMessage.includes('type mismatch')
  ) {
    return false
  }

  // Explicit permission denied (user explicitly denied, not a transient error)
  if (
    lowerMessage.includes('permission denied') &&
    (lowerMessage.includes('explicitly') || lowerMessage.includes('user denied'))
  ) {
    return true
  }

  // Authentication errors that can't be resolved by retry
  if (
    lowerMessage.includes('authentication failed') &&
    (lowerMessage.includes('invalid credentials') ||
      lowerMessage.includes('invalid api key') ||
      lowerMessage.includes('unauthorized'))
  ) {
    return true
  }

  // Malformed requests that won't work on retry
  if (
    lowerMessage.includes('malformed request') ||
    lowerMessage.includes('invalid request format') ||
    lowerMessage.includes('bad request format')
  ) {
    return true
  }

  // Tool definition not found - won't work on retry
  if (lowerMessage.includes('tool definition not found') || lowerMessage.includes('unknown tool')) {
    return true
  }

  // All other errors are considered retryable by default
  // This includes:
  // - "Object has been destroyed" / "WebContents destroyed"
  // - Network errors (SSL failures, connection errors, error codes -3, -100)
  // - Timeout errors
  // - Loading errors
  // - Transient service errors
  // - Rate limiting
  return false
}
