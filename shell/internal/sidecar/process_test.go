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

func TestRequestsKeepMonotonicIDOrderDuringEncoding(t *testing.T) {
	orderFile := filepath.Join(t.TempDir(), "order.log")
	process := startTestProcess(t, `
import { appendFileSync } from 'node:fs'
import { createInterface } from 'node:readline'
const orderFile = process.env.SIDECAR_TEST_ORDER_FILE
createInterface({ input: process.stdin }).on('line', (line) => {
  const request = JSON.parse(line)
  appendFileSync(orderFile, String(request.id) + ':' + request.route + '\n')
  const respond = () => process.stdout.write(JSON.stringify({ id: request.id, result: { route: request.route } }) + '\n')
  if (request.route === 'slow') setTimeout(respond, 25)
  else respond()
})
`, func(options *Options) {
		options.Env = append(options.Env, "SIDECAR_TEST_ORDER_FILE="+orderFile)
	})
	payload := `{"value":"` + strings.Repeat("x", 8<<20) + `"}`
	slowResult := make(chan error, 1)
	go func() {
		_, err := process.Call(context.Background(), "slow", payload)
		slowResult <- err
	}()

	deadline := time.After(2 * time.Second)
	finishedEarly := false
	for !finishedEarly && len(process.writeToken) == 0 {
		select {
		case err := <-slowResult:
			if err != nil {
				t.Fatalf("large request failed before the smaller call: %v", err)
			}
			finishedEarly = true
		case <-deadline:
			t.Fatal("the large request never acquired its write turn")
		default:
		}
	}
	if _, err := process.Call(context.Background(), "fast", `{}`); err != nil {
		t.Fatal(err)
	}
	select {
	case err := <-slowResult:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("the large request never completed")
	}
	data, err := os.ReadFile(orderFile)
	if err != nil {
		t.Fatal(err)
	}
	if got, want := string(data), "1:slow\n2:fast\n"; got != want {
		t.Fatalf("non-monotonic request frames: got %q, want %q", got, want)
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

func TestClosedStdoutIsFatalWithinBoundedTime(t *testing.T) {
	// Close the real OS descriptor; destroying only the JS stream wrapper need
	// not close fd 1. The timer keeps Node alive after the transport EOF.
	process := startTestProcess(t, `
import { closeSync } from 'node:fs'
closeSync(1)
setInterval(() => {}, 1000)
`, func(options *Options) {
		options.ShutdownTimeout = 20 * time.Millisecond
	})
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	if _, err := process.Call(ctx, "unusable.transport", `{}`); err == nil ||
		!strings.Contains(err.Error(), "sidecar stopped") {
		t.Fatalf("expected a bounded transport failure, got %v", err)
	}
}

func TestBlockedWriteHonorsDeadline(t *testing.T) {
	process := startTestProcess(t, `
import { createInterface } from 'node:readline'
createInterface({ input: process.stdin }).on('line', (line) => {
  const request = JSON.parse(line)
  if (request.route === 'start') {
    process.stdin.pause()
    process.stdout.write(JSON.stringify({ id: request.id, result: { ready: true } }) + '\n')
  }
})
setInterval(() => {}, 1000)
`, nil)
	if _, err := process.Call(context.Background(), "start", `{}`); err != nil {
		t.Fatal(err)
	}
	payload := `{"value":"` + strings.Repeat("x", 4<<20) + `"}`
	ctx, cancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
	defer cancel()
	started := time.Now()
	if _, err := process.Call(ctx, "blocked.input", payload); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("expected a blocked write deadline, got %v", err)
	}
	if elapsed := time.Since(started); elapsed >= 2*time.Second {
		t.Fatalf("the blocked write escaped its deadline for %s", elapsed)
	}
	process.mu.Lock()
	closed, stopping, pending := process.closed, process.stopping, len(process.pending)
	process.mu.Unlock()
	waiting := 0
	select {
	case <-process.waitDone:
		waiting = 1
	default:
	}
	if waiting == 0 {
		t.Logf("after deadline: closed=%t stopping=%t pending=%d writeToken=%d exited=%d elapsed=%s", closed, stopping, pending, len(process.writeToken), waiting, time.Since(started))
	}
	select {
	case <-process.done:
	case <-time.After(2 * time.Second):
		t.Fatal("a partial frame did not terminate the process generation")
	}
	select {
	case <-process.waitDone:
	case <-time.After(2 * time.Second):
		t.Fatal("the process was reported closed without reaping its root")
	}
}

func TestCloseInterruptsBlockedWrite(t *testing.T) {
	process := startTestProcess(t, `
import { createInterface } from 'node:readline'
createInterface({ input: process.stdin }).on('line', (line) => {
  const request = JSON.parse(line)
  if (request.route === 'start') {
    process.stdin.pause()
    process.stdout.write(JSON.stringify({ id: request.id, result: { ready: true } }) + '\n')
  }
})
setInterval(() => {}, 1000)
`, nil)
	t.Cleanup(func() {
		select {
		case <-process.done:
			return
		default:
			_ = process.Kill()
		}
	})
	if _, err := process.Call(context.Background(), "start", `{}`); err != nil {
		t.Fatal(err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()
	payload := `{"value":"` + strings.Repeat("x", 4<<20) + `"}`
	callResult := make(chan error, 1)
	closeResult := make(chan error, 1)
	started := time.Now()
	go func() {
		_, err := process.Call(ctx, "blocked.input", payload)
		callResult <- err
	}()
	time.AfterFunc(50*time.Millisecond, func() {
		closeResult <- process.Close(ctx)
	})
	select {
	case err := <-callResult:
		if err == nil {
			t.Fatal("a write canceled by Close must not report success")
		}
	case <-time.After(2 * time.Second):
		t.Fatal("Close did not release the blocked caller")
	}
	select {
	case err := <-closeResult:
		var exitErr *exec.ExitError
		// A graceful EOF can finish first. Otherwise either the caller timed
		// out, or closing an unfinished frame forced an immediate process exit.
		// Other failures must still fail the test even after cleanup succeeds.
		if err != nil && !errors.Is(err, context.DeadlineExceeded) && !errors.As(err, &exitErr) {
			t.Fatalf("unexpected close failure: %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("a blocked write defeated Close and its deadline")
	}
	if elapsed := time.Since(started); elapsed >= 2*time.Second {
		t.Fatalf("Close remained blocked for %s", elapsed)
	}
}

func TestCloseReportsFailedGracefulShutdown(t *testing.T) {
	process := startTestProcess(t, `setTimeout(() => process.exit(7), 80)`, nil)
	if err := closeTestProcess(t, process); err == nil || !strings.Contains(err.Error(), "exit status 7") {
		t.Fatalf("expected the terminal sidecar error, got %v", err)
	}
}
