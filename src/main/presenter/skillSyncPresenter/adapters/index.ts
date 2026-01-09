/**
 * Format Adapters Registry
 *
 * This module provides a registry of format adapters for different AI tools.
 * Each adapter handles parsing and serializing skills for a specific tool format.
 */

import type { IFormatAdapter } from '@shared/types/skillSync'
import { ClaudeCodeAdapter } from './claudeCodeAdapter'
import { CursorAdapter } from './cursorAdapter'
import { WindsurfAdapter } from './windsurfAdapter'
import { CopilotAdapter } from './copilotAdapter'
import { KiroAdapter } from './kiroAdapter'
import { AntigravityAdapter } from './antigravityAdapter'

/**
 * Registry of all available format adapters
 */
const adapters: Map<string, IFormatAdapter> = new Map()

/**
 * Register all built-in adapters
 */
function registerBuiltinAdapters(): void {
  const builtinAdapters: IFormatAdapter[] = [
    new ClaudeCodeAdapter(),
    new CursorAdapter(),
    new WindsurfAdapter(),
    new CopilotAdapter(),
    new KiroAdapter(),
    new AntigravityAdapter()
  ]

  for (const adapter of builtinAdapters) {
    adapters.set(adapter.id, adapter)
  }
}

// Initialize adapters on module load
registerBuiltinAdapters()

/**
 * Get an adapter by its ID
 */
export function getAdapter(id: string): IFormatAdapter | undefined {
  return adapters.get(id)
}

/**
 * Get all registered adapters
 */
export function getAllAdapters(): IFormatAdapter[] {
  return Array.from(adapters.values())
}

/**
 * Register a custom adapter
 */
export function registerAdapter(adapter: IFormatAdapter): void {
  adapters.set(adapter.id, adapter)
}

/**
 * Detect which adapter can parse the given content
 */
export function detectAdapter(content: string): IFormatAdapter | undefined {
  for (const adapter of adapters.values()) {
    if (adapter.detect(content)) {
      return adapter
    }
  }
  return undefined
}

export {
  ClaudeCodeAdapter,
  CursorAdapter,
  WindsurfAdapter,
  CopilotAdapter,
  KiroAdapter,
  AntigravityAdapter
}
