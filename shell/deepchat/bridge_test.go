package main

import (
	"strings"
	"testing"
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
