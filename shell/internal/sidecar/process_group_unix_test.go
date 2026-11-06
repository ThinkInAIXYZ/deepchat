//go:build !windows

package sidecar

import (
	"context"
	"encoding/json"
	"errors"
	"syscall"
	"testing"
	"time"
)

func waitForProcessGone(t *testing.T, pid int) {
	t.Helper()
	deadline := time.After(time.Second)
	for {
		err := syscall.Kill(pid, 0)
		if errors.Is(err, syscall.ESRCH) {
			return
		}
		select {
		case <-deadline:
			t.Fatalf("owned child %d survived the stopped sidecar", pid)
		case <-time.After(5 * time.Millisecond):
		}
	}
}

func TestCleanupFailureCompletesWithoutRestart(t *testing.T) {
	instanceFile := t.TempDir() + "/instances.log"
	options := managedTestOptions(t, `
import { appendFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
appendFileSync(process.env.SIDECAR_TEST_INSTANCE_FILE, 'start\n')
const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
  stdio: ['ignore', 'inherit', 'inherit'],
})
createInterface({ input: process.stdin }).on('line', (line) => {
  const request = JSON.parse(line)
  process.stdout.write(JSON.stringify({ id: request.id, result: { pid: child.pid } }) + '\n')
})
`, instanceFile)
	exhausted := make(chan error, 1)
	manager, err := StartManager(ManagerOptions{
		Process:     options,
		MaxRestarts: 1,
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
	answer, err := manager.Call(context.Background(), "child.pid", `{}`)
	if err != nil {
		t.Fatal(err)
	}
	var child struct {
		PID int `json:"pid"`
	}
	if err := json.Unmarshal([]byte(answer), &child); err != nil || child.PID <= 0 {
		t.Fatalf("invalid child identity %s: %v", answer, err)
	}

	manager.mu.Lock()
	process := manager.process
	manager.mu.Unlock()
	if process == nil {
		t.Fatal("the managed process exited before failure injection")
	}
	process.mu.Lock()
	actualGroupKill := process.groupKill
	process.groupKill = func() error { return errors.New("injected cleanup failure") }
	process.mu.Unlock()
	t.Cleanup(func() { _ = actualGroupKill() })

	if err := process.cmd.Process.Kill(); err != nil {
		t.Fatal(err)
	}
	select {
	case err := <-exhausted:
		if !errors.Is(err, errProcessCleanup) {
			t.Fatalf("expected an explicit cleanup failure, got %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("cleanup failure left the process and manager unfinished")
	}
	select {
	case <-process.waitDone:
	case <-time.After(time.Second):
		t.Fatal("root process was not reaped after cleanup failure")
	}
	if _, err := manager.Call(context.Background(), "new.request", `{}`); !errors.Is(err, ErrRecoveryUnavailable) {
		t.Fatalf("unsafe cleanup must make recovery unavailable, got %v", err)
	}
	if starts := managedStarts(t, instanceFile); starts != 1 {
		t.Fatalf("cleanup failure incorrectly started another generation: %d", starts)
	}
	_ = actualGroupKill()
	waitForProcessGone(t, child.PID)
}

func TestUnexpectedExitKillsOwnedProcessTree(t *testing.T) {
	process := startTestProcess(t, `
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
  // Keep the protocol pipe inherited and open without writing to it.
  stdio: ['ignore', 'inherit', 'inherit'],
})
createInterface({ input: process.stdin }).on('line', (line) => {
  const request = JSON.parse(line)
  process.stdout.write(JSON.stringify({ id: request.id, result: { pid: child.pid } }) + '\n')
})
`, nil)
	answer, err := process.Call(context.Background(), "child.pid", `{}`)
	if err != nil {
		t.Fatal(err)
	}
	var child struct {
		PID int `json:"pid"`
	}
	if err := json.Unmarshal([]byte(answer), &child); err != nil {
		t.Fatal(err)
	}
	if child.PID <= 0 {
		t.Fatalf("invalid child pid %d", child.PID)
	}
	// Crash only the direct Node process. The supervisor must clean up the
	// child; killing the group here would hide that ownership obligation.
	if err := process.cmd.Process.Kill(); err != nil {
		t.Fatal(err)
	}
	select {
	case <-process.done:
	case <-time.After(2 * time.Second):
		t.Fatal("sidecar crash was not observed")
	}
	waitForProcessGone(t, child.PID)
}

func TestControlledCloseCleansChildrenAfterRootExit(t *testing.T) {
	process := startTestProcess(t, `
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })
createInterface({ input: process.stdin }).on('line', (line) => {
  const request = JSON.parse(line)
  process.stdout.write(JSON.stringify({ id: request.id, result: { pid: child.pid } }) + '\n')
})
process.stdin.on('close', () => process.exit(0))
`, nil)
	answer, err := process.Call(context.Background(), "child.pid", `{}`)
	if err != nil {
		t.Fatal(err)
	}
	var child struct {
		PID int `json:"pid"`
	}
	if err := json.Unmarshal([]byte(answer), &child); err != nil {
		t.Fatal(err)
	}
	if child.PID <= 0 {
		t.Fatalf("invalid child pid %d", child.PID)
	}
	// The helper intentionally leaves its child behind on a graceful root exit.
	// The supervisor, not the test, must own the remaining group cleanup.
	if err := closeTestProcess(t, process); err != nil {
		t.Fatal(err)
	}
	waitForProcessGone(t, child.PID)
}
