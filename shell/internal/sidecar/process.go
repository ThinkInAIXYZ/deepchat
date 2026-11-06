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
var errProcessCleanup = errors.New("sidecar process tree cleanup failed")

func cleanupError(err error) error {
	return fmt.Errorf("%w: %v", errProcessCleanup, err)
}

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
	OnEvent         func(Event)
	OnCommand       func(NativeWindowCommand)
}

type EventTarget struct {
	WindowID int    `json:"windowId"`
	PageID   uint64 `json:"pageId,omitempty"`
}

type Event struct {
	Name    string          `json:"event"`
	Payload json.RawMessage `json:"payload"`
	Source  *EventTarget    `json:"source,omitempty"`
}

// RequestSource is native caller metadata captured outside the renderer's input.
// DocumentURL is the current page URL returned by mygo, not a renderer-supplied value.
type RequestSource struct {
	WindowID    int    `json:"windowId"`
	PageID      uint64 `json:"pageId,omitempty"`
	DocumentURL string `json:"documentUrl"`
}

const NativeWindowCommandType = "native.window"

// NativeWindowCommand has a request-direction negative ID, never the positive
// request IDs allocated by the Go caller. Input is decoded only by the narrow
// window action handler, not exposed as a generic native RPC channel.
type NativeWindowCommand struct {
	ID     int             `json:"id"`
	Type   string          `json:"command"`
	Input  json.RawMessage `json:"input"`
	Source *RequestSource  `json:"source,omitempty"`
	// Host is a sidecar-initiated operation, not renderer-derived source data.
	// The Go handler still limits its actions and target documents.
	Host bool `json:"host,omitempty"`
}

type NativeWindowCommandHandler func(context.Context, NativeWindowCommand) (any, error)

type reply struct {
	ID     int             `json:"id"`
	Result json.RawMessage `json:"result"`
	Error  string          `json:"error"`
}

// Process is a single sidecar generation. Calls are never replayed on another
// process, so a timeout or crash cannot duplicate a committed mutation.
type Process struct {
	cmd             *exec.Cmd
	groupKill       func() error
	stdin           io.WriteCloser
	stdout          *bufio.Reader
	stdoutFile      *os.File
	requestTimeout  time.Duration
	shutdownTimeout time.Duration
	onExit          func(error)

	mu        sync.Mutex
	nextID    int
	pending   map[int]chan reply
	discarded map[int]struct{}
	onEvent   func(Event)
	onCommand func(NativeWindowCommand)
	closed    bool
	stopping  bool
	exitErr   error
	waitErr   error
	waitDone  chan struct{}

	finishOnce sync.Once
	inputOnce  sync.Once
	killOnce   sync.Once
	killErr    error
	writeToken chan struct{}
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
	// Own the read descriptor. cmd.Wait() can proceed independently without
	// closing a StdoutPipe reader and truncating valid buffered responses.
	stdout, output, err := os.Pipe()
	if err != nil {
		_ = stdin.Close()
		return nil, err
	}
	cmd.Stdout = output
	if err := cmd.Start(); err != nil {
		_ = stdin.Close()
		_ = stdout.Close()
		_ = output.Close()
		return nil, err
	}
	_ = output.Close()

	groupKill, err := newProcessGroup(cmd)
	if err != nil {
		// Starting without a proven owner for the complete child tree is not
		// allowed. Reap this direct child and report any cleanup failure.
		cleanupErr := errors.Join(cmd.Process.Kill(), cmd.Wait())
		_ = stdin.Close()
		_ = stdout.Close()
		return nil, fmt.Errorf("configure sidecar process group: %w (cleanup: %v)", err, cleanupErr)
	}
	process := &Process{
		cmd:             cmd,
		groupKill:       groupKill,
		stdin:           stdin,
		stdout:          bufio.NewReader(stdout),
		stdoutFile:      stdout,
		requestTimeout:  requestTimeout,
		shutdownTimeout: shutdownTimeout,
		onExit:          options.OnExit,
		onEvent:         options.OnEvent,
		onCommand:       options.OnCommand,
		pending:         map[int]chan reply{},
		discarded:       map[int]struct{}{},
		writeToken:      make(chan struct{}, 1),
		done:            make(chan struct{}),
		waitDone:        make(chan struct{}),
	}
	go process.waitLoop()
	go process.readLoop()
	return process, nil
}

// SetEventHandler replaces the process's single ordered event consumer.
func (p *Process) SetEventHandler(handler func(Event)) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.onEvent = handler
}

func (p *Process) waitLoop() {
	waitErr := p.cmd.Wait()
	// Even a controlled shutdown must not let orphaned utility children outlive
	// the root process. Reap the leader first to avoid Darwin's dead-group PID
	// race, then close every owned pipe writer in the remaining process group.
	if err := p.killGroup(); err != nil {
		waitErr = errors.Join(waitErr, cleanupError(err))
		// A surviving descendant may hold stdout open. Do not depend on EOF in
		// this failure path: unblock the reader and make cleanup failure final.
		go p.stdoutFile.Close()
		p.mu.Lock()
		p.waitErr = waitErr
		p.mu.Unlock()
		close(p.waitDone)
		p.finish(waitErr)
		return
	}
	p.mu.Lock()
	p.waitErr = waitErr
	p.mu.Unlock()
	close(p.waitDone)
}

func (p *Process) awaitExit() error {
	<-p.waitDone
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.waitErr
}

func (p *Process) readLoop() {
	defer p.stdoutFile.Close()
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
		// A corrupt protocol channel cannot be recovered in place. Force the
		// process group, but never claim that ownership if the kill fails.
		if err := p.killGroup(); err != nil {
			p.finish(errors.Join(protocolErr, cleanupError(err)))
			return
		}
		p.finish(errors.Join(protocolErr, p.awaitExit()))
		return
	}

	p.mu.Lock()
	stopping := p.stopping
	p.mu.Unlock()
	if stopping {
		// Controlled Close owns the grace period if the root never exits.
		// Once it does exit, waitLoop still cleans the remaining process group.
		p.finish(p.awaitExit())
		return
	}

	timer := time.NewTimer(p.shutdownTimeout)
	defer timer.Stop()
	select {
	case <-p.waitDone:
		// A dead leader is reaped before its group is killed in waitLoop. The
		// external pipe lets us finish reading all final envelopes first.
	case <-timer.C:
		// stdout can close while Node stays alive. EOF is not proof of exit:
		// force this generation instead of waiting forever on cmd.Wait().
		if err := p.killGroup(); err != nil {
			p.finish(cleanupError(err))
			return
		}
	}
	p.finish(p.awaitExit())
}

func (p *Process) handleLine(line []byte) error {
	if len(bytes.TrimSpace(line)) == 0 {
		return nil
	}
	var envelope struct {
		Event   string `json:"event"`
		Command string `json:"command"`
	}
	if err := json.Unmarshal(line, &envelope); err != nil {
		return fmt.Errorf("malformed sidecar output: %w", err)
	}
	if envelope.Command != "" {
		if envelope.Command != NativeWindowCommandType {
			return errors.New("unsupported sidecar command type")
		}
		var command NativeWindowCommand
		if err := json.Unmarshal(line, &command); err != nil || command.ID >= 0 {
			return errors.New("malformed native window command")
		}
		p.mu.Lock()
		handler := p.onCommand
		p.mu.Unlock()
		if handler == nil {
			return errors.New("native window commands are unavailable")
		}
		handler(command)
		return nil
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

type writeResult struct {
	count int
	err   error
}

func (p *Process) closeInput() {
	p.inputOnce.Do(func() { _ = p.stdin.Close() })
}

func (p *Process) abortBrokenWrite() {
	p.mu.Lock()
	p.closed = true
	p.mu.Unlock()
	err := p.killGroup()
	go p.closeInput()
	if err != nil {
		p.finish(cleanupError(err))
	}
}

func (p *Process) discardCall(id int, waiting chan reply) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.pending[id] == waiting {
		delete(p.pending, id)
		p.discarded[id] = struct{}{}
	}
}

type writeReceipt struct {
	id      int
	waiting chan reply
}

func (p *Process) writeFrame(
	ctx context.Context, route string, input json.RawMessage, source *RequestSource,
) (writeReceipt, error) {
	return p.writeEnvelope(ctx, nil, true, func(id int) (any, error) {
		return map[string]any{
			"id": id, "route": route, "input": input, "source": source,
		}, nil
	})
}

func (p *Process) writeCommandReply(ctx context.Context, id int, answer reply) error {
	if id >= 0 {
		return errors.New("native window command response requires its negative request ID")
	}
	_, err := p.writeEnvelope(ctx, &id, false, func(id int) (any, error) {
		answer.ID = id
		return answer, nil
	})
	return err
}

func (p *Process) writeEnvelope(
	ctx context.Context,
	responseID *int,
	awaitReply bool,
	encode func(int) (any, error),
) (writeReceipt, error) {
	releaseToken := true
	select {
	case p.writeToken <- struct{}{}:
		defer func() {
			if releaseToken {
				<-p.writeToken
			}
		}()
	case <-p.done:
		return writeReceipt{}, ErrClosed
	case <-ctx.Done():
		// No bytes were sent, so cancelling this request cannot corrupt the
		// framing of a different caller.
		return writeReceipt{}, ctx.Err()
	}
	if err := ctx.Err(); err != nil {
		return writeReceipt{}, err
	}

	// The request ticket, not the state mutex, orders IDs and frames. Keep its
	// ownership across encoding so a later small request cannot overtake this
	// ID on the wire, but never hold the lifecycle lock during large JSON work.
	p.mu.Lock()
	if p.closed {
		p.mu.Unlock()
		return writeReceipt{}, ErrClosed
	}
	receipt := writeReceipt{}
	if responseID != nil {
		receipt.id = *responseID
	} else {
		p.nextID++
		receipt.id = p.nextID
	}
	if awaitReply {
		receipt.waiting = make(chan reply, 1)
		p.pending[receipt.id] = receipt.waiting
	}
	p.mu.Unlock()
	message, err := encode(receipt.id)
	if err != nil {
		return receipt, err
	}
	request, err := json.Marshal(message)
	if err != nil {
		return receipt, err
	}
	if err := ctx.Err(); err != nil {
		return receipt, err
	}
	p.mu.Lock()
	closed := p.closed
	p.mu.Unlock()
	if closed {
		return receipt, ErrClosed
	}

	result := make(chan writeResult, 1)
	go func() {
		count, err := p.stdin.Write(append(request, '\n'))
		result <- writeResult{count: count, err: err}
	}()
	select {
	case written := <-result:
		if written.err == nil && written.count != len(request)+1 {
			written.err = io.ErrShortWrite
		}
		if written.err != nil && written.count < len(request)+1 {
			// A partial JSON envelope cannot be followed by another request.
			// The whole generation is no longer a usable transport.
			p.abortBrokenWrite()
		}
		return receipt, written.err
	case <-ctx.Done():
		// There is no portable way to retract a blocked write without stopping
		// its reader. Do not let cancellation leave a live, incomplete frame.
		p.abortBrokenWrite()
		// The syscall may still be finishing even after the caller's deadline.
		// Transfer release of the write token to its actual completion instead
		// of allowing another frame to interleave with this one.
		releaseToken = false
		go func() {
			<-result
			<-p.writeToken
		}()
		return receipt, ctx.Err()
	}
}

// Call dispatches one route without inventing success for an absent response.
// The caller's deadline wins when it is earlier than RequestTimeout. Normal
// renderer requests provide exactly one native source; an omitted source is
// reserved for transport tests and is rejected by the product sidecar entry.
func (p *Process) Call(
	ctx context.Context, route string, inputJSON string, source ...RequestSource,
) (string, error) {
	if route == "" {
		return "", errors.New("sidecar route is required")
	}
	if len(source) > 1 {
		return "", errors.New("sidecar request accepts at most one native source")
	}
	var callerSource *RequestSource
	if len(source) == 1 {
		callerSource = &source[0]
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

	receipt, writeErr := p.writeFrame(callCtx, route, input, callerSource)
	if writeErr != nil {
		if receipt.waiting != nil {
			p.discardCall(receipt.id, receipt.waiting)
		}
		return "", fmt.Errorf("write sidecar request: %w", writeErr)
	}

	select {
	case answer := <-receipt.waiting:
		if answer.Error != "" {
			return "", errors.New(answer.Error)
		}
		if len(answer.Result) == 0 {
			return "", fmt.Errorf("sidecar route %q returned no result", route)
		}
		return string(answer.Result), nil
	case <-callCtx.Done():
		p.discardCall(receipt.id, receipt.waiting)
		return "", fmt.Errorf("sidecar route %q: %w", route, callCtx.Err())
	}
}

func (p *Process) killGroup() error {
	p.killOnce.Do(func() {
		p.mu.Lock()
		kill := p.groupKill
		p.mu.Unlock()
		p.killErr = kill()
	})
	return p.killErr
}

// Kill terminates this process generation and its owned process tree.
func (p *Process) Kill() error {
	return p.killGroup()
}

func (p *Process) terminalError() error {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.exitErr
}

// Close lets Node observe stdin EOF, then bounds cleanup. A forced kill owns
// the whole process group on Unix and the task tree on Windows, and Wait reaps
// the direct child before returning.
func (p *Process) Close(ctx context.Context) error {
	p.mu.Lock()
	p.stopping = true
	p.closed = true
	p.mu.Unlock()
	timer := time.NewTimer(p.shutdownTimeout)
	defer timer.Stop()
	// Closing stdin can itself wait for a blocked writer. Arm the deadline
	// before attempting it, and let the kill path release that writer.
	go p.closeInput()

	var closeErr error
	select {
	case <-p.done:
		// The root may exit at the same time the caller's context expires.
		// Preserve both reasons instead of letting the reaping race win.
		return errors.Join(ctx.Err(), p.terminalError())
	case <-ctx.Done():
		closeErr = ctx.Err()
	case <-timer.C:
		closeErr = fmt.Errorf("sidecar required a forced kill after %s", p.shutdownTimeout)
	}
	if err := p.killGroup(); err != nil {
		return fmt.Errorf("kill sidecar after shutdown timeout: %w", err)
	}

	reapTimer := time.NewTimer(p.shutdownTimeout)
	defer reapTimer.Stop()
	select {
	case <-p.done:
		return errors.Join(closeErr, p.terminalError())
	case <-reapTimer.C:
		return errors.Join(closeErr, errors.New("sidecar did not terminate after a forced kill"))
	}
}
