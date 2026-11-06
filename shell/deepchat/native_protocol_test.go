package main

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/ThinkInAIXYZ/deepchat/shell/internal/sidecar"
)

func startNativeProtocolTestManager(t *testing.T, script string) (*sidecar.Manager, func() int) {
	t.Helper()
	directory := t.TempDir()
	scriptPath := filepath.Join(directory, "protocol-helper.mjs")
	if err := os.WriteFile(scriptPath, []byte(script), 0o600); err != nil {
		t.Fatal(err)
	}
	nodePath, err := exec.LookPath("node")
	if err != nil {
		t.Fatal(err)
	}
	manager, err := sidecar.StartManager(sidecar.ManagerOptions{
		Process: sidecar.Options{
			NodePath: nodePath, ScriptPath: scriptPath,
			RequestTimeout: 2 * time.Second, ShutdownTimeout: time.Second,
			Env: []string{"NATIVE_PROTOCOL_TEST_CANCEL_FILE=" + filepath.Join(directory, "cancel-count")},
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
	return manager, func() int {
		data, err := os.ReadFile(filepath.Join(directory, "cancel-count"))
		if errors.Is(err, os.ErrNotExist) {
			return 0
		}
		if err != nil {
			t.Fatal(err)
		}
		value := 0
		if _, err := fmt.Sscanf(string(data), "%d", &value); err != nil {
			t.Fatal(err)
		}
		return value
	}
}

const nativeProtocolHelperPrelude = `
import { createInterface } from 'node:readline'
import { appendFileSync } from 'node:fs'
process.stdout.write(JSON.stringify({ event: 'sidecar.app.started', payload: {} }) + '\n')
let reads = 0
let cancels = 0
const respond = (id, result) => process.stdout.write(JSON.stringify({ id, result }) + '\n')
const validSource = (source) => source?.windowId === 1 && source?.documentUrl === 'mygo://localhost/'
`

func TestNativeProtocolStreamsResponseOverManager(t *testing.T) {
	manager, cancelCount := startNativeProtocolTestManager(t, nativeProtocolHelperPrelude+`
createInterface({ input: process.stdin }).on('line', (line) => {
  const request = JSON.parse(line)
  if (!validSource(request.source)) throw new Error('wrong source')
  if (request.route === 'native.protocol.begin') {
    respond(request.id, { status: 201, headers: [['Content-Type', 'text/plain'], ['X-Test', 'ok']], body: true })
    return
  }
  if (request.route === 'native.protocol.read') {
    reads++
    respond(request.id, reads === 1 ? { done: false, data: 'aGVsbG8=' } : { done: true, data: '' })
    return
  }
  if (request.route === 'native.protocol.cancel') {
    cancels++
    appendFileSync(process.env.NATIVE_PROTOCOL_TEST_CANCEL_FILE, String(cancels))
    respond(request.id, { done: true })
  }
})
`)
	bridge := &Bridge{process: manager}
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "workspace-preview://fixture/preview.html", nil)
	err := bridge.serveNativeProtocolRequest("workspace-preview", recorder, request, sidecar.RequestSource{
		WindowID: 1, DocumentURL: "mygo://localhost/",
	}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if recorder.Code != 201 || recorder.Header().Get("X-Test") != "ok" || recorder.Body.String() != "hello" {
		t.Fatalf("unexpected protocol response: code=%d headers=%v body=%q", recorder.Code, recorder.Header(), recorder.Body.String())
	}
	if got := cancelCount(); got != 0 {
		t.Fatalf("completed stream was cancelled %d times", got)
	}
}

type failingNativeProtocolWriter struct {
	header http.Header
	status int
}

func (w *failingNativeProtocolWriter) Header() http.Header    { return w.header }
func (w *failingNativeProtocolWriter) WriteHeader(status int) { w.status = status }
func (w *failingNativeProtocolWriter) Write([]byte) (int, error) {
	return 0, errors.New("client disconnected")
}

func TestNativeProtocolCancelsReaderWhenClientDisconnects(t *testing.T) {
	manager, cancelCount := startNativeProtocolTestManager(t, nativeProtocolHelperPrelude+`
createInterface({ input: process.stdin }).on('line', (line) => {
  const request = JSON.parse(line)
  if (!validSource(request.source)) throw new Error('wrong source')
  if (request.route === 'native.protocol.begin') {
    respond(request.id, { status: 200, headers: [], body: true })
    return
  }
  if (request.route === 'native.protocol.read') {
    reads++
    respond(request.id, { done: false, data: 'eA==' })
    return
  }
  if (request.route === 'native.protocol.cancel') {
    cancels++
    appendFileSync(process.env.NATIVE_PROTOCOL_TEST_CANCEL_FILE, String(cancels))
    respond(request.id, { done: true })
  }
})
`)
	bridge := &Bridge{process: manager}
	writer := &failingNativeProtocolWriter{header: make(http.Header)}
	request := httptest.NewRequest(http.MethodGet, "workspace-preview://fixture/preview.html", nil)
	err := bridge.serveNativeProtocolRequest("workspace-preview", writer, request, sidecar.RequestSource{
		WindowID: 1, DocumentURL: "mygo://localhost/",
	}, nil)
	if err == nil || !strings.Contains(err.Error(), "client disconnected") {
		t.Fatalf("expected client disconnect, got %v", err)
	}
	if got := cancelCount(); got != 1 {
		t.Fatalf("reader cancellation count = %d, want 1", got)
	}
}

func TestNativeProtocolRejectsUnsupportedMethodAndMetadata(t *testing.T) {
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "workspace-preview://fixture/preview.html", nil)
	bridge := &Bridge{}
	if err := bridge.serveNativeProtocolRequest("workspace-preview", recorder, request, sidecar.RequestSource{
		WindowID: 1, DocumentURL: "mygo://localhost/",
	}, nil); err == nil || recorder.Code != http.StatusMethodNotAllowed {
		t.Fatalf("unsupported method was accepted: code=%d err=%v", recorder.Code, err)
	}
	for _, metadata := range []nativeProtocolMetadata{
		{Status: 99},
		{Status: 200, Headers: [][2]string{{"Transfer-Encoding", "chunked"}}},
		{Status: 200, Headers: [][2]string{{"Connection", "X-Internal"}, {"X-Internal", "value"}}},
		{Status: 200, Headers: [][2]string{{"Content-Length", "unknown"}}},
		{Status: 200, Headers: [][2]string{{"X-Large", strings.Repeat("x", nativeProtocolMaxHeaderBytes)}}},
	} {
		if err := validateNativeProtocolMetadata(metadata); err == nil {
			t.Fatalf("invalid metadata was accepted: %+v", metadata)
		}
	}
}

func TestNativeProtocolCancelsBeginAfterRequestCancellation(t *testing.T) {
	manager, cancelCount := startNativeProtocolTestManager(t, nativeProtocolHelperPrelude+`
createInterface({ input: process.stdin }).on('line', (line) => {
  const request = JSON.parse(line)
  if (!validSource(request.source)) throw new Error('wrong source')
  if (request.route === 'native.protocol.begin') {
    setTimeout(() => respond(request.id, { status: 200, headers: [], body: true }), 100)
    return
  }
  if (request.route === 'native.protocol.cancel') {
    cancels++
    appendFileSync(process.env.NATIVE_PROTOCOL_TEST_CANCEL_FILE, String(cancels))
    respond(request.id, { done: true })
  }
})
`)
	bridge := &Bridge{process: manager}
	recorder := httptest.NewRecorder()
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	request := httptest.NewRequest(http.MethodGet, "workspace-preview://fixture/preview.html", nil).WithContext(ctx)
	err := bridge.serveNativeProtocolRequest("workspace-preview", recorder, request, sidecar.RequestSource{
		WindowID: 1, DocumentURL: "mygo://localhost/",
	}, nil)
	if err == nil {
		t.Fatal("expected the begin request to be cancelled")
	}
	deadline := time.Now().Add(time.Second)
	for cancelCount() == 0 && time.Now().Before(deadline) {
		time.Sleep(5 * time.Millisecond)
	}
	if got := cancelCount(); got != 1 {
		t.Fatalf("begin cancellation count = %d, want 1", got)
	}
}

func TestNativeProtocolRevalidatesSourceBeforeRead(t *testing.T) {
	manager, cancelCount := startNativeProtocolTestManager(t, nativeProtocolHelperPrelude+`
createInterface({ input: process.stdin }).on('line', (line) => {
  const request = JSON.parse(line)
  if (!validSource(request.source)) throw new Error('wrong source')
  if (request.route === 'native.protocol.begin') {
    respond(request.id, { status: 200, headers: [], body: true })
    return
  }
  if (request.route === 'native.protocol.read') {
    respond(request.id, { done: false, data: 'eA==' })
    return
  }
  if (request.route === 'native.protocol.cancel') {
    cancels++
    appendFileSync(process.env.NATIVE_PROTOCOL_TEST_CANCEL_FILE, String(cancels))
    respond(request.id, { done: true })
  }
})
`)
	bridge := &Bridge{process: manager}
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "workspace-preview://fixture/preview.html", nil)
	err := bridge.serveNativeProtocolRequest("workspace-preview", recorder, request, sidecar.RequestSource{
		WindowID: 1, DocumentURL: "mygo://localhost/",
	}, func() error { return errors.New("document changed") })
	if err == nil || !strings.Contains(err.Error(), "document changed") {
		t.Fatalf("expected source validation failure, got %v", err)
	}
	if recorder.Body.Len() != 0 {
		t.Fatalf("read occurred after source validation failed: %q", recorder.Body.String())
	}
	if got := cancelCount(); got != 1 {
		t.Fatalf("source failure cancellation count = %d, want 1", got)
	}
}

func TestNativeProtocolsRegisteredForPackagedLayout(t *testing.T) {
	data, err := os.ReadFile("main.go")
	if err != nil {
		t.Fatal(err)
	}
	source := string(data)
	registration := strings.Index(source, "bridge.registerNativeProtocols()")
	developmentOverride := strings.Index(source, `if layout.rendererDir != "" {`)
	windowCreation := strings.Index(source, "window := mygo.NewWindow")
	if registration < 0 || developmentOverride < 0 || windowCreation < 0 ||
		registration > developmentOverride || registration > windowCreation {
		t.Fatalf("native protocol registration is not on the packaged startup path")
	}
}
