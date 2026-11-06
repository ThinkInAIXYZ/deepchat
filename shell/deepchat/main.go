package main

import (
	"context"
	"errors"
	"log"
	"os"
	"sync/atomic"
	"time"

	"github.com/ThinkInAIXYZ/deepchat/shell/internal/sidecar"
	"github.com/egoist/mygo"
)

func main() {
	mygo.App.SetName("DeepChat")
	resourcesDir, err := mygo.App.Path(mygo.PathResources)
	if err != nil {
		log.Fatalf("resolve application resources: %v", err)
	}
	layout, err := resolveResourceLayout(resourcesDir)
	if err != nil {
		log.Fatalf("application resources: %v", err)
	}
	preload, err := os.ReadFile(layout.preloadPath)
	if err != nil {
		log.Fatalf("read renderer bridge: %v", err)
	}
	// Node's appHost resolves registries and bundled data from this root.
	if err := os.Setenv("DEEPCHAT_APP_PATH", layout.appRoot); err != nil {
		log.Fatalf("configure application root: %v", err)
	}

	// Single-instance ownership precedes database and sidecar startup. Later
	// instances only activate the existing native window and then exit.
	if !mygo.App.RequestSingleInstanceLock() {
		return
	}

	var stopping atomic.Bool
	var rendererReady atomic.Bool
	bridge := &Bridge{}
	manager, err := sidecar.StartManager(sidecar.ManagerOptions{
		Process: sidecar.Options{
			NodePath:        layout.nodePath,
			ScriptPath:      layout.sidecarEntry,
			Stderr:          os.Stderr,
			RequestTimeout:  90 * time.Second,
			ShutdownTimeout: 5 * time.Second,
		},
		MaxRestarts: 3,
		Backoff:     500 * time.Millisecond,
		OnUnexpectedExit: func(err error) {
			if !stopping.Load() {
				log.Printf("sidecar exited unexpectedly; replacement scheduled: %v", err)
			}
		},
		OnReady: func() {
			if rendererReady.Swap(true) {
				log.Print("sidecar replacement ready; rebuilding renderer subscriptions")
				if bridge.window != nil {
					bridge.window.Page().Reload()
				}
			}
		},
		OnExhausted: func(err error) {
			if !stopping.Load() {
				log.Printf("sidecar recovery exhausted; application will stop: %v", err)
				go mygo.App.Quit()
			}
		},
	})
	if err != nil {
		log.Fatalf("start Node sidecar: %v", err)
	}
	bridge.process = manager
	manager.SetEventHandler(func(event sidecar.Event) {
		if event.Name == "app.quit.requested" {
			stopping.Store(true)
			go mygo.App.Quit()
		}
		_ = deepchatEvent.Broadcast(deepchatEventPayload{Name: event.Name, Payload: event.Payload})
	})
	defer func() {
		stopping.Store(true)
		ctx, cancel := context.WithTimeout(context.Background(), 7*time.Second)
		defer cancel()
		if err := manager.Close(ctx); err != nil {
			log.Printf("close Node sidecar: %v", err)
		}
	}()

	mygo.Bind(bridge)
	mygo.App.OnSecondInstance(func(_ []string, _ string) {
		if bridge.window != nil {
			bridge.window.Show()
			bridge.window.Focus()
		}
	})
	mygo.App.WhenReady(func() {
		if layout.rendererDir != "" {
			mygo.SetFrontend(os.DirFS(layout.rendererDir))
		}
		window := mygo.NewWindow(mygo.WindowOptions{
			Title:  "DeepChat",
			URL:    "/",
			Width:  1280,
			Height: 820,
			Page: mygo.PageOptions{
				PreloadScript: sidecar.PreloadScript(string(preload)),
			},
		})
		bridge.window = window
		bridge.windowID = window.ID()
	})

	if err := mygo.App.Run(); err != nil && !errors.Is(err, context.Canceled) {
		log.Printf("application stopped with an error: %v", err)
	}
}
