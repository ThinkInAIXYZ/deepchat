import { AsyncLocalStorage } from 'node:async_hooks'
import {
  parseNativeWindowDescriptor,
  type NativeCaller,
  type NativeWindowBounds,
  type NativeWindowCommand,
  type NativeWindowDescriptor
} from './nativeWindowProtocol'

const COMMAND_TIMEOUT_MS = 15_000
const ipcCaller = new AsyncLocalStorage<NativeCaller | undefined>()
const pending = new Map<number, PendingCommand>()
let nextCommandId = 0
let transport: ((command: NativeWindowCommand) => void) | undefined
const windowStates = new Map<number, NativeWindowDescriptor>()
const closedWindowSequences = new Map<number, number>()
const closingNativeWindows = new Set<number>()
type CloseWaiter = {
  resolve: () => void
  reject: (error: Error) => void
  timeout: ReturnType<typeof setTimeout>
}
const closeWaiters = new Map<number, CloseWaiter[]>()

export function recordNativeWindowState(state: NativeWindowDescriptor): boolean {
  const sequence = state.sequence ?? 0
  if (closedWindowSequences.has(state.windowId)) return false
  const previous = windowStates.get(state.windowId)
  if (previous && sequence < (previous.sequence ?? 0)) return false
  if (state.closeRequested || closingNativeWindows.has(state.windowId)) {
    closingNativeWindows.add(state.windowId)
    state = { ...state, closeRequested: true }
  }
  windowStates.set(state.windowId, state)
  return true
}

export function cachedNativeWindowState(windowId: number): NativeWindowDescriptor | undefined {
  return windowStates.get(windowId)
}

export function forgetNativeWindowState(windowId: number, sequence = 0): boolean {
  const closed = closedWindowSequences.get(windowId)
  if (closed !== undefined && sequence <= closed) return false
  closedWindowSequences.set(windowId, sequence)
  closingNativeWindows.delete(windowId)
  windowStates.delete(windowId)
  const waiters = closeWaiters.get(windowId) ?? []
  closeWaiters.delete(windowId)
  for (const waiter of waiters) {
    clearTimeout(waiter.timeout)
    waiter.resolve()
  }
  return true
}

export function waitForNativeSettingsWindowClosed(windowId: number): Promise<void> {
  if (closedWindowSequences.has(windowId)) return Promise.resolve()
  const state = windowStates.get(windowId)
  if (!state?.closeRequested || state.role !== 'settings') {
    return Promise.reject(new Error('native settings window has no pending close'))
  }
  return new Promise<void>((resolve, reject) => {
    let waiter: CloseWaiter
    const timeout = setTimeout(() => {
      const remaining = (closeWaiters.get(windowId) ?? []).filter((entry) => entry !== waiter)
      if (remaining.length > 0) closeWaiters.set(windowId, remaining)
      else closeWaiters.delete(windowId)
      reject(new Error(`native settings window ${windowId} did not close within 20 seconds`))
    }, 20_000)
    timeout.unref?.()
    waiter = { resolve, reject, timeout }
    closeWaiters.set(windowId, [...(closeWaiters.get(windowId) ?? []), waiter])
  })
}

export function restoreAfterNativeCloseFailure(state: NativeWindowDescriptor): void {
  if (closedWindowSequences.has(state.windowId)) return
  closingNativeWindows.delete(state.windowId)
  const previous = windowStates.get(state.windowId)
  if (previous) windowStates.set(state.windowId, { ...previous, closeRequested: false })
  else windowStates.set(state.windowId, { ...state, closeRequested: false })
  const waiters = closeWaiters.get(state.windowId) ?? []
  closeWaiters.delete(state.windowId)
  for (const waiter of waiters) {
    clearTimeout(waiter.timeout)
    waiter.reject(new Error('native window close request failed'))
  }
}

type PendingCommand = {
  resolve: (value: unknown) => void
  reject: (reason: Error) => void
  timeout: ReturnType<typeof setTimeout>
}

export function configureNativeWindowCommands(send: (command: NativeWindowCommand) => void): void {
  transport = send
}

export function runWithNativeCaller<T>(source: NativeCaller, run: () => T): T {
  return ipcCaller.run(source, run)
}

/** Explicit trusted main-process operations must not inherit an expiring IPC caller. */
export function runWithNativeHost<T>(run: () => T): T {
  return ipcCaller.run(undefined, run)
}

function request(
  caller: NativeCaller | undefined,
  input: NativeWindowCommand['input']
): Promise<unknown> {
  const send = transport
  if (!send) return Promise.reject(new Error('native window command transport is unavailable'))
  if (nextCommandId <= -Number.MAX_SAFE_INTEGER) {
    return Promise.reject(new Error('native window command identifier space is exhausted'))
  }
  const id = --nextCommandId
  return new Promise<unknown>((resolve, reject) => {
    const timeout = setTimeout(() => {
      pending.delete(id)
      reject(new Error('native window command timed out'))
    }, COMMAND_TIMEOUT_MS)
    pending.set(id, { resolve, reject, timeout })
    try {
      send({
        command: 'native.window',
        id,
        input,
        ...(caller ? { source: caller } : { host: true as const })
      })
    } catch (error) {
      clearTimeout(timeout)
      pending.delete(id)
      reject(error instanceof Error ? error : new Error(String(error)))
    }
  })
}

export function resolveNativeWindowCommand(id: unknown, result: unknown, error: unknown): boolean {
  if (typeof id !== 'number' || !Number.isSafeInteger(id) || id >= 0) return false
  const outstanding = pending.get(id)
  if (!outstanding) return false
  pending.delete(id)
  clearTimeout(outstanding.timeout)
  if (error !== undefined && error !== null && error !== '') {
    outstanding.reject(new Error(String(error)))
  } else {
    outstanding.resolve(result)
  }
  return true
}

export function createNativeSettingsWindow(
  bounds: NativeWindowBounds
): Promise<NativeWindowDescriptor> {
  const caller = ipcCaller.getStore()
  for (const [key, value] of Object.entries(bounds)) {
    if (!Number.isSafeInteger(value)) {
      return Promise.reject(new Error(`native settings bounds require an integer ${key}`))
    }
  }
  return request(caller, { action: 'ensure_settings', ...bounds }).then((value) => {
    const state = parseNativeWindowDescriptor(value)
    recordNativeWindowState(state)
    return windowStates.get(state.windowId) ?? state
  })
}

export function focusNativeApp(): Promise<void> {
  return request(ipcCaller.getStore(), { action: 'focus_app' }).then(() => undefined)
}

export function applyNativeWindowAction(
  window: NativeWindowDescriptor,
  action: 'load_document' | 'show' | 'hide' | 'focus' | 'close',
  documentUrl?: string
): Promise<NativeWindowDescriptor> {
  return request(ipcCaller.getStore(), {
    action,
    windowId: window.windowId,
    ...(documentUrl === undefined ? {} : { documentUrl })
  }).then((result) => {
    const answer = parseNativeWindowDescriptor(result)
    const state: NativeWindowDescriptor =
      action === 'close'
        ? {
            ...(windowStates.get(answer.windowId) ?? answer),
            closeRequested: true,
            sequence: Math.max(
              windowStates.get(answer.windowId)?.sequence ?? 0,
              answer.sequence ?? 0
            )
          }
        : answer
    if (recordNativeWindowState(state)) {
      return windowStates.get(state.windowId) ?? state
    }
    if (action === 'close' && closedWindowSequences.has(state.windowId)) return state
    const current = windowStates.get(state.windowId)
    if (current) return current
    throw new Error('native window action completed after the window closed')
  })
}

export function activateNativeSettingsWindow(windowId: number): Promise<void> {
  const state = windowStates.get(windowId)
  if (!state || state.role !== 'settings') {
    return Promise.reject(new Error('native settings window is not bound'))
  }
  if (state.closeRequested) {
    return Promise.reject(new Error('native settings window is closing'))
  }
  return applyNativeWindowAction(state, 'show')
    .then((visible) => applyNativeWindowAction(visible, 'focus'))
    .then(() => undefined)
}

export function closeNativeSettingsWindow(windowId: number): Promise<void> {
  const state = windowStates.get(windowId)
  if (!state || state.role !== 'settings') {
    return Promise.reject(new Error('native settings cleanup has no matching descriptor'))
  }
  if (state.closeRequested) return waitForNativeSettingsWindowClosed(windowId)
  return runWithNativeHost(() => applyNativeWindowAction(state, 'close')).then(
    () => waitForNativeSettingsWindowClosed(windowId),
    (error: unknown) => {
      restoreAfterNativeCloseFailure(state)
      throw error
    }
  )
}

export function isNativeWindowClosing(windowId: number): boolean {
  return windowStates.get(windowId)?.closeRequested === true
}
