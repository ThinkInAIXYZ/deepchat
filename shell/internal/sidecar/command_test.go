package sidecar

import (
	"context"
	"encoding/json"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

const commandTestNodeHelper = `
import { createInterface } from 'node:readline'
const send = (message) => process.stdout.write(JSON.stringify(message) + '\n')
const sendCommand = (id) => send({
  id,
  command: 'native.window',
  input: {
    action: 'show',
    windowId: 17,
    source: { windowId: 999, documentUrl: 'mygo://localhost/settings/index.html' },
  },
  source: { windowId: 17, documentUrl: 'mygo://localhost/index.html#/chat' },
})
createInterface({ input: process.stdin }).on('line', (line) => {
  send({ event: 'test.native.received', payload: JSON.parse(line) })
})
process.stdin.on('close', () => process.exit(0))
`

func startCommandTestManager(
	t *testing.T, source string, handler NativeWindowCommandHandler,
	commandTimeout ...time.Duration,
) (*Manager, <-chan Event) {
	var timeout time.Duration
	if len(commandTimeout) == 1 {
		timeout = commandTimeout[0]
	} else if len(commandTimeout) > 1 {
		t.Fatal("only one command timeout is allowed")
	}
	t.Helper()
	options := managedTestOptions(
		t, commandTestNodeHelper+source, filepath.Join(t.TempDir(), "instances.log"),
	)
	events := make(chan Event, 8)
	manager, err := StartManager(ManagerOptions{
		Process:        options,
		CommandTimeout: timeout,
		OnCommand:      handler,
		OnEvent:        func(event Event) { events <- event },
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		_ = manager.Close(ctx)
	})
	return manager, events
}

func waitCommandTestPayload(t *testing.T, events <-chan Event, name string) json.RawMessage {
	t.Helper()
	select {
	case event := <-events:
		if event.Name != name {
			t.Fatalf("unexpected helper event %q", event.Name)
		}
		return event.Payload
	case <-time.After(5 * time.Second):
		t.Fatalf("timed out waiting for helper event %q", name)
		return nil
	}
}

type commandTestResponse struct {
	ID     int             `json:"id"`
	Result json.RawMessage `json:"result"`
	Error  string          `json:"error"`
}

func waitCommandTestResponse(t *testing.T, events <-chan Event) commandTestResponse {
	t.Helper()
	payload := waitCommandTestPayload(t, events, "test.native.received")
	var response commandTestResponse
	if err := json.Unmarshal(payload, &response); err != nil {
		t.Fatalf("decode echoed native response: %v", err)
	}
	if response.Error != "" {
		t.Fatalf("native command failed: %s", response.Error)
	}
	return response
}

func TestManagerNativeWindowCommandPreservesIDAndVerifiedSource(t *testing.T) {
	_, events := startCommandTestManager(t, `sendCommand(-41)`,
		func(_ context.Context, command NativeWindowCommand) (any, error) {
			return command, nil
		},
	)

	response := waitCommandTestResponse(t, events)
	if response.ID != -41 {
		t.Fatalf("response ID = %d, want -41", response.ID)
	}
	var command NativeWindowCommand
	if err := json.Unmarshal(response.Result, &command); err != nil {
		t.Fatalf("decode command result: %v", err)
	}
	if command.ID != -41 || command.Type != NativeWindowCommandType {
		t.Fatalf("handler received an invalid command envelope: id=%d type=%q", command.ID, command.Type)
	}
	wantSource := RequestSource{WindowID: 17, DocumentURL: "mygo://localhost/index.html#/chat"}
	if command.Source == nil || *command.Source != wantSource {
		t.Fatalf("verified command source changed: got %+v, want %+v", command.Source, wantSource)
	}
	var input struct {
		Source RequestSource `json:"source"`
	}
	if err := json.Unmarshal(command.Input, &input); err != nil {
		t.Fatalf("decode renderer input: %v", err)
	}
	wantInputSource := RequestSource{
		WindowID: 999, DocumentURL: "mygo://localhost/settings/index.html",
	}
	if input.Source != wantInputSource {
		t.Fatalf("renderer input was merged with native metadata: got %+v, want %+v", input.Source, wantInputSource)
	}
}

func TestManagerNativeWindowCommandsDoNotOverlap(t *testing.T) {
	var active atomic.Int32
	var maxActive atomic.Int32
	started := make(chan int, 2)
	releaseFirst := make(chan struct{})
	_, events := startCommandTestManager(t, `
sendCommand(-1)
sendCommand(-2)
send({ event: 'test.native.dispatched', payload: {} })
`, func(ctx context.Context, command NativeWindowCommand) (any, error) {
		current := active.Add(1)
		defer active.Add(-1)
		for {
			previous := maxActive.Load()
			if current <= previous || maxActive.CompareAndSwap(previous, current) {
				break
			}
		}
		started <- command.ID
		if command.ID == -1 {
			select {
			case <-releaseFirst:
			case <-ctx.Done():
				return nil, ctx.Err()
			}
		}
		return command, nil
	})

	select {
	case id := <-started:
		if id != -1 {
			t.Fatalf("first command ID = %d, want -1", id)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("first native command did not start")
	}
	// The helper writes this after both commands. The ordered protocol reader can
	// deliver it only after both commands have entered the Manager's bounded queue.
	waitCommandTestPayload(t, events, "test.native.dispatched")
	select {
	case id := <-started:
		t.Fatalf("command %d started while the first command was blocked", id)
	default:
	}

	close(releaseFirst)
	for _, wantID := range []int{-1, -2} {
		response := waitCommandTestResponse(t, events)
		if response.ID != wantID {
			t.Fatalf("response ID = %d, want %d", response.ID, wantID)
		}
	}
	select {
	case id := <-started:
		if id != -2 {
			t.Fatalf("second command ID = %d, want -2", id)
		}
	default:
		t.Fatal("second command produced a response without starting")
	}
	if got := maxActive.Load(); got != 1 {
		t.Fatalf("maximum concurrent native command handlers = %d, want 1", got)
	}
}

func TestQueuedNativeCommandExpiresBeforeExecutionAndStillReceivesError(t *testing.T) {
	firstStarted := make(chan struct{})
	var secondExecuted atomic.Bool
	_, events := startCommandTestManager(t, `
sendCommand(-1)
sendCommand(-2)
send({ event: 'test.native.dispatched', payload: {} })
`, func(ctx context.Context, command NativeWindowCommand) (any, error) {
		if command.ID == -1 {
			close(firstStarted)
			<-ctx.Done()
			return nil, ctx.Err()
		}
		secondExecuted.Store(true)
		return command, nil
	}, 80*time.Millisecond)

	select {
	case <-firstStarted:
	case <-time.After(5 * time.Second):
		t.Fatal("first command did not start")
	}
	waitCommandTestPayload(t, events, "test.native.dispatched")
	responses := map[int]commandTestResponse{}
	for len(responses) < 2 {
		payload := waitCommandTestPayload(t, events, "test.native.received")
		var response commandTestResponse
		if err := json.Unmarshal(payload, &response); err != nil {
			t.Fatalf("decode deadline response: %v", err)
		}
		responses[response.ID] = response
	}
	for _, id := range []int{-1, -2} {
		if !strings.Contains(responses[id].Error, context.DeadlineExceeded.Error()) {
			t.Fatalf("command %d response = %+v, want a delivered deadline error", id, responses[id])
		}
	}
	if secondExecuted.Load() {
		t.Fatal("expired queued command reached the native side effect handler")
	}
}

func TestManagerEmitEventSendsOneWayLifecycleEnvelope(t *testing.T) {
	manager, events := startCommandTestManager(t, "", nil)
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	err := manager.EmitEvent(ctx, Event{
		Name:    "native.window.ready",
		Payload: json.RawMessage(`{"windowId":23,"role":"main","focused":true}`),
		Source:  &EventTarget{WindowID: 23},
	})
	if err != nil {
		t.Fatal(err)
	}

	payload := waitCommandTestPayload(t, events, "test.native.received")
	var envelope struct {
		ID      int    `json:"id"`
		Event   string `json:"event"`
		Payload struct {
			WindowID int    `json:"windowId"`
			Role     string `json:"role"`
			Focused  bool   `json:"focused"`
		} `json:"payload"`
		Source *RequestSource `json:"source"`
	}
	if err := json.Unmarshal(payload, &envelope); err != nil {
		t.Fatalf("decode lifecycle envelope: %v", err)
	}
	if envelope.ID <= 0 || envelope.Event != "native.window.ready" {
		t.Fatalf("invalid lifecycle envelope header: id=%d event=%q", envelope.ID, envelope.Event)
	}
	if envelope.Payload.WindowID != 23 || envelope.Payload.Role != "main" || !envelope.Payload.Focused {
		t.Fatalf("lifecycle payload changed: %+v", envelope.Payload)
	}
	if envelope.Source == nil || envelope.Source.WindowID != 23 || envelope.Source.DocumentURL != "" {
		t.Fatalf("lifecycle event source changed: %+v", envelope.Source)
	}
}

func TestPositiveNativeWindowCommandIsNotAnOrdinaryCall(t *testing.T) {
	commands := make(chan NativeWindowCommand, 1)
	process := startTestProcess(t, `
import { createInterface } from 'node:readline'
createInterface({ input: process.stdin }).on('line', (line) => {
  const request = JSON.parse(line)
  process.stdout.write(JSON.stringify({
    id: request.id,
    command: 'native.window',
    input: { action: 'show', windowId: 17 },
    source: { windowId: 17, documentUrl: 'mygo://localhost/index.html' },
  }) + '\n')
})
`, func(options *Options) {
		options.OnCommand = func(command NativeWindowCommand) { commands <- command }
	})

	_, err := process.Call(context.Background(), "test.positive-command", `{}`)
	if err == nil || !strings.Contains(err.Error(), "malformed native window command") {
		t.Fatalf("positive command was not rejected as a malformed command: %v", err)
	}
	select {
	case command := <-commands:
		t.Fatalf("positive command ID %d reached the native command handler", command.ID)
	default:
	}
}
