package sidecar

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func startTestProcess(t *testing.T, source string, configure func(*Options)) *Process {
	t.Helper()
	nodePath, err := exec.LookPath("node")
	if err != nil {
		t.Skip("Node.js is required for sidecar integration tests")
	}
	script := filepath.Join(t.TempDir(), "helper.mjs")
	if err := os.WriteFile(script, []byte(source), 0o600); err != nil {
		t.Fatal(err)
	}
	options := Options{
		NodePath:        nodePath,
		ScriptPath:      script,
		Stderr:          os.Stderr,
		RequestTimeout:  time.Second,
		ShutdownTimeout: time.Second,
	}
	if configure != nil {
		configure(&options)
	}
	process, err := Start(options)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		_ = process.Close(ctx)
	})
	return process
}

func closeTestProcess(t *testing.T, process *Process) error {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	return process.Close(ctx)
}

func TestCallReturnsResponseAndEvent(t *testing.T) {
	process := startTestProcess(t, `
import { createInterface } from 'node:readline'
createInterface({ input: process.stdin }).on('line', (line) => {
  const request = JSON.parse(line)
  process.stdout.write(JSON.stringify({ event: 'test.event', payload: { id: request.id } }) + '\n')
  process.stdout.write(JSON.stringify({ id: request.id, result: request.input }) + '\n')
})
process.stdin.on('close', () => process.exit(0))
`, nil)
	events := make(chan Event, 1)
	process.SetEventHandler(func(event Event) { events <- event })

	answer, err := process.Call(context.Background(), "test.echo", `{"value":1}`)
	if err != nil {
		t.Fatal(err)
	}
	if answer != `{"value":1}` {
		t.Fatalf("unexpected response %s", answer)
	}
	event := <-events
	if event.Name != "test.event" || string(event.Payload) != `{"id":1}` {
		t.Fatalf("unexpected event %+v", event)
	}
	if err := closeTestProcess(t, process); err != nil {
		t.Fatal(err)
	}
}

func TestMalformedOutputFailsPendingCall(t *testing.T) {
	process := startTestProcess(t, `
process.stdout.write('not json\n')
process.stdin.resume()
`, nil)
	_, err := process.Call(context.Background(), "test.unavailable", `{}`)
	if err == nil || !strings.Contains(err.Error(), "malformed sidecar output") {
		t.Fatalf("expected malformed output failure, got %v", err)
	}
}

func TestCallHonorsDeadlineWithoutReplay(t *testing.T) {
	process := startTestProcess(t, `
process.stdin.on('data', () => {})
setInterval(() => {}, 1000)
`, func(options *Options) {
		options.RequestTimeout = 30 * time.Millisecond
		options.ShutdownTimeout = 20 * time.Millisecond
	})
	_, err := process.Call(context.Background(), "test.slow", `{}`)
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("expected deadline exceeded, got %v", err)
	}
	if closeErr := closeTestProcess(t, process); closeErr == nil || !strings.Contains(closeErr.Error(), "forced kill") {
		t.Fatalf("expected bounded forced shutdown, got %v", closeErr)
	}
}

func TestLateResponseAfterTimeoutDoesNotStopProcess(t *testing.T) {
	process := startTestProcess(t, `
import { createInterface } from 'node:readline'
createInterface({ input: process.stdin }).on('line', (line) => {
  const request = JSON.parse(line)
  const respond = () => process.stdout.write(JSON.stringify({ id: request.id, result: { route: request.route } }) + '\n')
  if (request.route === 'test.slow') setTimeout(respond, 75)
  else respond()
})
`, func(options *Options) {
		options.RequestTimeout = 25 * time.Millisecond
	})
	if _, err := process.Call(context.Background(), "test.slow", `{}`); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("expected a client deadline, got %v", err)
	}
	answer, err := process.Call(context.Background(), "test.fast", `{}`)
	if err != nil {
		t.Fatalf("late response killed the next request: %v", err)
	}
	if answer != `{"route":"test.fast"}` {
		t.Fatalf("unexpected follow-up response: %s", answer)
	}
}

func TestCloseContextDeadlineStillReapsChild(t *testing.T) {
	process := startTestProcess(t, `setInterval(() => {}, 1000)`, nil)
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	if err := process.Close(ctx); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("expected caller deadline after cleanup, got %v", err)
	}
	select {
	case <-process.done:
	default:
		t.Fatal("Close returned before the sidecar was reaped")
	}
}

func TestUnexpectedExitFailsPendingCall(t *testing.T) {
	process := startTestProcess(t, `
process.stdin.once('data', () => process.exit(7))
`, nil)
	_, err := process.Call(context.Background(), "test.exit", `{}`)
	if err == nil || !strings.Contains(err.Error(), "sidecar stopped") {
		t.Fatalf("expected process exit failure, got %v", err)
	}
}
