package main

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/ThinkInAIXYZ/deepchat/shell/internal/sidecar"
	"github.com/egoist/mygo"
)

const (
	nativeProtocolBeginRoute     = "native.protocol.begin"
	nativeProtocolReadRoute      = "native.protocol.read"
	nativeProtocolCancelRoute    = "native.protocol.cancel"
	nativeProtocolMaxChunkBytes  = 256 * 1024
	nativeProtocolMaxHeaderBytes = 64 * 1024
)

var nativeProtocolSchemes = []string{"deepcdn", "imgcache", "workspace-preview", "mcp-app"}
var nativeProtocolHeaderName = regexp.MustCompile("^[!#$%&'*+\\-.^_`|~0-9A-Za-z]+$")
var nativeProtocolHopHeaders = map[string]bool{
	"connection": true, "keep-alive": true, "proxy-authenticate": true,
	"proxy-authorization": true, "te": true, "trailer": true,
	"transfer-encoding": true, "upgrade": true,
}

type nativeProtocolMetadata struct {
	Status  int         `json:"status"`
	Headers [][2]string `json:"headers"`
	Body    bool        `json:"body"`
}

type nativeProtocolChunk struct {
	Done bool   `json:"done"`
	Data string `json:"data"`
}

func (b *Bridge) registerNativeProtocols() error {
	for _, scheme := range nativeProtocolSchemes {
		scheme := scheme
		if err := mygo.Protocol.Handle(scheme, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			b.serveNativeProtocol(scheme, w, r)
		})); err != nil {
			return fmt.Errorf("register native protocol %s: %w", scheme, err)
		}
	}
	return nil
}

func newNativeProtocolStreamID() (string, error) {
	var id [16]byte
	if _, err := rand.Read(id[:]); err != nil {
		return "", fmt.Errorf("allocate protocol stream ID: %w", err)
	}
	return hex.EncodeToString(id[:]), nil
}

func (b *Bridge) serveNativeProtocol(scheme string, w http.ResponseWriter, r *http.Request) {
	source, _, err := b.requestSource(r.Context())
	if err != nil {
		http.Error(w, "Forbidden", http.StatusForbidden)
		return
	}
	validateSource := func() error {
		current, _, err := b.requestSource(r.Context())
		if err != nil {
			return err
		}
		if current != source {
			return errors.New("native protocol document is no longer current")
		}
		return nil
	}
	if err := b.serveNativeProtocolRequest(scheme, w, r, source, validateSource); err != nil {
		log.Printf("native protocol %s request failed: %v", scheme, err)
	}
}

func validateNativeProtocolMetadata(metadata nativeProtocolMetadata) error {
	if metadata.Status < 200 || metadata.Status > 599 {
		return errors.New("native protocol response status is invalid")
	}
	connectionNominated := map[string]bool{}
	for _, header := range metadata.Headers {
		if strings.EqualFold(header[0], "Connection") {
			for _, name := range strings.Split(header[1], ",") {
				connectionNominated[strings.ToLower(strings.TrimSpace(name))] = true
			}
		}
	}
	headerBytes := 0
	for _, header := range metadata.Headers {
		name, value := header[0], header[1]
		if !nativeProtocolHeaderName.MatchString(name) || strings.ContainsAny(value, "\r\n\x00") {
			return errors.New("native protocol response header is invalid")
		}
		normalizedName := strings.ToLower(name)
		if nativeProtocolHopHeaders[normalizedName] || connectionNominated[normalizedName] {
			return errors.New("native protocol response includes a hop-by-hop header")
		}
		if strings.EqualFold(name, "Content-Length") {
			if _, err := strconv.ParseUint(value, 10, 63); err != nil {
				return errors.New("native protocol content length is invalid")
			}
		}
		headerBytes += len(name) + len(value)
		if headerBytes > nativeProtocolMaxHeaderBytes {
			return errors.New("native protocol response headers are too large")
		}
	}
	return nil
}

func readNativeProtocolChunk(
	ctx context.Context,
	manager *sidecar.Manager,
	streamID string,
	source sidecar.RequestSource,
) (nativeProtocolChunk, error) {
	input, _ := json.Marshal(map[string]string{"streamId": streamID})
	raw, err := manager.Call(ctx, nativeProtocolReadRoute, string(input), source)
	if err != nil {
		return nativeProtocolChunk{}, err
	}
	var chunk nativeProtocolChunk
	if err := json.Unmarshal([]byte(raw), &chunk); err != nil {
		return nativeProtocolChunk{}, errors.New("decode native protocol chunk")
	}
	if chunk.Data == "" {
		if chunk.Done {
			return chunk, nil
		}
		return nativeProtocolChunk{}, errors.New("native protocol returned an empty unfinished chunk")
	}
	data, err := base64.StdEncoding.DecodeString(chunk.Data)
	if err != nil {
		return nativeProtocolChunk{}, errors.New("decode native protocol chunk data")
	}
	if len(data) > nativeProtocolMaxChunkBytes {
		return nativeProtocolChunk{}, errors.New("native protocol chunk exceeds its size limit")
	}
	chunk.Data = string(data)
	return chunk, nil
}

func (b *Bridge) serveNativeProtocolRequest(
	scheme string,
	w http.ResponseWriter,
	r *http.Request,
	source sidecar.RequestSource,
	validateSource func() error,
) error {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return fmt.Errorf("native protocol method %s is not supported", r.Method)
	}
	manager := b.manager()
	if manager == nil {
		http.Error(w, "Native protocol is unavailable", http.StatusBadGateway)
		return errors.New("native protocol sidecar is unavailable")
	}
	streamID, err := newNativeProtocolStreamID()
	if err != nil {
		http.Error(w, "Native protocol is unavailable", http.StatusBadGateway)
		return err
	}
	headers := map[string]string{}
	for name, values := range r.Header {
		headers[name] = strings.Join(values, ",")
	}
	input, _ := json.Marshal(map[string]any{
		"streamId": streamID,
		"url":      r.URL.String(),
		"method":   r.Method,
		"headers":  headers,
	})
	finished := false
	defer func() {
		if finished {
			return
		}
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		input, _ := json.Marshal(map[string]string{"streamId": streamID})
		_, _ = manager.Call(ctx, nativeProtocolCancelRoute, string(input), source)
	}()
	raw, err := manager.Call(r.Context(), nativeProtocolBeginRoute, string(input), source)
	if err != nil {
		http.Error(w, "Native protocol request failed", http.StatusBadGateway)
		return err
	}
	var metadata nativeProtocolMetadata
	if err := json.Unmarshal([]byte(raw), &metadata); err != nil {
		http.Error(w, "Native protocol response is invalid", http.StatusBadGateway)
		return errors.New("decode native protocol metadata")
	}

	if err := validateNativeProtocolMetadata(metadata); err != nil {
		http.Error(w, "Native protocol response is invalid", http.StatusBadGateway)
		return err
	}
	for _, header := range metadata.Headers {
		w.Header().Add(header[0], header[1])
	}
	w.WriteHeader(metadata.Status)
	if !metadata.Body || r.Method == http.MethodHead {
		finished = true
		return nil
	}

	// The request context covers cancellation, while the live Page URL also
	// catches same-document navigation that does not cancel that context.
	for {
		if validateSource != nil {
			if err := validateSource(); err != nil {
				return err
			}
		}
		chunk, err := readNativeProtocolChunk(r.Context(), manager, streamID, source)
		if err != nil {
			return err
		}
		if chunk.Data != "" {
			if _, err := w.Write([]byte(chunk.Data)); err != nil {
				return err
			}
			if flusher, ok := w.(http.Flusher); ok {
				flusher.Flush()
			}
		}
		if chunk.Done {
			finished = true
			return nil
		}
	}
}
