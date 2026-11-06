package main

import (
	"context"
	"strings"
	"testing"

	"github.com/ThinkInAIXYZ/deepchat/shell/internal/sidecar"
)

func TestNormalizeExternalURL(t *testing.T) {
	for _, allowed := range []string{
		"https://example.com/path",
		"http://localhost:1234",
		"mailto:user@example.com",
		"tel:+123456",
		"deepchat://session/one",
	} {
		if _, err := normalizeExternalURL(allowed); err != nil {
			t.Errorf("expected %q to be allowed: %v", allowed, err)
		}
	}
	for _, blocked := range []string{
		"javascript:alert(1)",
		"file:///etc/passwd",
		"calculator://",
		"https://",
		"https://example.com/\x00",
		"",
		"not a url",
	} {
		if _, err := normalizeExternalURL(blocked); err == nil {
			t.Errorf("expected %q to be blocked", blocked)
		} else if blocked != "" && strings.Contains(err.Error(), blocked) {
			t.Errorf("error must not repeat the untrusted URL: %v", err)
		}
	}
}

func TestPrimaryRendererDocument(t *testing.T) {
	for _, accepted := range []string{
		"mygo://localhost", "mygo://localhost/", "mygo://localhost/index.html#/chat",
		"mygo://localhost/index.html?mode=test",
	} {
		if !isPrimaryRendererDocument(accepted) {
			t.Errorf("expected native app document %q", accepted)
		}
	}
	for _, rejected := range []string{
		"", "https://localhost/", "file:///index.html", "mygo://evil.test/",
		"mygo://localhost:8080/", "mygo://user@localhost/", "mygo://localhost/preview.html",
		"mygo://localhost/settings/index.html", "mygo://localhost/%69ndex.html",
	} {
		if isPrimaryRendererDocument(rejected) {
			t.Errorf("rejected document %q as an app entry", rejected)
		}
	}
}

func TestNativeCallerAndEventTargetCannotBeFabricated(t *testing.T) {
	bridge := &Bridge{}
	if source, window, err := bridge.requestSource(context.Background()); err == nil || source.WindowID != 0 || window != nil {
		t.Fatalf("accepted missing native caller: source=%+v window=%v err=%v", source, window, err)
	}
	if err := bridge.deliverEvent(sidecar.Event{Name: "test.event"}); err == nil {
		t.Fatal("accepted an event without a native destination")
	}
	if err := bridge.deliverEvent(sidecar.Event{
		Name: "test.event", Source: &sidecar.EventTarget{WindowID: 999},
	}); err == nil {
		t.Fatal("accepted a target not registered by the native shell")
	}
}
