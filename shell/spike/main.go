// Command spike is the DeepChat mygo feasibility probe.
//
// It exists only to answer the questions in docs/features/mygo-rewrite/m0-spike.md
// on the machine that runs it. It is not part of the shipped app.
//
// Run it with:
//
//	go run . -seconds 8
//
// It opens one window, exercises the desktop capabilities DeepChat needs, writes
// findings to stdout as "SPIKE <key>=<value>" lines, then closes itself.
//
// Generate the TypeScript client without opening a window with:
//
//	MYGO_GENERATE=./frontend/mygo.gen.ts go run .
package main

import (
	"context"
	"embed"
	"encoding/base64"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io/fs"
	"log"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"github.com/egoist/mygo"
	"github.com/egoist/mygo/transfer"
)

//go:embed frontend
var frontendFiles embed.FS

// Progress is the payload of the streaming probe event, shaped like the
// snapshots DeepChat pushes to its renderer.
type Progress struct {
	Sequence int    `json:"sequence"`
	Payload  string `json:"payload"`
}

// ProgressChanged reports progress to every page.
var ProgressChanged = mygo.NewEvent[Progress]("spike.progress")

// DeepchatEvent carries one typed event from the sidecar to every page, in the
// same shape as DeepChat's event envelope: a name plus a JSON payload.
type DeepchatEvent struct {
	Name    string          `json:"name"`
	Payload json.RawMessage `json:"payload"`
}

var deepchatEvent = mygo.NewEvent[DeepchatEvent]("deepchat.event")

// Bridge is the Go service the page calls. Its method names match what the
// generated TypeScript client exposes.
type Bridge struct {
	window   *mygo.Window
	windowID int
	report   func(string, any)
	sidecar  *sidecarProcess
}

// Ping answers immediately, so the page can prove request/response works.
func (b *Bridge) Ping(message string) string {
	b.report("ping.calls", 1)
	return "pong:" + message
}

// Info returns runtime facts the spike wants in its report.
func (b *Bridge) Info() map[string]any {
	return map[string]any{
		"go":       runtime.Version(),
		"platform": runtime.GOOS + "/" + runtime.GOARCH,
		"pid":      os.Getpid(),
	}
}

// Stream pushes count values through a channel as fast as it can, so the page
// can time the throughput of mygo's streaming path.
func (b *Bridge) Stream(ctx context.Context, count int, payloadBytes int, out *mygo.Channel[string]) error {
	started := time.Now()
	defer func() { b.report("stream.durationMs", time.Since(started).Milliseconds()) }()
	payload := strings.Repeat("x", payloadBytes)
	for i := 0; i < count; i++ {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}
		if err := out.Send(payload); err != nil {
			return err
		}
	}
	return nil
}

// Emit sends one event to the page that called it.
func (b *Bridge) Emit(message string) error {
	return ProgressChanged.Emit(b.window, Progress{Sequence: 1, Payload: message})
}

// Screenshot captures the window's page as PNG and returns its size, which is
// what DeepChat's long-screenshot export needs.
func (b *Bridge) Screenshot() (int, error) {
	png, err := b.window.CapturePage()
	if err != nil {
		return 0, err
	}
	return len(png), nil
}

// PDF prints the page to PDF and returns its size, which is what DeepChat's
// export needs.
func (b *Bridge) PDF() (int, error) {
	data, err := b.window.Page().PrintToPDF(mygo.PDFOptions{})
	if err != nil {
		return 0, err
	}
	return len(data), nil
}

// Eval runs script in the page, which DeepChat uses for scroll capture and
// preview automation.
func (b *Bridge) Eval(script string) (string, error) {
	value, err := b.window.Page().Eval(script)
	if err != nil {
		return "", err
	}
	text, ok := value.(string)
	if !ok {
		return fmt.Sprint(value), nil
	}
	return text, nil
}

// Invoke answers the routes the shell owns and forwards the rest to the Node
// sidecar. Window control belongs to the shell: it owns the native window, and
// routing it through Node would only add a hop.
func (b *Bridge) Invoke(route string, inputJSON string) (string, error) {
	if answer, ok, err := b.shellRoute(route); ok {
		return answer, err
	}
	if b.sidecar == nil {
		return "{}", errors.New("sidecar not started")
	}
	return b.sidecar.call(route, inputJSON)
}

// shellRoute serves the window and app routes the Go shell implements itself.
// Each answer is the exact JSON the typed contract expects.
func (b *Bridge) shellRoute(route string) (string, bool, error) {
	win := b.window
	if win == nil {
		return "", false, nil
	}

	windowState := func() string {
		return fmt.Sprintf(
			`{"state":{"windowId":%d,"exists":true,"isMaximized":%t,"isFullScreen":%t,"isFocused":%t}}`,
			b.windowID, win.IsMaximized(), win.IsFullScreen(), win.IsFocused(),
		)
	}

	switch route {
	case "window.getRuntimeIdentity":
		return fmt.Sprintf(`{"windowId":%d,"webContentsId":%d}`, b.windowID, b.windowID), true, nil
	case "window.getCurrentState":
		return windowState(), true, nil
	case "window.minimizeCurrent":
		win.Minimize()
		return windowState(), true, nil
	case "window.toggleMaximizeCurrent":
		win.ToggleMaximize()
		return windowState(), true, nil
	case "window.closeCurrent":
		win.Close()
		return `{"closed":true}`, true, nil
	case "notification.rendererReady":
		// The shell knows when the page has loaded; the renderer is ready as soon as
		// it can ask, so answering this needs no round trip into Node.
		return `{"ready":true}`, true, nil
	case "device.selectDirectory", "device.selectFiles":
		// Native file dialogs belong to the shell: the sidecar has no window to
		// attach a sheet to. The answer is the contract's plain shape.
		paths, err := mygo.Dialog.Open(mygo.OpenDialogOptions{
			Title:     "Select",
			Directory: route == "device.selectDirectory",
			Parent:    win,
		})
		if err != nil {
			return "", true, err
		}
		quoted, err := json.Marshal(paths)
		if err != nil {
			return "", true, err
		}
		if paths == nil {
			quoted = []byte("[]")
		}
		return fmt.Sprintf(`{"canceled":%t,"filePaths":%s}`, len(paths) == 0, quoted), true, nil
	default:
		return "", false, nil
	}
}

// OpenExternal hands a URL to the system browser.
func (b *Bridge) OpenExternal(url string) {
	_ = mygo.Shell.OpenExternal(url)
}

// CopyText writes text to the system clipboard.
func (b *Bridge) CopyText(text string) {
	_ = mygo.Clipboard.Write(transfer.TextData(text))
}

// CopyImage writes an image data URL to the system clipboard.
func (b *Bridge) CopyImage(dataURL string) {
	payload, ok := strings.CutPrefix(dataURL, "data:image/png;base64,")
	if !ok {
		b.report("clipboard.unsupported", dataURL[:min(len(dataURL), 32)])
		return
	}
	image, err := base64.StdEncoding.DecodeString(payload)
	if err != nil {
		b.report("clipboard.decodeError", err.Error())
		return
	}
	err = mygo.Clipboard.Write(
		transfer.New(transfer.NewItem(transfer.Bytes(transfer.PNG, image))),
	)
	b.report("clipboard.imageWritten", err == nil)
}

// Report records a result the page measured, so the spike prints it as well.
func (b *Bridge) Report(name string, ok bool, detail string) {
	b.report("page."+name, fmt.Sprintf("%t %s", ok, detail))
}

// ProtocolURL returns a URL served by the custom scheme registered in main, so
// the page can fetch it and prove custom protocols work.
func (b *Bridge) ProtocolURL() string {
	return "spikeasset://localhost/hello.txt"
}

func main() {
	processStarted := time.Now()
	seconds := flag.Int("seconds", 8, "how long the window stays open")
	rendererDir := flag.String("renderer", "", "serve out/renderer from this directory instead of the built-in probe page")
	sidecarScript := flag.String("sidecar", "", "spawn this Node script as the invoke target")
	probeScript := flag.String("probe", "", "JavaScript to evaluate in the page after it loads, printing the result")
	shotPath := flag.String("shot", "", "write a PNG screenshot of the page to this path")
	dumpPreload := flag.String("dump-preload", "", "write the composed preload script to this path")
	trayIcon := flag.String("tray-icon", "../../build/icon.png", "PNG shown in the menu bar")
	shortcutKey := flag.String("shortcut", "CmdOrCtrl+Shift+D", "global shortcut that toggles the window")
	notify := flag.Bool("notify", false, "show a system notification once the window is ready")
	appPath := flag.String("app-path", "../..", "repository root the sidecar treats as the app directory")
	bridgeScript := flag.String(
		"bridge",
		"../../out/preload/bridge.js",
		"bundled createBridge IIFE injected into the sidecar preload",
	)
	flag.Parse()

	findings := map[string]any{}
	report := func(key string, value any) {
		findings[key] = value
		fmt.Printf("SPIKE %s=%v\n", key, value)
	}

	sub, err := fs.Sub(frontendFiles, "frontend")
	if err != nil {
		log.Fatalf("spike: frontend: %v", err)
	}
	if *rendererDir != "" {
		sub = os.DirFS(*rendererDir)
		report("frontend", *rendererDir)
	}
	mygo.SetFrontend(sub)

	if err := mygo.Protocol.Handle("spikeasset", mygo.FileServer(sub)); err != nil {
		report("protocol.error", err.Error())
	} else {
		report("protocol.registered", true)
	}

	// The sidecar resolves resources (ACP registry, provider catalog) from the app
	// directory, which is not its working directory.
	if abs, err := filepath.Abs(*appPath); err == nil {
		_ = os.Setenv("DEEPCHAT_APP_PATH", abs)
	}

	bridge := &Bridge{report: report}
	if *sidecarScript != "" {
		process, startErr := startSidecar(*sidecarScript)
		if startErr != nil {
			report("sidecar.error", startErr.Error())
		} else {
			bridge.sidecar = process
			process.onEvent = func(name string, payload json.RawMessage) {
				_ = deepchatEvent.Broadcast(DeepchatEvent{Name: name, Payload: payload})
			}
			report("sidecar.started", true)
		}
	}
	mygo.Bind(bridge)

	mygo.App.WhenReady(func() {
		report("startup.readyMs", time.Since(processStarted).Milliseconds())
		preload := deepchatBridgeStub
		if *sidecarScript != "" {
			bridge, err := os.ReadFile(*bridgeScript)
			if err != nil {
				report("bridge.missing", err.Error())
				preload = deepchatBridgeSidecar // renders with the stub, so the window still opens
			} else {
				// Not Sprintf: the bundle contains percent signs that would be read as verbs.
				preload = strings.Replace(
					deepchatBridgeSidecar,
					"/*__DEEPCHAT_BRIDGE__*/",
					string(bridge),
					1,
				)
				report("bridge.injected", len(bridge))
				if *dumpPreload != "" {
					_ = os.WriteFile(*dumpPreload, []byte(preload), 0o644)
				}
			}
		}
		win := mygo.NewWindow(mygo.WindowOptions{
			Title:  "DeepChat mygo spike",
			URL:    "/",
			Width:  1280,
			Height: 820,
			Page: mygo.PageOptions{
				PreloadScript: preload,
			},
		})
		if *trayIcon != "" {
			trayMenu := mygo.NewMenu([]*mygo.MenuItem{
				{
					ID:    "show",
					Label: "显示窗口",
					Click: func(*mygo.MenuItem, *mygo.Window) { win.Show(); win.Focus() },
				},
				{
					ID:    "hide",
					Label: "隐藏窗口",
					Click: func(*mygo.MenuItem, *mygo.Window) { win.Hide() },
				},
				mygo.Separator(),
				{ID: "quit", Label: "退出", Role: mygo.RoleQuit},
			})
			icon, err := os.ReadFile(*trayIcon)
			if err != nil {
				report("tray.iconError", err.Error())
			} else if tray, err := mygo.NewTray(mygo.TrayOptions{
				ID:             "deepchat-spike",
				Icon:           icon,
				IconIsTemplate: true,
				Title:          "DeepChat",
				ToolTip:        "DeepChat mygo spike",
				Menu:           trayMenu,
			}); err != nil {
				report("tray.error", err.Error())
			} else {
				tray.OnClick(func() { win.Show(); win.Focus() })
				report("tray.created", true)
				report("tray.menuItems", len(trayMenu.Items()))
			}
		}

		if *notify {
			notification := mygo.NewNotification(mygo.NotificationOptions{
				ID:    "deepchat-spike-ready",
				Title: "DeepChat",
				Body:  "mygo spike ready",
			})
			if err := notification.Show(); err != nil {
				report("notification.error", err.Error())
			} else {
				report("notification.shown", true)
			}
		}

		if *shortcutKey != "" {
			err := mygo.GlobalShortcut.Register(*shortcutKey, func() {
				if win.IsFocused() {
					win.Hide()
				} else {
					win.Show()
					win.Focus()
				}
			})
			if err != nil {
				report("shortcut.error", err.Error())
			} else {
				report("shortcut.registered", *shortcutKey)
			}
		}

		bridge.window = win
		bridge.windowID = win.ID()
		report("window.created", true)
		report("startup.windowMs", time.Since(processStarted).Milliseconds())
		win.Page().OnDidFinishLoad(func() {
			report("startup.loadedMs", time.Since(processStarted).Milliseconds())
		})

		// Secrets: DeepChat keeps provider credentials and the database password in the
		// OS store. Probe a throwaway key and remove it again.
		if err := mygo.Secrets.Set("spike-probe", []byte("probe-value")); err != nil {
			report("secrets.error", err.Error())
		} else {
			value, getErr := mygo.Secrets.Get("spike-probe")
			report("secrets.roundtrip", getErr == nil && string(value) == "probe-value")
			_ = mygo.Secrets.Delete("spike-probe")
		}

		captureShot := func() {
			png, shotErr := win.CapturePage()
			if shotErr != nil {
				report("shot.error", shotErr.Error())
				return
			}
			if writeErr := os.WriteFile(*shotPath, png, 0o644); writeErr != nil {
				report("shot.error", writeErr.Error())
				return
			}
			report("shot.bytes", len(png))
		}

		if *shotPath != "" && *probeScript == "" {
			go func() {
				<-time.After(5 * time.Second)
				captureShot()
			}()
		}

		if *probeScript != "" {
			go func() {
				<-time.After(2 * time.Second)
				value, evalErr := win.Page().Eval(*probeScript)
				report("probe.result", fmt.Sprintf("%v err=%v", value, evalErr))
				if *shotPath != "" {
					captureShot()
				}
			}()
		}

		go func() {
			<-time.After(time.Duration(*seconds) * time.Second)
			width, height := win.Size()
			report("window.size", fmt.Sprintf("%dx%d", width, height))
			win.Close()
			mygo.App.Quit()
		}()
	})

	if err := mygo.App.Run(); err != nil && !errors.Is(err, context.Canceled) {
		log.Fatalf("spike: run: %v", err)
	}
}

// deepchatBridgeStub stands in for the Electron preload so the real DeepChat
// renderer can boot inside mygo. Every route answers with an empty object, which
// is enough to prove the page loads and renders; a real shell would forward the
// calls to the Node sidecar instead.
const deepchatBridgeStub = `
(() => {
  const listeners = new Map()
  const empty = {}
  const invoke = async (name) => {
    window.__spikeCalls = window.__spikeCalls || []
    window.__spikeCalls.push(name)
    return empty
  }
  window.deepchat = { invoke, on: (name, fn) => { listeners.set(name, fn); return () => listeners.delete(name) } }
  window.api = {
    invoke,
    on: (name, fn) => { listeners.set(name, fn); return () => listeners.delete(name) },
    removeListener: () => {},
    openExternal: async () => {},
    copyText: () => {},
    copyImage: () => {},
    readClipboardText: async () => '',
    getPathForFile: () => '',
    getPlatform: () => 'darwin',
    getArch: () => 'arm64'
  }
})()
`
