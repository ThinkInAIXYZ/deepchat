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

const nativeSplashChannelRoute = "native.splash.channel"

var allowedSplashChannels = map[string]bool{
	"database-security:unlock-submit":   true,
	"database-security:unlock-cancel":   true,
	"database-security:recovery-submit": true,
	"database-security:recovery-cancel": true,
}

// Bridge deliberately exposes only product operations used by the renderer and
// preload. Probe methods such as arbitrary Eval do not belong in this package.
type Bridge struct {
	mu                 sync.RWMutex
	primary            *mygo.Window
	settings           *mygo.Window
	splash             *mygo.Window
	windows            map[int]nativeWindowRecord
	pages              map[uint64]nativePageRecord
	nextPageID         uint64
	nextPageZ          uint64
	process            *sidecar.Manager
	externalURL        func(string) error
	preload            string
	splashPreload      string
	nativeCommands     sync.Mutex
	closingWindows     map[int]bool
	windowSequences    map[int]uint64
	notificationQueue  []nativeWindowNotification
	notificationSignal chan struct{}
}

func (b *Bridge) setProcess(manager *sidecar.Manager) {
	b.mu.Lock()
	b.process = manager
	b.mu.Unlock()
}

func (b *Bridge) manager() *sidecar.Manager {
	b.mu.RLock()
	defer b.mu.RUnlock()
	return b.process
}

func (b *Bridge) deliverEvent(event sidecar.Event) error {
	if event.Source == nil || event.Source.WindowID <= 0 {
		return errors.New("sidecar event has no native window target")
	}
	if event.Source.PageID != 0 {
		nested, err := b.nestedPage(event.Source.PageID)
		if err != nil || nested.window.ID() != event.Source.WindowID {
			return errors.New("sidecar event targets an unregistered or destroyed nested page")
		}
		return deepchatEvent.EmitPage(nested.page, deepchatEventPayload{Name: event.Name, Payload: event.Payload})
	}
	b.mu.RLock()
	registered := b.windows[event.Source.WindowID]
	b.mu.RUnlock()
	if registered.window == nil || registered.window.IsDestroyed() || registered.page == nil {
		return errors.New("sidecar event targets an unregistered or destroyed native window")
	}
	return deepchatEvent.EmitPage(registered.page, deepchatEventPayload{Name: event.Name, Payload: event.Payload})
}

func isPrimaryRendererDocument(rawURL string) bool {
	return isRendererDocument(nativeWindowMain, rawURL)
}

func (b *Bridge) requestSource(ctx context.Context) (sidecar.RequestSource, *mygo.Window, error) {
	window := mygo.CallerWindow(ctx)
	page := mygo.CallerPage(ctx)
	if window == nil || window.IsDestroyed() || page == nil {
		return sidecar.RequestSource{}, nil, errors.New("renderer caller is not a live application page")
	}
	b.mu.RLock()
	registered := b.windows[window.ID()]
	b.mu.RUnlock()
	if window.ID() <= 0 || registered.window == nil || registered.window != window {
		return sidecar.RequestSource{}, nil, errors.New("renderer caller is not a registered application window")
	}
	documentURL := page.URL()
	if registered.page != nil && page == registered.page {
		if !isRendererDocument(registered.role, documentURL) {
			return sidecar.RequestSource{}, nil, errors.New("renderer caller is not an allowed application document")
		}
		return sidecar.RequestSource{WindowID: window.ID(), DocumentURL: documentURL}, window, nil
	}
	nested, ok := b.nestedPageByPointer(page)
	if !ok || nested.window != window {
		return sidecar.RequestSource{}, nil, errors.New("renderer caller is not a registered application page")
	}
	if !isNativeNestedBusinessDocument(documentURL) {
		return sidecar.RequestSource{}, nil, errors.New("nested page document is not allowed for business IPC")
	}
	return sidecar.RequestSource{WindowID: window.ID(), PageID: nested.id, DocumentURL: documentURL}, window, nil
}

func (b *Bridge) authorize(ctx context.Context) error {
	source, _, err := b.requestSource(ctx)
	if err != nil {
		return err
	}
	b.mu.RLock()
	role := b.windows[source.WindowID].role
	b.mu.RUnlock()
	if role == nativeWindowSplash {
		return errors.New("native operation is not allowed for the splash document")
	}
	return nil
}

func (b *Bridge) Invoke(ctx context.Context, route string, inputJSON string) (string, error) {
	source, window, err := b.requestSource(ctx)
	if err != nil {
		return "", err
	}
	b.mu.RLock()
	role := b.windows[window.ID()].role
	b.mu.RUnlock()
	if role == nativeWindowSplash && route != "config.getLanguage" {
		return "", errors.New("business route is not allowed for the splash document")
	}
	if source.PageID == 0 {
		if answer, handled, err := b.shellRoute(window, route); handled {
			return answer, err
		}
	}
	process := b.manager()
	if process == nil {
		return "", errors.New("sidecar is not available")
	}
	return process.Call(ctx, route, inputJSON, source)
}

// SplashChannel is a narrow submit/cancel port used only during database startup.
// It never grants access to the general business route dispatcher.
func (b *Bridge) SplashChannel(ctx context.Context, channel string, inputJSON string) (string, error) {
	source, _, err := b.requestSource(ctx)
	if err != nil {
		return "", err
	}
	b.mu.RLock()
	role := b.windows[source.WindowID].role
	b.mu.RUnlock()
	if role != nativeWindowSplash || !allowedSplashChannels[channel] {
		return "", errors.New("native splash channel is not allowed")
	}
	var payload map[string]json.RawMessage
	if err := json.Unmarshal([]byte(inputJSON), &payload); err != nil || payload == nil {
		return "", errors.New("native splash payload must be an object")
	}
	envelope, err := json.Marshal(map[string]any{"channel": channel, "payload": payload})
	if err != nil {
		return "", errors.New("encode native splash payload")
	}
	process := b.manager()
	if process == nil {
		return "", errors.New("sidecar is not available")
	}
	return process.Call(ctx, nativeSplashChannelRoute, string(envelope), source)
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
