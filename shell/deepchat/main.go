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
	"github.com/egoist/mygo/ui"
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
	splashPreload, err := os.ReadFile(layout.splashPreloadPath)
	if err != nil {
		log.Fatalf("read splash bridge: %v", err)
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
	bridge := &Bridge{
		preload:       sidecar.PreloadScript(string(preload)),
		splashPreload: sidecar.PreloadScript(string(preload) + "\n" + string(splashPreload)),
	}
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
		if err := bridge.registerNativeProtocols(); err != nil {
			log.Fatalf("configure native protocols: %v", err)
		}
		if layout.rendererDir != "" {
			files := os.DirFS(layout.rendererDir)
			mygo.SetFrontend(files)
			if err := mygo.Protocol.Handle("mygo", rendererProtocol(files)); err != nil {
				log.Fatalf("configure frontend probe: %v", err)
			}
		}
		// The native Content host gives the current renderer a real Page and lets
		// later nested views share the same window without inventing webContents IDs.
		var rendererView *mygo.WebView
		window := mygo.NewWindow(mygo.WindowOptions{
			Title:  "DeepChat",
			Hidden: true,
			Width:  1280,
			Height: 820,
			Content: ui.View(func(c *ui.Context) {
				ui.Box(c).Fill().Children(func() {
					if rendererView != nil {
						ui.WebView(c, rendererView).Fill()
						for _, placement := range bridge.nestedPagePlacements(rendererView.Window().ID()) {
							ui.WebView(c, placement.view).Absolute().
								Left(float32(placement.bounds.X)).Top(float32(placement.bounds.Y)).
								Size(float32(placement.bounds.Width), float32(placement.bounds.Height))
						}
					}
				})
			}),
		})
		rendererView, err = window.NewWebView(mygo.WebViewOptions{
			URL: "about:blank",
			Page: mygo.PageOptions{
				PreloadScript: sidecar.PreloadScript(string(preload)),
			},
		})
		if err != nil {
			log.Fatalf("create primary renderer view: %v", err)
		}
		bridge.registerWindowPage(window, nativeWindowMain, rendererView.Page())
		if err := configurePrimaryAutomation(bridge.primaryPage); err != nil {
			log.Fatalf("configure primary renderer automation: %v", err)
		}
		window.Invalidate()
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
			Environment: bridge.nativeWindowEnvironment,
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
				if event.Name == "sidecar.app.started" || event.Name == "sidecar.process.ready" || stopping.Load() {
					return
				}
				if err := bridge.deliverEvent(event); err != nil {
					log.Printf("discard sidecar event: %v", err)
				}
			},
			OnReady: func() {
				<-managerAssigned
				page := bridge.primaryPage()
				if page == nil {
					return
				}
				if rendererLoadStarted.Swap(true) {
					log.Print("sidecar replacement ready; rebuilding renderer subscriptions")
					page.Reload()
					return
				}
				if err := page.LoadURL("/"); err != nil {
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
