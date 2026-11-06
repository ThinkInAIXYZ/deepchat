package main

import (
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/ThinkInAIXYZ/deepchat/shell/internal/sidecar"
)

func TestIsRendererDocumentRolePathWhitelist(t *testing.T) {
	tests := []struct {
		name   string
		role   nativeWindowRole
		rawURL string
		want   bool
	}{
		{name: "main origin", role: nativeWindowMain, rawURL: "mygo://localhost", want: true},
		{name: "main root", role: nativeWindowMain, rawURL: "mygo://localhost/", want: true},
		{
			name: "main index with query and fragment", role: nativeWindowMain,
			rawURL: "mygo://localhost/index.html?mode=test#/chat", want: true,
		},
		{
			name: "settings index with query and fragment", role: nativeWindowSettings,
			rawURL: "mygo://localhost/settings/index.html?panel=general#/account", want: true,
		},
		{
			name: "splash entry with query and fragment", role: nativeWindowSplash,
			rawURL: "mygo://localhost/splash/index.html?mode=recovery#/unlock", want: true,
		},
		{
			name: "splash inline fallback", role: nativeWindowSplash,
			rawURL: splashInlineDocumentPrefix + "%3Chtml%3E", want: true,
		},
		{
			name: "oversized splash inline fallback", role: nativeWindowSplash,
			rawURL: splashInlineDocumentPrefix + strings.Repeat("A", maxSplashInlineDocumentBytes),
		},
		{
			name: "splash cannot load main", role: nativeWindowSplash,
			rawURL: "mygo://localhost/index.html",
		},
		{
			name: "main cannot load splash", role: nativeWindowMain,
			rawURL: "mygo://localhost/splash/index.html",
		},
		{
			name: "splash non html data", role: nativeWindowSplash,
			rawURL: "data:text/plain;charset=utf-8,hello",
		},
		{
			name: "main cannot load settings", role: nativeWindowMain,
			rawURL: "mygo://localhost/settings/index.html",
		},
		{
			name: "settings cannot load main", role: nativeWindowSettings,
			rawURL: "mygo://localhost/index.html",
		},
		{
			name: "unknown role", role: nativeWindowRole("other"),
			rawURL: "mygo://localhost/index.html",
		},
		{name: "external scheme", role: nativeWindowMain, rawURL: "https://localhost/index.html"},
		{name: "external host", role: nativeWindowMain, rawURL: "mygo://example.test/index.html"},
		{name: "user info", role: nativeWindowMain, rawURL: "mygo://user@localhost/index.html"},
		{
			name: "encoded settings separators", role: nativeWindowSettings,
			rawURL: "mygo://localhost/settings%2findex.html",
		},
		{name: "blank transport page", role: nativeWindowMain, rawURL: "about:blank"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := isRendererDocument(test.role, test.rawURL); got != test.want {
				t.Fatalf("isRendererDocument(%q, %q) = %t, want %t", test.role, test.rawURL, got, test.want)
			}
		})
	}
}

func TestSameRendererDocumentPathIgnoresQueryAndFragment(t *testing.T) {
	tests := []struct {
		name          string
		first, second string
		want          bool
	}{
		{
			name: "query can change", first: "mygo://localhost/index.html?old=1#/chat",
			second: "mygo://localhost/index.html?new=2#/chat", want: true,
		},
		{
			name: "fragment can change", first: "mygo://localhost/index.html#/chat",
			second: "mygo://localhost/index.html#/settings", want: true,
		},
		{
			name: "path must match", first: "mygo://localhost/index.html#/chat",
			second: "mygo://localhost/settings/index.html#/chat",
		},
		{
			name: "scheme must match", first: "mygo://localhost/index.html",
			second: "https://localhost/index.html",
		},
		{
			name: "host must match", first: "mygo://localhost/index.html",
			second: "mygo://example.test/index.html",
		},
		{
			name: "malformed URL", first: "mygo://localhost/index.html",
			second: "://bad-url",
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := sameRendererDocumentPath(test.first, test.second); got != test.want {
				t.Fatalf("sameRendererDocumentPath(%q, %q) = %t, want %t", test.first, test.second, got, test.want)
			}
		})
	}
}

func TestNativeWindowEnvironmentWithoutSettingsClearsInheritedValue(t *testing.T) {
	environment := (&Bridge{}).nativeWindowEnvironment()
	if len(environment) != 1 || environment[0] != nativeSettingsSnapshotEnv+"=" {
		t.Fatalf("empty native settings snapshot must override inherited environment: %v", environment)
	}
}

func TestNativeWindowCommandRequiresVerifiedCaller(t *testing.T) {
	bridge := &Bridge{}
	result, err := bridge.handleNativeWindowCommand(context.Background(), sidecar.NativeWindowCommand{
		ID:    -1,
		Type:  sidecar.NativeWindowCommandType,
		Input: json.RawMessage(`{"action":"show","windowId":17}`),
	})
	if err == nil || !strings.Contains(err.Error(), "requires a verified caller") {
		t.Fatalf("accepted a command without verified native caller: result=%v err=%v", result, err)
	}
}

func TestNativeDocumentLoadCompletionMatchesRequestedNavigation(t *testing.T) {
	for _, test := range []struct {
		requested string
		candidate string
		want      bool
	}{
		{requested: "mygo://localhost/splash/index.html", candidate: "about:blank"},
		{requested: "mygo://localhost/splash/index.html", candidate: "mygo://localhost/splash/index.html", want: true},
		{requested: "mygo://localhost/splash/index.html", candidate: "mygo://user@localhost/splash/index.html"},
		{requested: "mygo://localhost/index.html?one=1#ready", candidate: "mygo://localhost/index.html?one=2#ready"},
		{requested: "mygo://localhost/index.html?one=1#ready", candidate: "mygo://localhost/index.html?one=1#ready", want: true},
		{requested: splashInlineDocumentPrefix + "%3Chtml%3E", candidate: splashInlineDocumentPrefix + "%3Chtml%3E", want: true},
		{requested: splashInlineDocumentPrefix + "%3Chtml%3E", candidate: splashInlineDocumentPrefix + "%3Cbody%3E"},
	} {
		if got := sameNativeDocumentURL(test.requested, test.candidate); got != test.want {
			t.Errorf("completion match for %q against %q = %v, want %v", test.requested, test.candidate, got, test.want)
		}
	}
}

func TestNativeActionDocumentForErrorRedactsNonLocalAndPrivateURLParts(t *testing.T) {
	if got := nativeActionDocumentForError("mygo://localhost/splash/index.html?query=private#private"); got != "/splash/index.html" {
		t.Fatalf("local document diagnostic = %q", got)
	}
	for _, rawURL := range []string{
		"file:///private/fixture.db",
		"data:text/html;charset=utf-8,private-content",
		"mygo://user@localhost/private",
	} {
		if got := nativeActionDocumentForError(rawURL); got != "<restricted>" {
			t.Fatalf("restricted document diagnostic for %q = %q", rawURL, got)
		}
	}
	if got := nativeActionDocumentForError("about:blank"); got != "about:blank" {
		t.Fatalf("blank document diagnostic = %q", got)
	}
}

func TestNativeHostActionDocumentOnlyPermitsBlankSettingsCleanup(t *testing.T) {
	for _, role := range []nativeWindowRole{nativeWindowSettings, nativeWindowSplash} {
		if !isHostActionDocument(role, "about:blank", "close") {
			t.Fatalf("host cleanup must handle a failed pre-document creation for %s", role)
		}
	}
	for _, test := range []struct {
		role     nativeWindowRole
		document string
		action   string
	}{
		{role: nativeWindowMain, document: "about:blank", action: "close"},
		{role: nativeWindowSettings, document: "about:blank", action: "show"},
		{role: nativeWindowSettings, document: "about:blank", action: "focus"},
		{role: nativeWindowSplash, document: "about:blank", action: "show"},
		{role: nativeWindowSplash, document: "about:blank", action: "focus"},
		{role: nativeWindowSettings, document: "about:blank", action: "load_document"},
		{role: nativeWindowSettings, document: "about:blank#forged", action: "close"},
	} {
		if isHostActionDocument(test.role, test.document, test.action) {
			t.Fatalf("allowed unauthorized host action: %+v", test)
		}
	}
}

func TestNativeWindowCommandRejectsDualIdentityAndInputHostFlag(t *testing.T) {
	bridge := &Bridge{}
	result, err := bridge.handleNativeWindowCommand(context.Background(), sidecar.NativeWindowCommand{
		ID:   -1,
		Type: sidecar.NativeWindowCommandType,
		Host: true,
		Source: &sidecar.RequestSource{
			WindowID: 1, DocumentURL: "mygo://localhost/",
		},
		Input: json.RawMessage(`{"action":"focus_app"}`),
	})
	if err == nil || !strings.Contains(err.Error(), "two caller identities") {
		t.Fatalf("accepted dual-identified native command: result=%v err=%v", result, err)
	}
	result, err = bridge.handleNativeWindowCommand(context.Background(), sidecar.NativeWindowCommand{
		ID:    -2,
		Type:  sidecar.NativeWindowCommandType,
		Input: json.RawMessage(`{"action":"focus_app","host":true}`),
	})
	if err == nil || !strings.Contains(err.Error(), "requires a verified caller") {
		t.Fatalf("renderer input promoted itself to host: result=%v err=%v", result, err)
	}
}

func TestCommandCallerRevalidatesCurrentDocument(t *testing.T) {
	if !validCommandCallerDocument(
		nativeWindowMain, "mygo://localhost/#/chat", "mygo://localhost/#/welcome",
	) {
		t.Fatal("a current trusted main document should allow hash navigation")
	}
	if validCommandCallerDocument(
		nativeWindowMain, "mygo://user@localhost/index.html", "mygo://localhost/index.html",
	) {
		t.Fatal("a current document with userinfo bypassed the complete allowlist")
	}
	if validCommandCallerDocument(
		nativeWindowSettings, "about:blank", "mygo://localhost/settings/index.html",
	) {
		t.Fatal("a blank transport document became a command caller")
	}
	if validCommandCallerDocument(
		nativeWindowSettings, "mygo://localhost/index.html", "mygo://localhost/index.html",
	) {
		t.Fatal("settings accepted the main document through path-only freshness")
	}
}

func TestDispatchWindowNotificationsKeepsOrderingWithoutReenteringLock(t *testing.T) {
	nodePath, err := exec.LookPath("node")
	if err != nil {
		t.Fatalf("Node is required for notification transport test: %v", err)
	}
	helper := filepath.Join(t.TempDir(), "notify-helper.mjs")
	const source = `
import { createInterface } from 'node:readline'
createInterface({ input: process.stdin }).on('line', (line) => {
  process.stdout.write(JSON.stringify({ event: 'test.native.received', payload: JSON.parse(line) }) + '\n')
})
process.stdin.on('close', () => process.exit(0))
process.stdin.resume()
`
	if err := os.WriteFile(helper, []byte(source), 0o600); err != nil {
		t.Fatal(err)
	}
	events := make(chan sidecar.Event, 4)
	manager, err := sidecar.StartManager(sidecar.ManagerOptions{
		Process: sidecar.Options{
			NodePath: nodePath, ScriptPath: helper, Stderr: os.Stderr,
			RequestTimeout: 2 * time.Second, ShutdownTimeout: time.Second,
		},
		OnEvent: func(event sidecar.Event) {
			if event.Name != "test.native.received" {
				return
			}
			var envelope struct {
				Name    string               `json:"event"`
				Payload json.RawMessage      `json:"payload"`
				Source  *sidecar.EventTarget `json:"source"`
			}
			if err := json.Unmarshal(event.Payload, &envelope); err != nil {
				t.Errorf("decode helper transport: %v", err)
				return
			}
			events <- sidecar.Event{Name: envelope.Name, Payload: envelope.Payload, Source: envelope.Source}
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		_ = manager.Close(ctx)
	})

	var queue []nativeWindowNotification
	base := nativeWindowState{WindowID: 42, Role: nativeWindowSettings, DocumentURL: "mygo://localhost/settings/index.html"}
	third := base
	third.Sequence = 3
	for _, notification := range []nativeWindowNotification{
		{name: nativeWindowReady, state: nativeWindowState{WindowID: 42, Role: nativeWindowSettings, Sequence: 1}},
		{name: nativeWindowFocused, state: nativeWindowState{WindowID: 42, Role: nativeWindowSettings, Sequence: 2}},
		{name: nativeWindowReady, state: third},
	} {
		queue = coalesceNativeWindowNotification(queue, notification)
	}
	bridge := &Bridge{notificationQueue: queue, notificationSignal: make(chan struct{}, 1)}
	bridge.setProcess(manager)
	done := make(chan struct{})
	bridge.notificationSignal <- struct{}{}
	close(bridge.notificationSignal)
	go func() {
		bridge.dispatchWindowNotifications()
		close(done)
	}()

	for index, expected := range []struct {
		name     string
		sequence uint64
	}{
		{name: nativeWindowFocused, sequence: 2},
		{name: nativeWindowReady, sequence: 3},
	} {
		select {
		case event := <-events:
			if event.Name != expected.name {
				t.Fatalf("notification %d event = %s, want %s", index, event.Name, expected.name)
			}
			var state nativeWindowState
			if err := json.Unmarshal(event.Payload, &state); err != nil {
				t.Fatalf("decode notification payload: %v", err)
			}
			if state.Sequence != expected.sequence {
				t.Fatalf("notification %d sequence = %d, want %d", index, state.Sequence, expected.sequence)
			}
		case <-time.After(2 * time.Second):
			t.Fatalf("notification dispatcher blocked before event %d (%s)", index, expected.name)
		}
	}
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("notification dispatcher did not finish")
	}
}
