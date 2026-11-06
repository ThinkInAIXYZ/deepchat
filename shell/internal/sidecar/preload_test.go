package sidecar

import (
	"runtime"
	"strconv"
	"strings"
	"testing"
)

func TestPreloadScriptInjectsBundleAndRuntimeLiterals(t *testing.T) {
	const bundle = `window.localProbe = '%n must remain text'`
	script := PreloadScript(bundle)
	for _, expected := range []string{
		bundle,
		`getPlatform: () => ` + strconv.Quote(runtime.GOOS),
		`getArch: () => ` + strconv.Quote(runtime.GOARCH),
		`window.mygo.call('Bridge.ReadClipboardText')`,
	} {
		if !strings.Contains(script, expected) {
			t.Errorf("preload does not contain %q", expected)
		}
	}
	if strings.Contains(script, "/*__DEEPCHAT_BRIDGE__*/") || strings.Contains(script, "__MYGO_") {
		t.Fatal("preload contains unresolved placeholders")
	}
}
