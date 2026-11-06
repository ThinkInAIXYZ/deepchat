//go:build e2e

package main

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/egoist/mygo"
	"github.com/egoist/mygo/ui"
)

func TestMain(m *testing.M) {
	runtime.LockOSThread()
	mygo.App.OnWindowAllClosed(func() {})
	exitCode := make(chan int, 1)
	go func() {
		code := m.Run()
		mygo.App.Quit()
		exitCode <- code
	}()
	if err := mygo.App.Run(); err != nil && !errors.Is(err, context.Canceled) {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	os.Exit(<-exitCode)
}

func TestNativeDocumentFragmentNavigation(t *testing.T) {
	result := make(chan error, 1)
	finish := func(err error) {
		result <- err
	}
	mygo.App.WhenReady(func() {
		root, err := filepath.Abs("../..")
		if err != nil {
			finish(err)
			return
		}
		frontend := os.DirFS(filepath.Join(root, "out", "renderer"))
		mygo.SetFrontend(frontend)
		if err := mygo.Protocol.Handle("mygo", rendererProtocol(frontend)); err != nil {
			finish(err)
			return
		}
		// Page-only fixture: notifications intentionally have no sidecar receiver.
		bridge := &Bridge{}
		window := mygo.NewWindow(mygo.WindowOptions{URL: "about:blank", Hidden: true})
		if window == nil {
			finish(errors.New("create fragment navigation test window"))
			return
		}
		bridge.registerWindow(window, nativeWindowSettings)
		go func() {
			defer window.Close()
			bridge.mu.RLock()
			navigation := bridge.windows[window.ID()].navigation
			bridge.mu.RUnlock()
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer cancel()
			const current = "mygo://localhost/settings/index.html#/old"
			const target = "mygo://localhost/settings/index.html#/new"
			if err := bridge.loadNativeDocument(ctx, window, current, navigation); err != nil {
				finish(fmt.Errorf("load initial document: %w", err))
				return
			}
			if !isSameDocumentFragmentNavigation(target, window.Page().URL()) {
				finish(fmt.Errorf("test did not reach a fragment-only navigation from %q", window.Page().URL()))
				return
			}
			if err := bridge.loadNativeDocument(ctx, window, target, navigation); err != nil {
				finish(fmt.Errorf("load fragment-only document: %w", err))
				return
			}
			if got := window.Page().URL(); got != target {
				finish(fmt.Errorf("fragment navigation URL = %q, want %q", got, target))
				return
			}
			finish(nil)
		}()
	})
	defer mygo.Protocol.Unhandle("mygo")
	if err := <-result; err != nil {
		t.Fatal(err)
	}
}

func TestNativePrimaryPageRejectsSecondaryWebView(t *testing.T) {
	result := make(chan error, 1)
	finish := func(err error) { result <- err }
	mygo.App.WhenReady(func() {
		bridge := &Bridge{}
		mygo.Bind(bridge)
		if err := mygo.Protocol.Handle("mygo", http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			_, _ = w.Write([]byte(`<!doctype html><script>
window.nativeInvocation = Promise.race([
  window.mygo.call('Bridge.Invoke', 'config.getLanguage', '{}').then(
    (value) => 'resolved:' + value,
    (error) => 'rejected:' + (error?.message || String(error))
  ),
  new Promise((resolve) => setTimeout(() => resolve('rejected:timeout'), 5000))
])
</script>`))
		})); err != nil {
			finish(err)
			return
		}
		var primary, secondary *mygo.WebView
		window := mygo.NewWindow(mygo.WindowOptions{
			Hidden: true,
			Content: ui.View(func(c *ui.Context) {
				if primary != nil && secondary != nil {
					ui.Column(c).Fill().Children(func() {
						ui.WebView(c, primary).Grow(1)
						ui.WebView(c, secondary).Grow(1)
					})
				}
			}),
		})
		var err error
		primary, err = window.NewWebView(mygo.WebViewOptions{URL: "about:blank"})
		if err != nil {
			window.Close()
			finish(err)
			return
		}
		secondary, err = window.NewWebView(mygo.WebViewOptions{URL: "about:blank"})
		if err != nil {
			window.Close()
			finish(err)
			return
		}
		bridge.registerWindowPage(window, nativeWindowMain, primary.Page())
		window.Invalidate()
		if err := primary.Page().LoadURL("mygo://localhost/"); err != nil {
			window.Close()
			finish(err)
			return
		}
		if err := secondary.Page().LoadURL("mygo://localhost/"); err != nil {
			window.Close()
			finish(err)
			return
		}
		go func() {
			defer window.Close()
			primaryAnswer, err := evalNativeInvocation(primary.Page())
			if err != nil {
				finish(fmt.Errorf("evaluate primary caller: %w", err))
				return
			}
			if !strings.Contains(primaryAnswer, "sidecar is not available") {
				finish(fmt.Errorf("primary caller did not reach the expected business boundary: %q", primaryAnswer))
				return
			}
			secondaryAnswer, err := evalNativeInvocation(secondary.Page())
			if err != nil {
				finish(fmt.Errorf("evaluate secondary caller: %w", err))
				return
			}
			if !strings.Contains(secondaryAnswer, "registered primary application page") {
				finish(fmt.Errorf("secondary caller was not rejected by Page identity: %q", secondaryAnswer))
				return
			}
			finish(nil)
		}()
	})
	defer mygo.Protocol.Unhandle("mygo")
	if err := <-result; err != nil {
		t.Fatal(err)
	}
}

func evalNativeInvocation(page *mygo.Page) (string, error) {
	deadline := time.Now().Add(10 * time.Second)
	for {
		answer, err := mygo.EvalAs[string](page, "window.nativeInvocation")
		if err == nil && answer != "" {
			return answer, nil
		}
		if time.Now().After(deadline) {
			return "", fmt.Errorf("invocation did not complete: %w", err)
		}
		time.Sleep(20 * time.Millisecond)
	}
}
