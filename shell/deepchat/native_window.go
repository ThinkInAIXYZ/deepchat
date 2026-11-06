package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/url"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/ThinkInAIXYZ/deepchat/shell/internal/sidecar"
	"github.com/egoist/mygo"
)

type nativeWindowRole string

const (
	nativeWindowMain     nativeWindowRole = "main"
	nativeWindowSettings nativeWindowRole = "settings"
	nativeWindowSplash   nativeWindowRole = "splash"

	nativeWindowReady   = "native.window.ready"
	nativeWindowFocused = "native.window.focused"
	nativeWindowClosed  = "native.window.closed"

	nativeNotificationTimeout    = 10 * time.Second
	nativeSettingsSnapshotEnv    = "DEEPCHAT_NATIVE_SETTINGS_SNAPSHOT"
	splashInlineDocumentPrefix   = "data:text/html;charset=utf-8,"
	maxSplashInlineDocumentBytes = 65_536
)

type nativeDocumentNavigation struct {
	mu                sync.Mutex
	committedURL      string
	committedRevision uint64
}

func (n *nativeDocumentNavigation) commit(rawURL string) {
	n.mu.Lock()
	n.committedURL = rawURL
	n.committedRevision++
	n.mu.Unlock()
}

func (n *nativeDocumentNavigation) currentRevision() uint64 {
	n.mu.Lock()
	defer n.mu.Unlock()
	return n.committedRevision
}

func (n *nativeDocumentNavigation) committed(rawURL string, after uint64) bool {
	if n == nil {
		return false
	}
	n.mu.Lock()
	defer n.mu.Unlock()
	// Hash routes are state within the committed document, not a new document.
	return n.committedRevision > after && sameNativeDocumentRevisionURL(rawURL, n.committedURL)
}

type nativeWindowRecord struct {
	window     *mygo.Window
	role       nativeWindowRole
	navigation *nativeDocumentNavigation
}

func (r nativeWindowRecord) readyForNotification(rawURL string) bool {
	return isRendererDocument(r.role, rawURL) && r.navigation.committed(rawURL, 0)
}

type nativeWindowState struct {
	WindowID       int              `json:"windowId"`
	Role           nativeWindowRole `json:"role"`
	DocumentURL    string           `json:"documentUrl"`
	Sequence       uint64           `json:"sequence"`
	Visible        bool             `json:"visible"`
	Focused        bool             `json:"focused"`
	CloseRequested bool             `json:"closeRequested,omitempty"`
}

type nativeWindowNotification struct {
	name  string
	state nativeWindowState
}

func isRendererDocument(role nativeWindowRole, rawURL string) bool {
	if role == nativeWindowSplash && strings.HasPrefix(rawURL, splashInlineDocumentPrefix) &&
		len(rawURL) <= maxSplashInlineDocumentBytes {
		return true
	}
	parsed, err := url.Parse(rawURL)
	if err != nil || parsed.User != nil || parsed.Scheme != "mygo" || parsed.Host != "localhost" {
		return false
	}
	switch role {
	case nativeWindowMain:
		return parsed.EscapedPath() == "" || parsed.EscapedPath() == "/" || parsed.EscapedPath() == "/index.html"
	case nativeWindowSettings:
		return parsed.EscapedPath() == "/settings/index.html"
	case nativeWindowSplash:
		return parsed.EscapedPath() == "/splash/index.html"
	default:
		return false
	}
}

func nativeActionDocumentForError(rawURL string) string {
	if rawURL == "about:blank" {
		return rawURL
	}
	parsed, err := url.Parse(rawURL)
	if err != nil || parsed.Scheme != "mygo" || parsed.Host != "localhost" || parsed.User != nil {
		return "<restricted>"
	}
	return parsed.EscapedPath()
}

func isHostActionDocument(role nativeWindowRole, rawURL, action string) bool {
	if isRendererDocument(role, rawURL) {
		return true
	}
	// Creation errors must not leave a hidden native window or permit the blank
	// transport document to become an ordinary renderer caller.
	return action == "close" && (role == nativeWindowSettings || role == nativeWindowSplash) && rawURL == "about:blank"
}

func sameRendererDocumentPath(first, second string) bool {
	left, leftErr := url.Parse(first)
	right, rightErr := url.Parse(second)
	return leftErr == nil && rightErr == nil && left.Scheme == right.Scheme &&
		left.Host == right.Host && left.EscapedPath() == right.EscapedPath()
}

func (b *Bridge) describeNativeWindow(record nativeWindowRecord) (nativeWindowState, error) {
	if record.window == nil || record.window.ID() <= 0 || record.window.IsDestroyed() {
		return nativeWindowState{}, errors.New("native window is not live")
	}
	state := nativeWindowState{
		WindowID: record.window.ID(),
		Role:     record.role,
		Visible:  record.window.IsVisible(),
		Focused:  record.window.IsFocused(),
	}
	b.mu.RLock()
	state.Sequence = b.windowSequences[state.WindowID]
	b.mu.RUnlock()
	if page := record.window.Page(); page != nil {
		state.DocumentURL = page.URL()
	}
	return state, nil
}

// Notifications are captured on the native callback thread, assigned a window
// sequence, and coalesced by kind without blocking it on pipe I/O. Closing a
// window cancels its queued ready/focus states, which cannot recreate a sender.
func (b *Bridge) notifyWindow(record nativeWindowRecord, name string) {
	if record.window == nil || record.window.ID() <= 0 {
		return
	}
	windowID := record.window.ID()
	var state nativeWindowState
	if name == nativeWindowClosed {
		state = nativeWindowState{WindowID: windowID, Role: record.role, CloseRequested: true}
	} else if name == nativeWindowReady || name == nativeWindowFocused {
		var err error
		state, err = b.describeNativeWindow(record)
		if err != nil {
			log.Printf("discard native window notification: %v", err)
			return
		}
		if name == nativeWindowReady && !record.readyForNotification(state.DocumentURL) {
			return
		}
	} else {
		return
	}

	b.mu.Lock()
	defer b.mu.Unlock()
	if name != nativeWindowClosed && b.windows[windowID].window != record.window {
		return
	}
	if b.windowSequences == nil {
		b.windowSequences = map[int]uint64{}
	}
	b.windowSequences[windowID]++
	state.Sequence = b.windowSequences[windowID]
	notification := nativeWindowNotification{name: name, state: state}
	b.notificationQueue = coalesceNativeWindowNotification(b.notificationQueue, notification)
	if b.notificationSignal == nil {
		b.notificationSignal = make(chan struct{}, 1)
		go b.dispatchWindowNotifications()
	}
	select {
	case b.notificationSignal <- struct{}{}:
	default:
	}
}

func coalesceNativeWindowNotification(
	queue []nativeWindowNotification, notification nativeWindowNotification,
) []nativeWindowNotification {
	queued := queue[:0]
	for _, pending := range queue {
		if pending.state.WindowID != notification.state.WindowID {
			queued = append(queued, pending)
			continue
		}
		if notification.name == nativeWindowClosed || pending.name == notification.name {
			continue
		}
		queued = append(queued, pending)
	}
	// Remove-and-append preserves the native sequence order across event kinds.
	return append(queued, notification)
}

func (b *Bridge) dispatchWindowNotifications() {
	for range b.notificationSignal {
		for {
			b.mu.Lock()
			if len(b.notificationQueue) == 0 {
				b.mu.Unlock()
				break
			}
			notification := b.notificationQueue[0]
			b.notificationQueue = b.notificationQueue[1:]
			process := b.process
			b.mu.Unlock()
			if process == nil {
				log.Printf(
					"native window notification %s (%d) has no sidecar receiver",
					notification.name, notification.state.WindowID,
				)
				continue
			}
			ctx, cancel := context.WithTimeout(context.Background(), nativeNotificationTimeout)
			payload, err := json.Marshal(notification.state)
			if err == nil {
				err = process.EmitEvent(ctx, sidecar.Event{
					Name: notification.name, Payload: payload,
					Source: &sidecar.EventTarget{WindowID: notification.state.WindowID},
				})
			}
			cancel()
			if err != nil && !errors.Is(err, sidecar.ErrClosed) && !errors.Is(err, context.Canceled) {
				log.Printf("send native window notification %s: %v", notification.name, err)
			}
		}
	}
}

func (b *Bridge) registerWindow(window *mygo.Window, role nativeWindowRole) {
	if window == nil || window.ID() <= 0 ||
		(role != nativeWindowMain && role != nativeWindowSettings && role != nativeWindowSplash) {
		panic("cannot register an invalid native window")
	}
	b.mu.Lock()
	if b.windows == nil {
		b.windows = map[int]nativeWindowRecord{}
	}
	if existing := b.windows[window.ID()]; existing.window != nil {
		b.mu.Unlock()
		panic("native window ID is already registered")
	}
	record := nativeWindowRecord{window: window, role: role, navigation: &nativeDocumentNavigation{}}
	b.windows[window.ID()] = record
	if role == nativeWindowMain {
		if b.primary == nil || b.primary.IsDestroyed() {
			b.primary = window
		}
	} else if role == nativeWindowSettings {
		if b.settings != nil && b.settings != window && !b.settings.IsDestroyed() {
			b.mu.Unlock()
			panic("settings native window is already registered")
		}
		b.settings = window
	} else {
		if b.splash != nil && b.splash != window && !b.splash.IsDestroyed() {
			b.mu.Unlock()
			panic("splash native window is already registered")
		}
		b.splash = window
	}
	b.mu.Unlock()

	window.OnClosed(func() {
		b.mu.Lock()
		if current := b.windows[window.ID()]; current.window == window {
			delete(b.windows, window.ID())
		}
		if b.primary == window {
			b.primary = nil
		}
		if b.settings == window {
			b.settings = nil
		}
		if b.splash == window {
			b.splash = nil
		}
		delete(b.closingWindows, window.ID())
		b.mu.Unlock()
		b.notifyWindow(record, nativeWindowClosed)
	})
	window.Page().OnDidNavigate(record.navigation.commit)
	window.Page().OnDidFinishLoad(func() { b.notifyWindow(record, nativeWindowReady) })
	window.OnFocus(func() { b.notifyWindow(record, nativeWindowFocused) })
	window.OnBlur(func() { b.notifyWindow(record, nativeWindowFocused) })
	if window.IsDestroyed() {
		panic("cannot register an already destroyed native window")
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

func (b *Bridge) settingsWindow() *mygo.Window {
	b.mu.RLock()
	defer b.mu.RUnlock()
	if b.settings == nil || b.settings.IsDestroyed() {
		return nil
	}
	return b.settings
}

func (b *Bridge) splashWindow() *mygo.Window {
	b.mu.RLock()
	defer b.mu.RUnlock()
	if b.splash == nil || b.splash.IsDestroyed() {
		return nil
	}
	return b.splash
}

// nativeWindowEnvironment is evaluated for every new sidecar generation. A
// closing or destroyed settings window never turns into an ensure/create hint.
func (b *Bridge) nativeWindowEnvironment() []string {
	empty := []string{nativeSettingsSnapshotEnv + "="}
	window := b.settingsWindow()
	if window == nil {
		return empty
	}
	state, err := b.describeNativeWindow(nativeWindowRecord{window: window, role: nativeWindowSettings})
	if err != nil {
		return empty
	}
	b.mu.RLock()
	state.CloseRequested = b.closingWindows[window.ID()]
	b.mu.RUnlock()
	payload, err := json.Marshal(state)
	if err != nil {
		log.Printf("encode native settings snapshot: %v", err)
		return empty
	}
	return []string{nativeSettingsSnapshotEnv + "=" + string(payload)}
}

func (b *Bridge) nativeWindow(id int) (*mygo.Window, error) {
	b.mu.RLock()
	window := b.windows[id].window
	b.mu.RUnlock()
	if id <= 0 || window == nil || window.IsDestroyed() {
		return nil, errors.New("native window target is not registered or is destroyed")
	}
	return window, nil
}

func (b *Bridge) handleNativeWindowCommand(
	ctx context.Context, command sidecar.NativeWindowCommand,
) (any, error) {
	if command.Type != sidecar.NativeWindowCommandType || command.ID >= 0 {
		return nil, errors.New("invalid native window command envelope")
	}
	var input struct {
		Action      string `json:"action"`
		WindowID    int    `json:"windowId"`
		DocumentURL string `json:"documentUrl"`
		Width       int    `json:"width"`
		Height      int    `json:"height"`
		MinWidth    int    `json:"minWidth"`
		MinHeight   int    `json:"minHeight"`
		X           int    `json:"x"`
		Y           int    `json:"y"`
	}
	if err := json.Unmarshal(command.Input, &input); err != nil {
		return nil, errors.New("invalid native window command input")
	}
	if command.Host {
		if command.Source != nil {
			return nil, errors.New("native window command cannot have two caller identities")
		}
	} else {
		if command.Source == nil {
			return nil, errors.New("native window command requires a verified caller")
		}
		if err := b.commandCaller(*command.Source); err != nil {
			return nil, err
		}
		b.mu.RLock()
		role := b.windows[command.Source.WindowID].role
		b.mu.RUnlock()
		if !isRendererDocument(role, command.Source.DocumentURL) {
			return nil, errors.New("native window command source document is not allowed")
		}
	}
	b.nativeCommands.Lock()
	defer b.nativeCommands.Unlock()
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	switch input.Action {
	case "ensure_settings":
		record, err := b.ensureSettingsWindow(input.Width, input.Height, input.MinWidth, input.MinHeight, input.X, input.Y)
		if err != nil {
			return nil, err
		}
		state, err := b.describeNativeWindow(record)
		if err != nil {
			return nil, err
		}
		b.mu.RLock()
		state.CloseRequested = b.closingWindows[record.window.ID()]
		b.mu.RUnlock()
		return state, nil
	case "ensure_splash":
		record, err := b.ensureSplashWindow()
		if err != nil {
			return nil, err
		}
		state, err := b.describeNativeWindow(record)
		if err != nil {
			return nil, err
		}
		b.mu.RLock()
		state.CloseRequested = b.closingWindows[record.window.ID()]
		b.mu.RUnlock()
		return state, nil
	case "load_document":
		window, err := b.nativeWindow(input.WindowID)
		if err != nil {
			return nil, err
		}
		b.mu.RLock()
		role := b.windows[input.WindowID].role
		navigation := b.windows[input.WindowID].navigation
		b.mu.RUnlock()
		if !isRendererDocument(role, input.DocumentURL) {
			return nil, errors.New("native window document is not allowed for its role")
		}
		if window.Page() == nil {
			return nil, errors.New("native window has no page")
		}
		b.mu.RLock()
		closing := b.closingWindows[input.WindowID]
		b.mu.RUnlock()
		if closing {
			return nil, errors.New("native window is closing")
		}
		if err := b.loadNativeDocument(ctx, window, input.DocumentURL, navigation); err != nil {
			return nil, err
		}
		return b.describeNativeWindow(nativeWindowRecord{window: window, role: role})
	case "focus_app":
		mygo.App.Focus()
		return nil, nil
	case "show", "hide", "focus", "close":
		window, err := b.nativeWindow(input.WindowID)
		if err != nil {
			return nil, err
		}
		b.mu.RLock()
		role := b.windows[input.WindowID].role
		b.mu.RUnlock()
		if command.Host {
			documentURL := "<unavailable>"
			if window.Page() != nil {
				documentURL = window.Page().URL()
			}
			if !isHostActionDocument(role, documentURL, input.Action) {
				return nil, fmt.Errorf(
					"native host action document is not allowed for its role (window=%d role=%s action=%s document=%q)",
					input.WindowID, role, input.Action, nativeActionDocumentForError(documentURL),
				)
			}
		}
		b.mu.Lock()
		if input.Action != "close" && b.closingWindows[input.WindowID] {
			b.mu.Unlock()
			return nil, errors.New("native window is closing")
		}
		if input.Action == "close" {
			if b.closingWindows == nil {
				b.closingWindows = map[int]bool{}
			}
			b.closingWindows[input.WindowID] = true
		}
		b.mu.Unlock()
		if err := b.applyWindowAction(input.WindowID, input.Action); err != nil {
			if input.Action == "close" {
				b.mu.Lock()
				delete(b.closingWindows, input.WindowID)
				b.mu.Unlock()
			}
			return nil, err
		}
		if input.Action == "close" {
			state := nativeWindowState{WindowID: input.WindowID, Role: role, CloseRequested: true}
			b.mu.RLock()
			state.Sequence = b.windowSequences[input.WindowID]
			b.mu.RUnlock()
			return state, nil
		}
		return b.describeNativeWindow(nativeWindowRecord{window: window, role: role})
	default:
		return nil, errors.New("unsupported native window command action")
	}
}

func validCommandCallerDocument(role nativeWindowRole, currentURL, sourceURL string) bool {
	return isRendererDocument(role, currentURL) && sameRendererDocumentPath(currentURL, sourceURL)
}

func (b *Bridge) commandCaller(source sidecar.RequestSource) error {
	window, err := b.nativeWindow(source.WindowID)
	if err != nil {
		return err
	}
	page := window.Page()
	if page == nil {
		return errors.New("native window command caller has no page")
	}
	b.mu.RLock()
	role := b.windows[source.WindowID].role
	b.mu.RUnlock()
	if !validCommandCallerDocument(role, page.URL(), source.DocumentURL) {
		return errors.New("native window command caller is no longer current")
	}
	return nil
}

func sameNativeDocumentRevisionURL(requested, candidate string) bool {
	if strings.HasPrefix(requested, splashInlineDocumentPrefix) ||
		strings.HasPrefix(candidate, splashInlineDocumentPrefix) {
		return requested == candidate
	}
	left, leftErr := url.Parse(requested)
	right, rightErr := url.Parse(candidate)
	return leftErr == nil && rightErr == nil && left.Scheme == right.Scheme &&
		left.Host == right.Host && left.User == nil && right.User == nil &&
		left.EscapedPath() == right.EscapedPath() && left.RawQuery == right.RawQuery
}

func sameNativeDocumentURL(requested, candidate string) bool {
	if !sameNativeDocumentRevisionURL(requested, candidate) {
		return false
	}
	if strings.HasPrefix(requested, splashInlineDocumentPrefix) ||
		strings.HasPrefix(candidate, splashInlineDocumentPrefix) {
		return true
	}
	left, _ := url.Parse(requested)
	right, _ := url.Parse(candidate)
	return left.Fragment == right.Fragment
}

func canFinishNativeDocumentLoad(
	navigation *nativeDocumentNavigation, rawURL, currentURL string, after uint64,
) bool {
	return navigation.committed(rawURL, after) && sameNativeDocumentURL(rawURL, currentURL)
}

func (b *Bridge) loadNativeDocument(
	ctx context.Context, window *mygo.Window, rawURL string, navigation *nativeDocumentNavigation,
) error {
	if navigation == nil {
		return errors.New("native window navigation state is unavailable")
	}
	beforeLoad := navigation.currentRevision()
	loaded := make(chan error, 1)
	var once sync.Once
	finish := func(err error) {
		once.Do(func() { loaded <- err })
	}
	page := window.Page()
	offFinish := page.OnDidFinishLoad(func() {
		// A blank or previous navigation may finish while page.URL() already
		// shows this request. Require the target's committed generation too.
		if canFinishNativeDocumentLoad(navigation, rawURL, page.URL(), beforeLoad) {
			finish(nil)
		}
	})
	offFailed := page.OnDidFailLoad(func(loadError *mygo.LoadError) {
		if loadError != nil && sameNativeDocumentURL(rawURL, loadError.URL) {
			finish(errors.New("native document failed to load"))
		}
	})
	offClosed := window.OnClosed(func() {
		finish(errors.New("native window closed while loading document"))
	})
	defer offFinish()
	defer offFailed()
	defer offClosed()
	if err := page.LoadURL(rawURL); err != nil {
		return fmt.Errorf("load native window document: %w", err)
	}
	select {
	case err := <-loaded:
		return err
	case <-ctx.Done():
		return fmt.Errorf("wait for native document load: %w", ctx.Err())
	}
}

func (b *Bridge) ensureSettingsWindow(width, height, minWidth, minHeight, x, y int) (nativeWindowRecord, error) {
	if existing := b.settingsWindow(); existing != nil {
		return nativeWindowRecord{window: existing, role: nativeWindowSettings}, nil
	}
	if b.preload == "" {
		return nativeWindowRecord{}, errors.New("native settings preload is unavailable")
	}
	if width <= 0 || height <= 0 || width > 32768 || height > 32768 ||
		minWidth < 0 || minHeight < 0 || minWidth > 32768 || minHeight > 32768 ||
		x < -32768 || x > 32768 || y < -32768 || y > 32768 {
		return nativeWindowRecord{}, errors.New("invalid native settings window bounds")
	}
	if minWidth > width || minHeight > height {
		return nativeWindowRecord{}, errors.New("native settings minimum size exceeds its size")
	}
	window := mygo.NewWindow(mygo.WindowOptions{
		Title: "DeepChat - Settings", URL: "about:blank", Hidden: true,
		Width: width, Height: height, MinWidth: minWidth, MinHeight: minHeight, X: x, Y: y,
		DisableFullScreen: true,
		Transparent:       runtime.GOOS == "darwin",
		TitleBarStyle:     mygo.TitleBarHiddenInset,
		Page:              mygo.PageOptions{PreloadScript: b.preload},
	})
	if window == nil {
		return nativeWindowRecord{}, errors.New("create native settings window")
	}
	b.registerWindow(window, nativeWindowSettings)
	return nativeWindowRecord{window: window, role: nativeWindowSettings}, nil
}

func (b *Bridge) ensureSplashWindow() (nativeWindowRecord, error) {
	if existing := b.splashWindow(); existing != nil {
		return nativeWindowRecord{window: existing, role: nativeWindowSplash}, nil
	}
	if b.splashPreload == "" {
		return nativeWindowRecord{}, errors.New("native splash preload is unavailable")
	}
	window := mygo.NewWindow(mygo.WindowOptions{
		Title: "DeepChat", URL: "about:blank", Hidden: true,
		Width: 420, Height: 340,
		Frameless: true, DisableResize: true, DisableMove: true,
		DisableFullScreen: true, AlwaysOnTop: true, SkipTaskbar: true,
		Transparent: true, BackgroundColor: "#00000000",
		Page: mygo.PageOptions{
			PreloadScript: b.splashPreload,
			// MyGo represents a data URL origin as data:// and trims one trailing
			// slash from each entry. Bridge authorization still limits the exact
			// inline prefix, size and channels; no arbitrary origin is trusted.
			TrustedOrigins: []string{"data:///"},
		},
	})
	if window == nil {
		return nativeWindowRecord{}, errors.New("create native splash window")
	}
	b.registerWindow(window, nativeWindowSplash)
	return nativeWindowRecord{window: window, role: nativeWindowSplash}, nil
}

func (b *Bridge) applyWindowAction(windowID int, action string) error {
	window, err := b.nativeWindow(windowID)
	if err != nil {
		return err
	}
	switch action {
	case "show":
		window.Show()
	case "hide":
		window.Hide()
	case "focus":
		window.Focus()
	case "close":
		window.Close()
	}
	return nil
}
