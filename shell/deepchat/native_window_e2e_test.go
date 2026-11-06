//go:build e2e

package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"

	"github.com/egoist/mygo"
)

func TestMain(m *testing.M) {
	runtime.LockOSThread()
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
		go mygo.App.Quit()
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
