// Package sidecar owns the Node process used by both the product shell and the
// mygo spike. stdout is a protocol channel; stderr remains diagnostics.
package sidecar

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"sync"
	"time"
)

const (
	defaultRequestTimeout  = 60 * time.Second
	defaultShutdownTimeout = 5 * time.Second
)

var ErrClosed = errors.New("sidecar is closed")

// Options describes one owned Node sidecar. NodePath must be resolved by the
// caller; production uses an absolute bundled executable instead of PATH lookup.
type Options struct {
	NodePath        string
	ScriptPath      string
	Env             []string
	Stderr          io.Writer
	RequestTimeout  time.Duration
	ShutdownTimeout time.Duration
	OnExit          func(error)
}

type Event struct {
	Name    string          `json:"event"`
	Payload json.RawMessage `json:"payload"`
}

type reply struct {
	ID     int             `json:"id"`
	Result json.RawMessage `json:"result"`
	Error  string          `json:"error"`
}

// Process is a single sidecar generation. Calls are never replayed on another
// process, so a timeout or crash cannot duplicate a committed mutation.
type Process struct {
	cmd             *exec.Cmd
	stdin           io.WriteCloser
	stdout          *bufio.Reader
	requestTimeout  time.Duration
	shutdownTimeout time.Duration
	onExit          func(error)

	mu        sync.Mutex
	nextID    int
	pending   map[int]chan reply
	discarded map[int]struct{}
	onEvent   func(Event)
	closed    bool
	exitErr   error

	finishOnce sync.Once
	inputOnce  sync.Once
	done       chan struct{}
}

func Start(options Options) (*Process, error) {
	if options.NodePath == "" || options.ScriptPath == "" {
		return nil, errors.New("sidecar node and script paths are required")
	}
	if options.RequestTimeout < 0 || options.ShutdownTimeout < 0 {
		return nil, errors.New("sidecar timeouts cannot be negative")
	}
	requestTimeout := options.RequestTimeout
	if requestTimeout == 0 {
		requestTimeout = defaultRequestTimeout
	}
	shutdownTimeout := options.ShutdownTimeout
	if shutdownTimeout == 0 {
		shutdownTimeout = defaultShutdownTimeout
	}

	cmd := exec.Command(options.NodePath, options.ScriptPath)
	cmd.Env = append(os.Environ(), options.Env...)
	cmd.Stderr = options.Stderr
	configureProcessGroup(cmd)
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, err
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		_ = stdin.Close()
		return nil, err
	}
	if err := cmd.Start(); err != nil {
		_ = stdin.Close()
		return nil, err
	}

	process := &Process{
		cmd:             cmd,
		stdin:           stdin,
		stdout:          bufio.NewReader(stdout),
		requestTimeout:  requestTimeout,
		shutdownTimeout: shutdownTimeout,
		onExit:          options.OnExit,
		pending:         map[int]chan reply{},
		discarded:       map[int]struct{}{},
		done:            make(chan struct{}),
	}
	go process.readLoop()
	return process, nil
}

// SetEventHandler replaces the process's single ordered event consumer.
func (p *Process) SetEventHandler(handler func(Event)) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.onEvent = handler
}

func (p *Process) readLoop() {
	var protocolErr error
	for protocolErr == nil {
		line, err := p.stdout.ReadBytes('\n')
		if len(line) > 0 {
			if !bytes.HasSuffix(line, []byte{'\n'}) {
				protocolErr = errors.New("sidecar output ended with an incomplete JSON message")
				break
			}
			protocolErr = p.handleLine(line)
		}
		if err != nil {
			if !errors.Is(err, io.EOF) {
				protocolErr = err
			}
			break
		}
	}
	if protocolErr != nil {
		_ = killProcessGroup(p.cmd)
	}
	waitErr := p.cmd.Wait()
	if protocolErr != nil {
		waitErr = protocolErr
	}
	p.finish(waitErr)
}

func (p *Process) handleLine(line []byte) error {
	if len(bytes.TrimSpace(line)) == 0 {
		return nil
	}
	var envelope struct {
		Event string `json:"event"`
	}
	if err := json.Unmarshal(line, &envelope); err != nil {
		return fmt.Errorf("malformed sidecar output: %w", err)
	}
	if envelope.Event != "" {
		var event Event
		if err := json.Unmarshal(line, &event); err != nil {
			return fmt.Errorf("malformed sidecar event: %w", err)
		}
		p.mu.Lock()
		handler := p.onEvent
		p.mu.Unlock()
		if handler != nil {
			handler(event)
		}
		return nil
	}

	var answer reply
	if err := json.Unmarshal(line, &answer); err != nil {
		return fmt.Errorf("malformed sidecar response: %w", err)
	}
	p.mu.Lock()
	if _, ok := p.discarded[answer.ID]; ok {
		// A caller gave up, but the sidecar can still complete the request.
		// Its late response is valid protocol and must not kill the process.
		delete(p.discarded, answer.ID)
		p.mu.Unlock()
		return nil
	}
	waiting, ok := p.pending[answer.ID]
	if ok {
		delete(p.pending, answer.ID)
	}
	p.mu.Unlock()
	if !ok {
		return fmt.Errorf("unexpected sidecar response id %d", answer.ID)
	}
	waiting <- answer
	return nil
}

func (p *Process) finish(exitErr error) {
	p.finishOnce.Do(func() {
		p.mu.Lock()
		if p.exitErr == nil {
			p.exitErr = exitErr
		}
		p.closed = true
		pending := p.pending
		p.pending = map[int]chan reply{}
		p.mu.Unlock()

		cause := exitErr
		if cause == nil {
			cause = io.EOF
		}
		for id, waiting := range pending {
			waiting <- reply{ID: id, Error: fmt.Sprintf("sidecar stopped: %v", cause)}
		}
		if p.onExit != nil {
			p.onExit(exitErr)
		}
		close(p.done)
	})
}

// Call dispatches one route without inventing success for an absent response.
// The caller's deadline wins when it is earlier than RequestTimeout.
func (p *Process) Call(ctx context.Context, route string, inputJSON string) (string, error) {
	if route == "" {
		return "", errors.New("sidecar route is required")
	}
	input := json.RawMessage("null")
	if inputJSON != "" {
		input = json.RawMessage(inputJSON)
	}
	if !json.Valid(input) {
		return "", errors.New("sidecar input is not valid JSON")
	}

	callCtx := ctx
	cancel := func() {}
	if p.requestTimeout > 0 {
		callCtx, cancel = context.WithTimeout(ctx, p.requestTimeout)
	}
	defer cancel()
	if err := callCtx.Err(); err != nil {
		return "", fmt.Errorf("sidecar route %q: %w", route, err)
	}

	p.mu.Lock()
	if p.closed {
		p.mu.Unlock()
		return "", ErrClosed
	}
	p.nextID++
	id := p.nextID
	waiting := make(chan reply, 1)
	p.pending[id] = waiting
	request, err := json.Marshal(map[string]any{
		"id": id, "route": route, "input": input,
	})
	if err != nil {
		delete(p.pending, id)
		p.mu.Unlock()
		return "", err
	}
	_, writeErr := p.stdin.Write(append(request, '\n'))
	if writeErr != nil {
		delete(p.pending, id)
	}
	p.mu.Unlock()
	if writeErr != nil {
		return "", fmt.Errorf("write sidecar request: %w", writeErr)
	}

	select {
	case answer := <-waiting:
		if answer.Error != "" {
			return "", errors.New(answer.Error)
		}
		if len(answer.Result) == 0 {
			return "", fmt.Errorf("sidecar route %q returned no result", route)
		}
		return string(answer.Result), nil
	case <-callCtx.Done():
		p.mu.Lock()
		if p.pending[id] == waiting {
			delete(p.pending, id)
			p.discarded[id] = struct{}{}
		}
		p.mu.Unlock()
		return "", fmt.Errorf("sidecar route %q: %w", route, callCtx.Err())
	}
}

// Close lets Node observe stdin EOF, then bounds cleanup. A forced kill owns
// the whole process group on Unix and the task tree on Windows, and Wait reaps
// the direct child before returning.
func (p *Process) Close(ctx context.Context) error {
	p.inputOnce.Do(func() { _ = p.stdin.Close() })
	timer := time.NewTimer(p.shutdownTimeout)
	defer timer.Stop()

	var closeErr error
	select {
	case <-p.done:
		return nil
	case <-ctx.Done():
		closeErr = ctx.Err()
	case <-timer.C:
		closeErr = fmt.Errorf("sidecar required a forced kill after %s", p.shutdownTimeout)
	}
	if err := killProcessGroup(p.cmd); err != nil {
		return fmt.Errorf("kill sidecar after shutdown timeout: %w", err)
	}

	reapTimer := time.NewTimer(p.shutdownTimeout)
	defer reapTimer.Stop()
	select {
	case <-p.done:
		return closeErr
	case <-reapTimer.C:
		return errors.Join(closeErr, errors.New("sidecar did not terminate after a forced kill"))
	}
}
