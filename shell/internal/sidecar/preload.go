package sidecar

import (
	"runtime"
	"strconv"
	"strings"
)

// PreloadScript wraps DeepChat's real typed createBridge in the minimal
// ipcRenderer-compatible transport expected by mygo. Probe-only Eval belongs to
// shell/spike and is deliberately not a method on the product Bridge.
func PreloadScript(bundle string) string {
	return strings.NewReplacer(
		"/*__DEEPCHAT_BRIDGE__*/", bundle,
		"__MYGO_PLATFORM__", strconv.Quote(runtime.GOOS),
		"__MYGO_ARCH__", strconv.Quote(runtime.GOARCH),
	).Replace(deepchatBridgeSidecar)
}

const deepchatBridgeSidecar = `
(() => {
  const listeners = new Set()
  window.mygo.on('deepchat.event', (envelope) => {
    for (const listener of listeners) listener({}, envelope)
  })

  const ipcRenderer = {
    invoke: async (channel, ...args) => {
      if (channel !== 'deepchat:route:invoke') {
        throw new Error('Unsupported channel: ' + channel)
      }
      const [route, input] = args
      const raw = await window.mygo.call('Bridge.Invoke', route, JSON.stringify(input ?? {}))
      return JSON.parse(raw)
    },
    on: (channel, listener) => {
      if (channel === 'deepchat:event') listeners.add(listener)
    },
    removeListener: (channel, listener) => {
      if (channel === 'deepchat:event') listeners.delete(listener)
    }
  }

  window.__step = 'start'
  try {
    /*__DEEPCHAT_BRIDGE__*/
    window.__step = 'bundled'
    window.deepchat = DeepchatBridge.createBridge(ipcRenderer)
    window.__step = 'created'
  } catch (error) {
    // Surface the failure instead of leaving the page without a bridge.
    window.__deepchatPreloadError = String((error && error.stack) || error)
    window.deepchat = undefined
  }
  if (!window.deepchat) return
  window.api = {
    invoke: (route, input) => window.deepchat.invoke(route, input),
    on: (name, fn) => window.deepchat.on(name, fn),
    removeListener: () => {},
    openExternal: async (url) => {
      await window.mygo.call('Bridge.OpenExternal', url)
    },
    copyText: (text) => window.mygo.call('Bridge.CopyText', text),
    copyImage: (dataUrl) => window.mygo.call('Bridge.CopyImage', dataUrl),
    readClipboardText: () => window.mygo.call('Bridge.ReadClipboardText'),
    getPathForFile: () => '',
    getPlatform: () => __MYGO_PLATFORM__,
    getArch: () => __MYGO_ARCH__,
    toRelativePath: (filePath) => filePath
  }
})()
`
