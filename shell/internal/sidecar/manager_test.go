package sidecar

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func managedTestOptions(t *testing.T, source, instanceFile string) Options {
	t.Helper()
	nodePath, err := exec.LookPath("node")
	if err != nil {
		t.Skip("Node.js is required for manager integration tests")
	}
	script := filepath.Join(t.TempDir(), "managed.mjs")
	if err := os.WriteFile(script, []byte(source), 0o600); err != nil {
		t.Fatal(err)
	}
	return Options{
		NodePath:        nodePath,
		ScriptPath:      script,
		Env:             []string{"SIDECAR_TEST_INSTANCE_FILE=" + instanceFile},
		Stderr:          os.Stderr,
		RequestTimeout:  time.Second,
		ShutdownTimeout: 100 * time.Millisecond,
	}
}

func managedStarts(t *testing.T, instanceFile string) int {
	t.Helper()
	data, err := os.ReadFile(instanceFile)
	if err != nil {
		t.Fatal(err)
	}
	return strings.Count(string(data), "start\n")
}

func TestManagerInitialEventsAreNotMissed(t *testing.T) {
	instanceFile := filepath.Join(t.TempDir(), "instances.log")
	options := managedTestOptions(t, `
process.stdout.write(JSON.stringify({ event: 'sidecar.app.started', payload: { generation: 1 } }) + '\n')
process.stdin.on('close', () => process.exit(0))
process.stdin.resume()
`, instanceFile)
	ready := make(chan struct{}, 1)
	events := make(chan Event, 1)
	manager, err := StartManager(ManagerOptions{
		Process: options,
		OnReady: func() { ready <- struct{}{} },
		OnEvent: func(event Event) { events <- event },
	})
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		_ = manager.Close(ctx)
	}()
	for range 2 {
		select {
		case <-ready:
		case event := <-events:
			if event.Name != "sidecar.app.started" {
				t.Fatalf("unexpected startup event: %+v", event)
			}
		case <-time.After(2 * time.Second):
			t.Fatal("an event handler installed at construction missed startup")
		}
	}
}

func TestManagerRestartsWithoutReplayingRequest(t *testing.T) {
	instanceFile := filepath.Join(t.TempDir(), "instances.log")
	options := managedTestOptions(t, `
import { appendFileSync, readFileSync } from 'node:fs'
import { createInterface } from 'node:readline'
const file = process.env.SIDECAR_TEST_INSTANCE_FILE
appendFileSync(file, 'start\n')
appendFileSync(file, 'environment:' + process.env.SIDECAR_TEST_DYNAMIC_VALUE + '\n')
const generation = readFileSync(file, 'utf8').split('\n').filter((line) => line === 'start').length
process.stdout.write(JSON.stringify({ event: 'sidecar.app.started', payload: { generation } }) + '\n')
createInterface({ input: process.stdin }).on('line', (line) => {
  const request = JSON.parse(line)
  appendFileSync(file, generation + ':' + request.route + '\n')
  if (generation === 1 && request.route === 'mutation') process.exit(17)
  process.stdout.write(JSON.stringify({ id: request.id, result: { generation } }) + '\n')
})
`, instanceFile)
	ready := make(chan struct{}, 4)
	exhausted := make(chan error, 1)
	environmentRevision := 0
	manager, err := StartManager(ManagerOptions{
		Process: options,
		Environment: func() []string {
			environmentRevision++
			return []string{fmt.Sprintf("SIDECAR_TEST_DYNAMIC_VALUE=%d", environmentRevision)}
		},
		MaxRestarts: 1,
		Backoff:     5 * time.Millisecond,
		OnReady:     func() { ready <- struct{}{} },
		OnExhausted: func(err error) { exhausted <- err },
	})
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		_ = manager.Close(ctx)
	}()

	if _, err := manager.Call(context.Background(), "mutation", `{"value":1}`); err == nil ||
		!strings.Contains(err.Error(), "sidecar stopped") {
		t.Fatalf("expected the unresolved mutation to fail once, got %v", err)
	}
	for range 2 {
		select {
		case <-ready:
		case <-time.After(2 * time.Second):
			t.Fatal("initial or replacement ready signal did not arrive")
		case err := <-exhausted:
			t.Fatalf("unexpected recovery exhaustion: %v", err)
		}
	}
	answer, err := manager.Call(context.Background(), "query", `{}`)
	if err != nil {
		t.Fatal(err)
	}
	if answer != `{"generation":2}` {
		t.Fatalf("expected a new generation, got %s", answer)
	}
	if starts := managedStarts(t, instanceFile); starts != 2 {
		t.Fatalf("request was replayed or process restarted too often: %d starts", starts)
	}
	data, err := os.ReadFile(instanceFile)
	if err != nil {
		t.Fatal(err)
	}
	if got := strings.Count(string(data), "environment:1\n"); got != 1 {
		t.Fatalf("expected one initial dynamic environment, got %d in %s", got, data)
	}
	if got := strings.Count(string(data), "environment:2\n"); got != 1 {
		t.Fatalf("expected one replacement dynamic environment, got %d in %s", got, data)
	}
	if count := strings.Count(string(data), "1:mutation\n"); count != 1 {
		t.Fatalf("expected one first-generation mutation execution, got %d in %s", count, data)
	}
	if strings.Contains(string(data), "2:mutation\n") {
		t.Fatalf("mutation was replayed on the replacement generation: %s", data)
	}
}

func TestManagerEnvironmentWaitsForStartedCommand(t *testing.T) {
	instanceFile := filepath.Join(t.TempDir(), "instances.log")
	options := managedTestOptions(t, `
import { appendFileSync, readFileSync } from 'node:fs'
const file = process.env.SIDECAR_TEST_INSTANCE_FILE
appendFileSync(file, 'start\n')
const generation = readFileSync(file, 'utf8').split('\n').filter((line) => line === 'start').length
process.stdout.write(JSON.stringify({ event: 'sidecar.app.started', payload: { generation } }) + '\n')
if (generation === 1) {
  process.stdout.write(JSON.stringify({ id: -1, command: 'native.window', input: { action: 'ensure_settings' } }) + '\n')
  process.exit(17)
}
process.stdin.on('close', () => process.exit(0))
process.stdin.resume()
`, instanceFile)
	ready := make(chan struct{}, 2)
	commandStarted := make(chan struct{}, 1)
	commandRelease := make(chan struct{})
	snapshotTaken := make(chan struct{}, 1)
	environmentCalls := 0
	manager, err := StartManager(ManagerOptions{
		Process: options,
		Environment: func() []string {
			environmentCalls++
			if environmentCalls == 2 {
				snapshotTaken <- struct{}{}
			}
			return []string{"SIDECAR_TEST_DYNAMIC_VALUE=ready"}
		},
		MaxRestarts: 1,
		Backoff:     5 * time.Millisecond,
		OnReady:     func() { ready <- struct{}{} },
		OnCommand: func(context.Context, NativeWindowCommand) (any, error) {
			commandStarted <- struct{}{}
			<-commandRelease
			return map[string]any{"windowId": 2}, nil
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	released := false
	t.Cleanup(func() {
		if !released {
			close(commandRelease)
		}
		ctx, cancel := context.WithTimeout(context.Background(), time.Second)
		defer cancel()
		_ = manager.Close(ctx)
	})

	select {
	case <-ready:
	case <-time.After(2 * time.Second):
		t.Fatal("initial generation did not become ready")
	}
	select {
	case <-commandStarted:
	case <-time.After(2 * time.Second):
		t.Fatal("native command did not start before the process exited")
	}
	select {
	case <-snapshotTaken:
		t.Fatal("replacement snapshot ran before the started native command finished")
	case <-time.After(75 * time.Millisecond):
	}
	close(commandRelease)
	released = true
	select {
	case <-snapshotTaken:
	case <-time.After(2 * time.Second):
		t.Fatal("replacement snapshot did not run after releasing the native command")
	}
	select {
	case <-ready:
	case <-time.After(2 * time.Second):
		t.Fatal("replacement generation did not become ready")
	}
}

func TestManagerStopsAfterBoundedFailedRestarts(t *testing.T) {
	instanceFile := filepath.Join(t.TempDir(), "instances.log")
	options := managedTestOptions(t, `
import { appendFileSync } from 'node:fs'
appendFileSync(process.env.SIDECAR_TEST_INSTANCE_FILE, 'start\n')
process.exit(9)
`, instanceFile)
	exhausted := make(chan error, 1)
	manager, err := StartManager(ManagerOptions{
		Process:     options,
		MaxRestarts: 2,
		Backoff:     5 * time.Millisecond,
		OnExhausted: func(err error) { exhausted <- err },
	})
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		_ = manager.Close(ctx)
	}()

	select {
	case err := <-exhausted:
		if err == nil || !strings.Contains(err.Error(), "exit status 9") {
			t.Fatalf("unexpected exhaustion cause: %v", err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("timed out waiting for bounded recovery failure")
	}
	if starts := managedStarts(t, instanceFile); starts != 3 {
		t.Fatalf("expected initial try and two failed replacements, got %d", starts)
	}
	if _, err := manager.Call(context.Background(), "mutation", `{}`); !errors.Is(err, ErrRecoveryUnavailable) {
		t.Fatalf("expected explicit recovery failure, got %v", err)
	}
}

func TestCloseDuringBackoffDoesNotRestart(t *testing.T) {
	instanceFile := filepath.Join(t.TempDir(), "instances.log")
	options := managedTestOptions(t, `
import { appendFileSync } from 'node:fs'
appendFileSync(process.env.SIDECAR_TEST_INSTANCE_FILE, 'start\n')
process.exit(12)
`, instanceFile)
	manager, err := StartManager(ManagerOptions{
		Process:     options,
		MaxRestarts: 3,
		Backoff:     100 * time.Millisecond,
	})
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	if err := manager.Close(ctx); err == nil || !strings.Contains(err.Error(), "exit status 12") {
		t.Fatalf("expected the terminating process exit status, got %v", err)
	}
	time.Sleep(150 * time.Millisecond)
	if starts := managedStarts(t, instanceFile); starts != 1 {
		t.Fatalf("a closed manager restarted %d times", starts-1)
	}
}

func TestManagerReplacesHungStartupUntilBounded(t *testing.T) {
	instanceFile := filepath.Join(t.TempDir(), "instances.log")
	options := managedTestOptions(t, `
import { appendFileSync } from 'node:fs'
appendFileSync(process.env.SIDECAR_TEST_INSTANCE_FILE, 'start\n')
setInterval(() => {}, 1000)
`, instanceFile)
	exhausted := make(chan error, 1)
	manager, err := StartManager(ManagerOptions{
		Process:        options,
		MaxRestarts:    1,
		Backoff:        5 * time.Millisecond,
		StartupTimeout: 100 * time.Millisecond,
		OnExhausted:    func(err error) { exhausted <- err },
	})
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		_ = manager.Close(ctx)
	}()

	select {
	case err := <-exhausted:
		if !errors.Is(err, context.DeadlineExceeded) {
			t.Fatalf("expected a readiness deadline, got %v", err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("a live but unready sidecar was never replaced")
	}
	if starts := managedStarts(t, instanceFile); starts != 2 {
		t.Fatalf("expected initial try and one replacement, got %d", starts)
	}
	if _, err := manager.Call(context.Background(), "query", `{}`); !errors.Is(err, ErrRecoveryUnavailable) {
		t.Fatalf("expected explicit readiness recovery failure, got %v", err)
	}
}

func TestManagerPreservesImmediateStartupReadiness(t *testing.T) {
	instanceFile := filepath.Join(t.TempDir(), "instances.log")
	options := managedTestOptions(t, `
import { createInterface } from 'node:readline'
process.stdout.write(JSON.stringify({ event: 'sidecar.app.started', payload: {} }) + '\n')
createInterface({ input: process.stdin }).on('line', (line) => {
  const request = JSON.parse(line)
  process.stdout.write(JSON.stringify({ id: request.id, result: { alive: true } }) + '\n')
})
`, instanceFile)
	ready := make(chan struct{}, 1)
	unexpectedExit := make(chan error, 2)
	manager, err := StartManager(ManagerOptions{
		Process:          options,
		MaxRestarts:      1,
		Backoff:          time.Millisecond,
		StartupTimeout:   150 * time.Millisecond,
		OnReady:          func() { ready <- struct{}{} },
		OnUnexpectedExit: func(err error) { unexpectedExit <- err },
	})
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		_ = manager.Close(ctx)
	}()
	select {
	case <-ready:
	case err := <-unexpectedExit:
		t.Fatalf("immediate ready was lost before handler setup: %v", err)
	case <-time.After(time.Second):
		t.Fatal("no readiness event was observed")
	}
	if _, err := manager.Call(context.Background(), "health", `{}`); err != nil {
		t.Fatal(err)
	}
	select {
	case err := <-unexpectedExit:
		t.Fatalf("a healthy generation expired at startup deadline: %v", err)
	case <-time.After(350 * time.Millisecond):
	}
}

func TestManagerTransportSurvivesPendingApplicationStartup(t *testing.T) {
	options := managedTestOptions(t, `
import { createInterface } from 'node:readline'
process.stdout.write(JSON.stringify({ event: 'sidecar.process.ready', payload: { phase: 'unlock' } }) + '\n')
createInterface({ input: process.stdin }).on('line', (line) => {
  const request = JSON.parse(line)
  process.stdout.write(JSON.stringify({ id: request.id, result: { alive: true } }) + '\n')
})
`, t.TempDir())
	manager, err := StartManager(ManagerOptions{
		Process:          options,
		MaxRestarts:      1,
		Backoff:          time.Millisecond,
		StartupTimeout:   50 * time.Millisecond,
		OnReady:          func() { t.Error("transport readiness must not start the renderer") },
		OnUnexpectedExit: func(err error) { t.Errorf("transport-ready sidecar restarted while waiting for input: %v", err) },
	})
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		_ = manager.Close(ctx)
	}()

	// Waiting for a password is not an application startup timeout. Keep the
	// transport deadline short so the old behavior fails this test reliably.
	time.Sleep(175 * time.Millisecond)
	if _, err := manager.Call(context.Background(), "health", `{}`); err != nil {
		t.Fatalf("transport did not survive pending application startup: %v", err)
	}
}

func TestManagerTransportReadyDoesNotResetRecoveryBudget(t *testing.T) {
	instanceFile := filepath.Join(t.TempDir(), "instances.log")
	options := managedTestOptions(t, `
import { appendFileSync } from 'node:fs'
appendFileSync(process.env.SIDECAR_TEST_INSTANCE_FILE, 'start\n')
process.stdout.write(JSON.stringify({ event: 'sidecar.process.ready', payload: {} }) + '\n')
process.exit(17)
`, instanceFile)
	exhausted := make(chan error, 1)
	manager, err := StartManager(ManagerOptions{
		Process:     options,
		MaxRestarts: 2,
		Backoff:     time.Millisecond,
		OnExhausted: func(err error) { exhausted <- err },
	})
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		_ = manager.Close(ctx)
	}()
	select {
	case <-exhausted:
	case <-time.After(5 * time.Second):
		t.Fatal("transport-ready crash loop was not bounded")
	}
	if starts := managedStarts(t, instanceFile); starts != 3 {
		t.Fatalf("transport readiness reset recovery budget: %d starts", starts)
	}
	if _, err := manager.Call(context.Background(), "health", `{}`); !errors.Is(err, ErrRecoveryUnavailable) {
		t.Fatalf("expected unavailable recovery after a transport-ready crash loop, got %v", err)
	}
}

func TestGenerationDelayIsBounded(t *testing.T) {
	for _, test := range []struct {
		attempt int
		want    time.Duration
	}{
		{attempt: 1, want: time.Second},
		{attempt: 2, want: 2 * time.Second},
		{attempt: 3, want: maxBackoff},
		{attempt: 100, want: maxBackoff},
	} {
		t.Run(fmt.Sprintf("attempt-%d", test.attempt), func(t *testing.T) {
			if got := generationDelay(test.attempt, time.Second); got != test.want {
				t.Fatalf("got %s, want %s", got, test.want)
			}
		})
	}
}
