//go:build e2e

package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/ThinkInAIXYZ/deepchat/shell/internal/sidecar"
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

type nativePageTestBridge struct{ *Bridge }

func (b *nativePageTestBridge) Source(ctx context.Context) (string, error) {
	source, _, err := b.requestSource(ctx)
	if err != nil {
		return "", err
	}
	encoded, err := json.Marshal(source)
	if err != nil {
		return "", err
	}
	return string(encoded), nil
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

func TestNativePageIdentityAndLifecycle(t *testing.T) {
	result := make(chan error, 1)
	finish := func(err error) { result <- err }
	mygo.App.WhenReady(func() {
		testBridge := &nativePageTestBridge{&Bridge{}}
		bridge := testBridge.Bridge
		mygo.BindAs("Bridge", testBridge)
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
window.nativeSource = Promise.race([
  window.mygo.call('Bridge.Source').then(
    (value) => 'resolved:' + value,
    (error) => 'rejected:' + (error?.message || String(error))
  ),
  new Promise((resolve) => setTimeout(() => resolve('rejected:timeout'), 5000))
])
window.nativeHostRoute = Promise.race([
  window.mygo.call('Bridge.Invoke', 'window.getCurrentState', '{}').then(
    (value) => 'resolved:' + value,
    (error) => 'rejected:' + (error?.message || String(error))
  ),
  new Promise((resolve) => setTimeout(() => resolve('rejected:timeout'), 5000))
])
window.nativeEvents = []
window.mygo.on('deepchat.event', (event) => window.nativeEvents.push(event))
</script>`))
		})); err != nil {
			finish(err)
			return
		}
		var primary, secondary *mygo.WebView
		window := mygo.NewWindow(mygo.WindowOptions{
			Hidden: true,
			Content: ui.View(func(c *ui.Context) {
				ui.Box(c).Fill().Children(func() {
					if primary != nil {
						ui.WebView(c, primary).Fill()
						for _, placement := range bridge.nestedPagePlacements(primary.Window().ID()) {
							ui.WebView(c, placement.view).Absolute().
								Left(float32(placement.bounds.X)).Top(float32(placement.bounds.Y)).
								Size(float32(placement.bounds.Width), float32(placement.bounds.Height))
						}
					}
				})
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
			primaryAnswer, err := evalNativeInvocation(primary.Page(), "window.nativeInvocation")
			if err != nil {
				finish(fmt.Errorf("evaluate primary caller: %w", err))
				return
			}
			if !strings.Contains(primaryAnswer, "sidecar is not available") {
				finish(fmt.Errorf("primary caller did not reach the expected business boundary: %q", primaryAnswer))
				return
			}
			secondaryAnswer, err := evalNativeInvocation(secondary.Page(), "window.nativeInvocation")
			if err != nil {
				finish(fmt.Errorf("evaluate secondary caller: %w", err))
				return
			}
			if !strings.Contains(secondaryAnswer, "registered application page") {
				finish(fmt.Errorf("secondary caller was not rejected by Page identity: %q", secondaryAnswer))
				return
			}

			command := func(action string, input map[string]any) (any, error) {
				input["action"] = action
				encoded, _ := json.Marshal(input)
				return bridge.handleNativeWindowCommand(context.Background(), sidecar.NativeWindowCommand{
					Type: sidecar.NativeWindowCommandType, ID: -1, Host: true, Input: encoded,
				})
			}
			secondary.Destroy()
			created, err := command("ensure_page", map[string]any{"windowId": window.ID()})
			if err != nil {
				finish(fmt.Errorf("create nested page: %w", err))
				return
			}
			nested := created.(nativePageState)
			nonHostInput, _ := json.Marshal(map[string]any{"action": "ensure_page", "windowId": window.ID()})
			_, err = bridge.handleNativeWindowCommand(context.Background(), sidecar.NativeWindowCommand{
				Type: sidecar.NativeWindowCommandType, ID: -2, Input: nonHostInput,
				Source: &sidecar.RequestSource{WindowID: window.ID(), DocumentURL: "mygo://localhost/"},
			})
			if err == nil || !strings.Contains(err.Error(), "requires a host command") {
				finish(fmt.Errorf("renderer-created command was not rejected: %v", err))
				return
			}
			for _, action := range []string{
				"load_page", "attach_page", "detach_page", "bounds_page", "visible_page", "focus_page", "close_page",
			} {
				input, _ := json.Marshal(map[string]any{
					"action": action, "pageId": nested.PageID, "documentUrl": "mygo://localhost/",
					"x": 0, "y": 36, "width": 640, "height": 400, "visible": true,
				})
				_, err = bridge.handleNativeWindowCommand(context.Background(), sidecar.NativeWindowCommand{
					Type: sidecar.NativeWindowCommandType, ID: -2, Input: input,
					Source: &sidecar.RequestSource{WindowID: window.ID(), DocumentURL: "mygo://localhost/"},
				})
				if err == nil || !strings.Contains(err.Error(), "host command") {
					finish(fmt.Errorf("non-host %s was not rejected: %v", action, err))
					return
				}
			}
			if _, err = command("load_page", map[string]any{
				"pageId": nested.PageID, "documentUrl": "mygo://localhost/",
			}); err != nil {
				finish(fmt.Errorf("load nested page: %w", err))
				return
			}
			if _, err = command("bounds_page", map[string]any{
				"pageId": nested.PageID, "x": 0, "y": 36, "width": 640, "height": 400,
			}); err != nil {
				finish(err)
				return
			}
			if _, err = command("attach_page", map[string]any{"pageId": nested.PageID}); err != nil {
				finish(err)
				return
			}
			placements := bridge.nestedPagePlacements(window.ID())
			if len(placements) != 1 || placements[0].bounds.Width != 640 || placements[0].bounds.Height != 400 {
				finish(fmt.Errorf("nested placement was not applied: %+v", placements))
				return
			}

			sourceAnswer, err := evalNativeInvocation(nestedViewPage(bridge, nested.PageID), "window.nativeSource")
			if err != nil || !strings.HasPrefix(sourceAnswer, "resolved:") {
				finish(fmt.Errorf("read nested source: %q %v", sourceAnswer, err))
				return
			}
			var source sidecar.RequestSource
			if err := json.Unmarshal([]byte(strings.TrimPrefix(sourceAnswer, "resolved:")), &source); err != nil {
				finish(err)
				return
			}
			if source.PageID != nested.PageID || source.WindowID != window.ID() {
				finish(fmt.Errorf("nested source identity = %+v, want page %d in window %d", source, nested.PageID, window.ID()))
				return
			}
			hostWindowInput, _ := json.Marshal(map[string]any{"action": "show", "windowId": window.ID()})
			_, err = bridge.handleNativeWindowCommand(context.Background(), sidecar.NativeWindowCommand{
				Type: sidecar.NativeWindowCommandType, ID: -3, Input: hostWindowInput,
				Source: &sidecar.RequestSource{
					WindowID: window.ID(), PageID: nested.PageID, DocumentURL: "mygo://localhost/",
				},
			})
			if err == nil || !strings.Contains(err.Error(), "requires a primary page caller") {
				finish(fmt.Errorf("nested caller reached a host window command: %v", err))
				return
			}
			hostRouteAnswer, err := evalNativeInvocation(nestedViewPage(bridge, nested.PageID), "window.nativeHostRoute")
			if err != nil || !strings.Contains(hostRouteAnswer, "sidecar is not available") {
				finish(fmt.Errorf("nested route bypassed the business dispatcher: %q %v", hostRouteAnswer, err))
				return
			}
			if err := bridge.deliverEvent(sidecar.Event{
				Name: "test.nested", Payload: json.RawMessage(`{"value":42}`),
				Source: &sidecar.EventTarget{WindowID: window.ID(), PageID: nested.PageID},
			}); err != nil {
				finish(err)
				return
			}
			eventName, err := mygo.EvalAs[string](nestedViewPage(bridge, nested.PageID), "window.nativeEvents.at(-1)?.name ?? ''")
			if err != nil || eventName != "test.nested" {
				finish(fmt.Errorf("nested event was not delivered to its page: %q %v", eventName, err))
				return
			}
			primaryEvents, err := mygo.EvalAs[int](primary.Page(), "window.nativeEvents.length")
			if err != nil || primaryEvents != 0 {
				finish(fmt.Errorf("nested event leaked into primary: count=%d err=%v", primaryEvents, err))
				return
			}
			if _, err = command("visible_page", map[string]any{"pageId": nested.PageID, "visible": false}); err != nil {
				finish(err)
				return
			}
			if got := len(bridge.nestedPagePlacements(window.ID())); got != 0 {
				finish(fmt.Errorf("hidden nested page still has %d placements", got))
				return
			}
			if _, err = command("visible_page", map[string]any{"pageId": nested.PageID, "visible": true}); err != nil {
				finish(err)
				return
			}
			if _, err = command("focus_page", map[string]any{"pageId": nested.PageID}); err != nil {
				finish(err)
				return
			}
			externalServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path == "/start" {
					http.Redirect(w, r, "/final", http.StatusFound)
					return
				}
				w.Header().Set("Content-Type", "text/html; charset=utf-8")
				_, _ = w.Write([]byte(`<!doctype html><title>External fixture</title><body>external</body>`))
			}))
			defer externalServer.Close()
			external, err := command("load_page", map[string]any{
				"pageId": nested.PageID, "documentUrl": externalServer.URL + "/start",
			})
			if err != nil {
				finish(fmt.Errorf("load redirected external page: %w", err))
				return
			}
			if got := external.(nativePageState).DocumentURL; got != externalServer.URL+"/final" {
				finish(fmt.Errorf("redirected external URL = %q", got))
				return
			}
			if err := bridge.deliverEvent(sidecar.Event{
				Name: "test.external", Payload: json.RawMessage(`{}`),
				Source: &sidecar.EventTarget{WindowID: window.ID(), PageID: nested.PageID},
			}); err == nil || !strings.Contains(err.Error(), "without business document access") {
				finish(fmt.Errorf("external nested page received a business event: %v", err))
				return
			}

			oldView := nestedViewPage(bridge, nested.PageID).WebView()
			bridge.nativeWindowEnvironment()
			if !oldView.IsDestroyed() {
				finish(errors.New("replacement did not destroy the old native view"))
				return
			}
			if _, err := bridge.nestedPage(nested.PageID); err == nil {
				finish(errors.New("replacement kept the old nested page"))
				return
			}
			recreated, err := command("ensure_page", map[string]any{"windowId": window.ID()})
			if err != nil {
				finish(err)
				return
			}
			if next := recreated.(nativePageState).PageID; next <= nested.PageID {
				finish(fmt.Errorf("replacement reused page ID %d after %d", next, nested.PageID))
				return
			}
			nextID := recreated.(nativePageState).PageID
			if _, err = command("close_page", map[string]any{"pageId": nextID}); err != nil {
				finish(err)
				return
			}
			if _, err = command("close_page", map[string]any{"pageId": nextID}); err == nil {
				finish(errors.New("repeated nested close succeeded"))
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

func nestedViewPage(bridge *Bridge, id uint64) *mygo.Page {
	record, _ := bridge.nestedPage(id)
	return record.page
}

func evalNativeInvocation(page *mygo.Page, expression string) (string, error) {
	deadline := time.Now().Add(10 * time.Second)
	for {
		answer, err := mygo.EvalAs[string](page, expression)
		if err == nil && answer != "" {
			return answer, nil
		}
		if time.Now().After(deadline) {
			return "", fmt.Errorf("invocation did not complete: %w", err)
		}
		time.Sleep(20 * time.Millisecond)
	}
}
