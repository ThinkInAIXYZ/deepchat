package main

import (
	"context"
	"errors"
	"log"
	"os"
	"strconv"
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
	var rendererLoadStarted atomic.Bool
	var manager *sidecar.Manager
	bridge := &Bridge{preload: sidecar.PreloadScript(string(preload))}
	defer func() {
		stopping.Store(true)
		if manager == nil {
			return
		}
		ctx, cancel := context.WithTimeout(context.Background(), 7*time.Second)
		defer cancel()
		if err := manager.Close(ctx); err != nil {
			log.Printf("close Node sidecar: %v", err)
		}
	}()
	mygo.Bind(bridge)
	mygo.App.OnSecondInstance(func(_ []string, _ string) {
		if window := bridge.primaryWindow(); window != nil {
			window.Show()
			window.Focus()
		}
	})
	mygo.App.WhenReady(func() {
		if layout.rendererDir != "" {
			files := os.DirFS(layout.rendererDir)
			mygo.SetFrontend(files)
			if err := mygo.Protocol.Handle("mygo", rendererProtocol(files)); err != nil {
				log.Fatalf("configure frontend probe: %v", err)
			}
		}
		// Register the real window before Node can emit any events. Load the
		// application only after the real dispatcher, not just Node, is ready.
		window := mygo.NewWindow(mygo.WindowOptions{
			Title:  "DeepChat",
			URL:    "about:blank",
			Width:  1280,
			Height: 820,
			Page: mygo.PageOptions{
				PreloadScript: sidecar.PreloadScript(string(preload)),
			},
		})
		bridge.registerWindow(window, nativeWindowMain)
		// A fast startup can announce readiness before StartManager returns.
		// Publish the manager before the first page can issue an IPC request.
		managerAssigned := make(chan struct{})
		manager, err = sidecar.StartManager(sidecar.ManagerOptions{
			Process: sidecar.Options{
				NodePath:        layout.nodePath,
				ScriptPath:      layout.sidecarEntry,
				Stderr:          os.Stderr,
				RequestTimeout:  90 * time.Second,
				ShutdownTimeout: 5 * time.Second,
				Env:             []string{"DEEPCHAT_NATIVE_WINDOW_ID=" + strconv.Itoa(window.ID())},
			},
			MaxRestarts: 3,
			Backoff:     500 * time.Millisecond,
			OnUnexpectedExit: func(err error) {
				if !stopping.Load() {
					log.Printf("sidecar exited unexpectedly; replacement scheduled: %v", err)
				}
			},
			OnCommand: bridge.handleNativeWindowCommand,
			OnEvent: func(event sidecar.Event) {
				if event.Name == "app.quit.requested" {
					stopping.Store(true)
					go mygo.App.Quit()
					return
				}
				if event.Name == "sidecar.app.started" || stopping.Load() {
					return
				}
				if err := bridge.deliverEvent(event); err != nil {
					log.Printf("discard sidecar event: %v", err)
				}
			},
			OnReady: func() {
				<-managerAssigned
				window := bridge.primaryWindow()
				if window == nil {
					return
				}
				if rendererLoadStarted.Swap(true) {
					log.Print("sidecar replacement ready; rebuilding renderer subscriptions")
					window.Page().Reload()
					return
				}
				if err := window.Page().LoadURL("/"); err != nil {
					log.Printf("load renderer after sidecar startup: %v", err)
					go mygo.App.Quit()
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
			log.Printf("start Node sidecar: %v", err)
			go mygo.App.Quit()
			return
		}
		bridge.setProcess(manager)
		close(managerAssigned)
	})

	if err := mygo.App.Run(); err != nil && !errors.Is(err, context.Canceled) {
		log.Printf("application stopped with an error: %v", err)
	}
}
