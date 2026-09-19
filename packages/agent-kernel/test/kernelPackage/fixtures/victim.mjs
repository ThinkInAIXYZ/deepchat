// Negative gate probe: loads the real package entry, then swallows a forbidden dynamic import.
// The process must still exit non-zero because the sync resolve hook sets exitCode in-thread.
import { createDeepChatRuntimeServices } from '@deepchat/agent-kernel'

if (typeof createDeepChatRuntimeServices !== 'function') {
  process.exitCode = 1
}

try {
  await import('node-pty')
} catch {}

console.log('victim reached the end (exit code still decides)')
