package main

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"strings"
	"sync"

	"github.com/ThinkInAIXYZ/deepchat/shell/internal/sidecar"
	"github.com/egoist/mygo"
	"github.com/egoist/mygo/transfer"
)

type deepchatEventPayload struct {
	Name    string          `json:"name"`
	Payload json.RawMessage `json:"payload"`
}

var deepchatEvent = mygo.NewEvent[deepchatEventPayload]("deepchat.event")

// Bridge deliberately exposes only product operations used by the renderer and
// preload. Probe methods such as arbitrary Eval do not belong in this package.
type Bridge struct {
	mu          sync.RWMutex
	primary     *mygo.Window
	windows     map[int]*mygo.Window
	process     *sidecar.Manager
	externalURL func(string) error
}

func (b *Bridge) registerWindow(window *mygo.Window) {
	if window == nil || window.ID() <= 0 {
		panic("cannot register an invalid native window")
	}
	b.mu.Lock()
	if b.windows == nil {
		b.windows = map[int]*mygo.Window{}
	}
	if existing := b.windows[window.ID()]; existing != nil && existing != window {
		b.mu.Unlock()
		panic("native window ID is already registered")
	}
	b.windows[window.ID()] = window
	if b.primary == nil || b.primary.IsDestroyed() {
		b.primary = window
	}
	b.mu.Unlock()
	remove := func() {
		b.mu.Lock()
		defer b.mu.Unlock()
		if b.windows[window.ID()] == window {
			delete(b.windows, window.ID())
		}
		if b.primary == window {
			b.primary = nil
		}
	}
	window.OnClosed(remove)
	if window.IsDestroyed() {
		remove()
	}
}

func (b *Bridge) primaryWindow() *mygo.Window {
	b.mu.RLock()
	defer b.mu.RUnlock()
	if b.primary == nil || b.primary.IsDestroyed() {
		return nil
	}
	return b.primary
}

func (b *Bridge) deliverEvent(event sidecar.Event) error {
	if event.Source == nil || event.Source.WindowID <= 0 {
		return errors.New("sidecar event has no native window target")
	}
	b.mu.RLock()
	window := b.windows[event.Source.WindowID]
	b.mu.RUnlock()
	if window == nil || window.IsDestroyed() {
		return errors.New("sidecar event targets an unregistered or destroyed native window")
	}
	return deepchatEvent.Emit(window, deepchatEventPayload{Name: event.Name, Payload: event.Payload})
}

func isPrimaryRendererDocument(rawURL string) bool {
	parsed, err := url.Parse(rawURL)
	if err != nil || parsed.User != nil || parsed.Scheme != "mygo" || parsed.Host != "localhost" {
		return false
	}
	switch parsed.EscapedPath() {
	case "", "/", "/index.html":
		return true
	default:
		return false
	}
}

func (b *Bridge) requestSource(ctx context.Context) (sidecar.RequestSource, *mygo.Window, error) {
	window := mygo.CallerWindow(ctx)
	page := mygo.CallerPage(ctx)
	if window == nil || window.IsDestroyed() || page == nil || page != window.Page() {
		return sidecar.RequestSource{}, nil, errors.New("renderer caller is not a live top-level application page")
	}
	b.mu.RLock()
	registered := b.windows[window.ID()]
	b.mu.RUnlock()
	if window.ID() <= 0 || registered == nil || registered != window {
		return sidecar.RequestSource{}, nil, errors.New("renderer caller is not a registered application window")
	}
	documentURL := page.URL()
	if !isPrimaryRendererDocument(documentURL) {
		return sidecar.RequestSource{}, nil, errors.New("renderer caller is not the primary application document")
	}
	return sidecar.RequestSource{WindowID: window.ID(), DocumentURL: documentURL}, window, nil
}

func (b *Bridge) authorize(ctx context.Context) error {
	_, _, err := b.requestSource(ctx)
	return err
}

func (b *Bridge) Invoke(ctx context.Context, route string, inputJSON string) (string, error) {
	source, window, err := b.requestSource(ctx)
	if err != nil {
		return "", err
	}
	if answer, handled, err := b.shellRoute(window, route); handled {
		return answer, err
	}
	if b.process == nil {
		return "", errors.New("sidecar is not available")
	}
	return b.process.Call(ctx, route, inputJSON, source)
}

func (b *Bridge) shellRoute(window *mygo.Window, route string) (string, bool, error) {
	windowState := func() string {
		return fmt.Sprintf(
			`{"state":{"windowId":%d,"exists":true,"isMaximized":%t,"isFullScreen":%t,"isFocused":%t}}`,
			window.ID(), window.IsMaximized(), window.IsFullScreen(), window.IsFocused(),
		)
	}
	switch route {
	case "window.getCurrentState":
		return windowState(), true, nil
	case "window.minimizeCurrent":
		window.Minimize()
		return windowState(), true, nil
	case "window.toggleMaximizeCurrent":
		window.ToggleMaximize()
		return windowState(), true, nil
	case "window.closeCurrent":
		window.Close()
		return `{"closed":true}`, true, nil
	case "notification.rendererReady":
		return `{"ready":true}`, true, nil
	case "device.selectDirectory", "device.selectFiles":
		paths, err := mygo.Dialog.Open(mygo.OpenDialogOptions{
			Title:     "Select",
			Directory: route == "device.selectDirectory",
			Parent:    window,
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

var allowedExternalSchemes = map[string]bool{
	"http": true, "https": true, "mailto": true, "tel": true, "deepchat": true,
}

func normalizeExternalURL(rawURL string) (string, error) {
	trimmed := strings.TrimSpace(rawURL)
	if trimmed == "" {
		return "", errors.New("external URL scheme is not allowed")
	}
	parsed, err := url.Parse(trimmed)
	if err != nil {
		return "", errors.New("external URL is malformed")
	}
	scheme := strings.ToLower(parsed.Scheme)
	if !allowedExternalSchemes[scheme] {
		return "", errors.New("external URL scheme is not allowed")
	}
	if (scheme == "http" || scheme == "https") && parsed.Host == "" {
		return "", errors.New("external HTTP URL must include a host")
	}
	return trimmed, nil
}

func (b *Bridge) OpenExternal(ctx context.Context, rawURL string) error {
	if err := b.authorize(ctx); err != nil {
		return err
	}
	normalized, err := normalizeExternalURL(rawURL)
	if err != nil {
		return err
	}
	open := b.externalURL
	if open == nil {
		open = mygo.Shell.OpenExternal
	}
	return open(normalized)
}

func (b *Bridge) CopyText(ctx context.Context, text string) error {
	if err := b.authorize(ctx); err != nil {
		return err
	}
	return mygo.Clipboard.Write(transfer.TextData(text))
}

func (b *Bridge) CopyImage(ctx context.Context, dataURL string) error {
	if err := b.authorize(ctx); err != nil {
		return err
	}
	payload, ok := strings.CutPrefix(dataURL, "data:image/png;base64,")
	if !ok {
		return errors.New("only PNG data URLs can be copied as images")
	}
	image, err := base64.StdEncoding.DecodeString(payload)
	if err != nil {
		return fmt.Errorf("invalid PNG data URL: %w", err)
	}
	return mygo.Clipboard.Write(
		transfer.New(transfer.NewItem(transfer.Bytes(transfer.PNG, image))),
	)
}

func (b *Bridge) ReadClipboardText(ctx context.Context) (string, error) {
	if err := b.authorize(ctx); err != nil {
		return "", err
	}
	return mygo.Clipboard.ReadText(), nil
}
