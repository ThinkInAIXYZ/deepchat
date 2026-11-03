import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto'
import path from 'node:path'
import type { CoreKernelNative } from '../harness/core/kernel'
import type { CoreProfileHost } from '../main/app/profileStartup'
import type { DatabaseSecurityCryptoPort } from '../main/app/databaseSecurity'
import { createCoreConfigurationNative } from '../main/harness/configuration'
import { cacheImage } from '../main/platform/imageCache'
import { isAcpRegistryIconUrl } from '../main/agent/acp/catalog/acpRegistryConstants'
import { setLegacyConsoleDebugEnabled } from '../shared/logger'
import type { DeepchatEventPayload, DeepchatEventPublisher } from '../shared/contracts/events'
import type { NativeConfigurationSnapshot } from '../shared/types/nativeConfiguration'
import type { CoreProxySnapshot } from '../shared/harness/desktop'

export interface HeadlessNativeOptions {
  profileDirectory: string
  temporaryDirectory: string
  masterKey: Uint8Array
  databasePassword?: string
  publishEvent: DeepchatEventPublisher
  publishNativeSnapshot?(snapshot: NativeConfigurationSnapshot): void | Promise<void>
  requestApproval?(
    payload: DeepchatEventPayload<'approvals.requested'>,
    signal: AbortSignal
  ): Promise<'approved' | 'denied'>
  quit?(): void | Promise<void>
}

const CREDENTIAL_PREFIX = 'headless:v1:'
const CREDENTIAL_CONTEXT = Buffer.from('deepchat.headless.credentials.v1')

export function createHeadlessNative({
  masterKey,
  databasePassword: initialDatabasePassword,
  ...options
}: HeadlessNativeOptions) {
  if (!path.isAbsolute(options.profileDirectory) || !path.isAbsolute(options.temporaryDirectory))
    throw new Error('Headless Native directories must be absolute')
  if (!(masterKey instanceof Uint8Array) || masterKey.byteLength !== 32)
    throw new Error('Headless Native requires a 32-byte master key')

  const credentialKey = Buffer.from(
    hkdfSync('sha256', masterKey, CREDENTIAL_CONTEXT, 'credentials', 32)
  )
  const ocrKey = Buffer.from(hkdfSync('sha256', masterKey, CREDENTIAL_CONTEXT, 'ocr-cache', 32))
  const lifetime = new AbortController()
  const pending = new Set<Promise<unknown>>()
  const configurationCalls = new Set<Promise<unknown>>()
  let closing: Promise<void> | undefined
  let databasePassword = initialDatabasePassword
  let theme: 'dark' | 'light' | 'system' = 'system'
  const inheritedProxy =
    process.env.https_proxy ??
    process.env.HTTPS_PROXY ??
    process.env.http_proxy ??
    process.env.HTTP_PROXY ??
    null
  const inheritedNoProxy = process.env.no_proxy ?? process.env.NO_PROXY ?? ''
  let proxy: CoreProxySnapshot = { version: 0, proxyUrl: null, noProxy: inheritedNoProxy }

  const assertActive = () => lifetime.signal.throwIfAborted()
  const unavailable = (): never => {
    assertActive()
    throw new Error('Desktop capability is unavailable in headless mode')
  }
  const noPresentation = () => {
    assertActive()
  }
  const emptyCleanup = async () => {}
  const active = async () => assertActive()
  const perform = <T>(effect: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal) => {
    assertActive()
    const operationSignal = signal ? AbortSignal.any([lifetime.signal, signal]) : lifetime.signal
    const operation = Promise.resolve().then(async () => {
      operationSignal.throwIfAborted()
      const result = await effect(operationSignal)
      operationSignal.throwIfAborted()
      return result
    })
    pending.add(operation)
    void operation.then(
      () => pending.delete(operation),
      () => pending.delete(operation)
    )
    return operation
  }

  const crypto: DatabaseSecurityCryptoPort = {
    isAvailable: async () => !lifetime.signal.aborted,
    getBackend: async () => {
      assertActive()
      return 'headless-aes-256-gcm'
    },
    encrypt: async (value) => {
      assertActive()
      const nonce = randomBytes(12)
      const cipher = createCipheriv('aes-256-gcm', credentialKey, nonce)
      cipher.setAAD(CREDENTIAL_CONTEXT)
      const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
      return (
        CREDENTIAL_PREFIX +
        Buffer.concat([nonce, cipher.getAuthTag(), ciphertext]).toString('base64url')
      )
    },
    decrypt: async (wrapped) => {
      assertActive()
      if (!wrapped.startsWith(CREDENTIAL_PREFIX))
        throw new Error('Unsupported headless credential envelope')
      const encoded = wrapped.slice(CREDENTIAL_PREFIX.length)
      const envelope = Buffer.from(encoded, 'base64url')
      if (envelope.byteLength < 28 || envelope.toString('base64url') !== encoded)
        throw new Error('Invalid headless credential envelope')
      try {
        const decipher = createDecipheriv('aes-256-gcm', credentialKey, envelope.subarray(0, 12))
        decipher.setAAD(CREDENTIAL_CONTEXT)
        decipher.setAuthTag(envelope.subarray(12, 28))
        return Buffer.concat([decipher.update(envelope.subarray(28)), decipher.final()]).toString(
          'utf8'
        )
      } catch {
        throw new Error('Headless credential authentication failed')
      }
    }
  }
  const applyLogging = async (enabled: boolean) => {
    assertActive()
    setLegacyConsoleDebugEnabled(enabled)
  }
  const profileHost: CoreProfileHost = {
    setLoggingEnabled: applyLogging,
    showDatabaseUnlockProgress: async () => assertActive(),
    requestDatabaseUnlock: async ({ reason }) => {
      assertActive()
      const password = databasePassword
      databasePassword = undefined
      if (!password || reason === 'invalid')
        throw new Error('Headless database unlock requires an explicit valid database password')
      return password
    },
    requestDatabaseRecovery: async () => {
      assertActive()
      throw new Error('Database recovery requires an explicit offline recovery operation')
    },
    quit: async () => {
      assertActive()
      await options.quit?.()
    }
  }
  const configure = createCoreConfigurationNative({
    desktop: {
      systemLocale: Intl.DateTimeFormat().resolvedOptions().locale,
      readTheme: async () => ({ theme, isDark: theme === 'dark' }),
      applyTheme: async (value) => {
        theme = value
        return theme === 'dark'
      },
      refreshLanguage: active,
      refreshTheme: active,
      readLaunchAtLogin: async () => false,
      setLaunchAtLogin: unavailable,
      applyContentProtection: async (enabled) => {
        if (enabled) unavailable()
      },
      applyFloatingButtonEnabled: async (enabled) => {
        if (enabled) unavailable()
      }
    },
    logging: { applyLogging, openLoggingFolder: unavailable },
    enumerateFonts: async () => [],
    publishNativeSnapshot: (snapshot) => options.publishNativeSnapshot?.(snapshot),
    publishEvent: options.publishEvent
  })
  const configuration: typeof configure = (method, args) => {
    const operation = perform(async () => await configure(method, args))
    configurationCalls.add(operation)
    void operation.then(
      () => configurationCalls.delete(operation),
      () => configurationCalls.delete(operation)
    )
    return operation
  }
  const kernel: CoreKernelNative = {
    // There is no Native settings file mirror or renderer writer in this host.
    configurationHost: {
      pause: active,
      resume: active,
      stopWrites: active,
      drainWrites: async () => {
        await Promise.all(configurationCalls)
      },
      startWrites: active
    },
    isSettingsWindow: async () => false,
    isMainWindowContext: async () => false,
    rendererPerformance: { record: async () => false },
    splash: { showDebugScenario: unavailable, closeDebugScenario: async () => false },
    images: { saveImage: unavailable, copyImage: unavailable },
    pickToolchainPath: unavailable,
    hasTrustedRenderer: async () => false,
    applyProxy: async (mode, url) => {
      assertActive()
      let proxyUrl = mode === 'none' ? null : mode === 'custom' ? url : inheritedProxy
      if (proxyUrl) {
        try {
          const parsed = new URL(proxyUrl)
          if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error()
          proxyUrl = parsed.href
        } catch {
          throw new Error('Invalid headless HTTP proxy URL')
        }
      }
      proxy = { version: proxy.version + 1, proxyUrl: proxyUrl || null, noProxy: inheritedNoProxy }
      return proxy.proxyUrl !== null
    },
    copilotAuthorization: { browser: unavailable, device: unavailable },
    sessionPresentation: {
      focusBrowser: unavailable,
      setComputerUsePreview: unavailable,
      dismissComputerUsePreview: async () => false
    },
    workspaceDesktop: {
      revealFile: unavailable,
      openFile: unavailable,
      listFileOpenApps: async () => [],
      openFileWithApp: unavailable
    },
    approvalPresentation: {
      getTarget: async () => (options.requestApproval ? { host: 'terminal' } : null),
      present: async (target, payload, signal) => {
        if (!('host' in target) || target.host !== 'terminal' || !options.requestApproval)
          unavailable()
        return await perform(
          async (operationSignal) => await options.requestApproval!(payload, operationSignal),
          signal
        )
      },
      close: emptyCleanup
    },
    ocrCacheKeyProvider: {
      loadOrCreateKey: async () => {
        assertActive()
        return Buffer.from(ocrKey)
      }
    },
    initializeFloatingButton: active,
    assertSyncTokenStorageAvailable: active,
    semanticNotifications: {
      occur: (intent) => {
        assertActive()
        console.warn(`[Headless] ${intent.code}`)
      },
      recover: noPresentation
    },
    secureCrypto: crypto,
    providerCrypto: crypto,
    getProxySnapshot: async () => {
      assertActive()
      return { ...proxy }
    },
    openExternal: unavailable,
    openPath: unavailable,
    selectDirectory: unavailable,
    cacheImage: (data, input) =>
      perform(async (signal) => {
        if (process.env.DEEPCHAT_USER_DATA_DIR !== options.profileDirectory)
          throw new Error('Headless image cache profile does not match bootstrap')
        return await cacheImage(data, { ...input, signal })
      }, input?.signal),
    agentDesktop: {
      tempDirectory: options.temporaryDirectory,
      profileTempDirectory: path.join(options.profileDirectory, 'temp'),
      readImageSize: (filePath, signal) =>
        perform(async (operationSignal) => {
          const { default: sharp } = await import('sharp')
          operationSignal.throwIfAborted()
          const { width, height } = await sharp(filePath).metadata()
          if (!width || !height) throw new Error('Image dimensions are unavailable')
          return { width, height }
        }, signal),
      createSettingsWindow: unavailable,
      sendSettingsNavigation: async () => false
    },
    pluginSettingsWindow: {
      open: unavailable,
      close: emptyCleanup,
      closeAll: emptyCleanup,
      getPluginIdForWebContents: async () => null
    },
    remoteAuthWindows: { open: unavailable, close: emptyCleanup, closeAll: emptyCleanup },
    remoteSessionWindow: { select: async () => null, present: unavailable },
    showNotification: unavailable,
    mcpPreview: undefined,
    sessionUiPort: { refreshSessionUi: active },
    mcpReadinessChanged: noPresentation,
    reportStartupFailure: (component) => {
      assertActive()
      console.warn(`[Headless] Startup failed: ${component}`)
    },
    onSessionInactive: noPresentation,
    renderer: {
      broadcast: (event) => {
        assertActive()
        options.publishEvent(event.name, event.payload)
      },
      send() {}
    },
    onRendererDestroyed: () => () => {},
    sendToRenderer() {},
    destroySessionBrowser: emptyCleanup,
    observeDelegation: noPresentation,
    runJournalObserver: undefined,
    notifySessionCompletion: active,
    fetchRegistryIcon: (url, signal) =>
      perform(async (operationSignal) => {
        if (!isAcpRegistryIconUrl(url)) throw new Error('Unsupported ACP registry icon URL')
        const response = await fetch(url, { signal: operationSignal, redirect: 'error' })
        if (!response.ok) throw new Error(`Failed to fetch ACP registry icon: ${response.status}`)
        const text = await response.text()
        if (text.length > 1024 * 1024) throw new Error('ACP registry icon exceeds the size limit')
        return text
      }, signal),
    mcpAppDesktop: { observeOwner: unavailable, openExternal: unavailable },
    publishMcpConsent: unavailable
  }

  const close = (): Promise<void> => {
    if (closing) return closing
    closing = Promise.resolve().then(async () => {
      await Promise.allSettled(pending)
    })
    lifetime.abort(new Error('Headless Native is stopped'))
    credentialKey.fill(0)
    ocrKey.fill(0)
    databasePassword = undefined
    return closing
  }

  return { kernel, crypto, profileHost, configuration, close }
}
