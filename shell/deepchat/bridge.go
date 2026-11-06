package main

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"strings"

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
	window      *mygo.Window
	windowID    int
	process     *sidecar.Process
	externalURL func(string) error
}

func (b *Bridge) authorize(ctx context.Context) error {
	if b.window == nil || mygo.CallerWindow(ctx) != b.window {
		return errors.New("renderer caller is not the active application window")
	}
	return nil
}

func (b *Bridge) Invoke(ctx context.Context, route string, inputJSON string) (string, error) {
	if err := b.authorize(ctx); err != nil {
		return "", err
	}
	if answer, handled, err := b.shellRoute(route); handled {
		return answer, err
	}
	return b.process.Call(ctx, route, inputJSON)
}

func (b *Bridge) shellRoute(route string) (string, bool, error) {
	windowState := func() string {
		return fmt.Sprintf(
			`{"state":{"windowId":%d,"exists":true,"isMaximized":%t,"isFullScreen":%t,"isFocused":%t}}`,
			b.windowID, b.window.IsMaximized(), b.window.IsFullScreen(), b.window.IsFocused(),
		)
	}
	switch route {
	case "window.getRuntimeIdentity":
		return fmt.Sprintf(`{"windowId":%d,"webContentsId":%d}`, b.windowID, b.windowID), true, nil
	case "window.getCurrentState":
		return windowState(), true, nil
	case "window.minimizeCurrent":
		b.window.Minimize()
		return windowState(), true, nil
	case "window.toggleMaximizeCurrent":
		b.window.ToggleMaximize()
		return windowState(), true, nil
	case "window.closeCurrent":
		b.window.Close()
		return `{"closed":true}`, true, nil
	case "notification.rendererReady":
		return `{"ready":true}`, true, nil
	case "device.selectDirectory", "device.selectFiles":
		paths, err := mygo.Dialog.Open(mygo.OpenDialogOptions{
			Title:     "Select",
			Directory: route == "device.selectDirectory",
			Parent:    b.window,
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
