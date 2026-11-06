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
	manager, err := StartManager(ManagerOptions{
		Process:     options,
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
	if count := strings.Count(string(data), "1:mutation\n"); count != 1 {
		t.Fatalf("expected one first-generation mutation execution, got %d in %s", count, data)
	}
	if strings.Contains(string(data), "2:mutation\n") {
		t.Fatalf("mutation was replayed on the replacement generation: %s", data)
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
